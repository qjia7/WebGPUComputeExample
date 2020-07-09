import {Glslang} from '@webgpu/glslang/dist/web-devel/glslang.onefile';
import {TextureOp} from './texture';

export class MatmulTextureOp extends TextureOp {
  workGroupSize: [number, number, number];
  constructor(
      device: GPUDevice, glslang: Glslang, format: GPUTextureFormat,
      kBytesPerTexel: number) {
    super(device, glslang, format, kBytesPerTexel);
    const TS = 32;
    this.workGroupSize = [TS, TS, 1];
  }

  async execute(
      firstMatrix: Float32Array|Uint32Array,
      secondMatrix: Float32Array|Uint32Array, shape: Uint32Array, mode = 0) {
    const result = await this.compileAndRun(
        firstMatrix, secondMatrix, shape, this.workGroupSize, this.getShader(),
        mode);
    return result;
  }

  private getShader() {
    // Compute shader code (GLSL)
    // view-source:https://www.ibiblio.org/e-notes/webgl/gpu/mul/sgemm2.htm
    const computeShaderCode = `#version 450
        layout(set = 0, binding = 0) uniform Uniforms {
          int inputWidth;
          int inputHeight;
          int filterWidth;
          int filterHeight;
          int outputWidth;
          int outputHeight;
        } uniforms;

        layout(set = 0, binding = 1, rgba32f) uniform writeonly image2D C;

        layout(set = 0, binding = 2, rgba32f) uniform readonly image2D A;
        // readonly
        layout(set = 0, binding = 3, rgba32f) uniform readonly image2D B;
        //#define TS 32u
        //layout (local_size_x = TS/4, local_size_y = TS, local_size_z = 1) in;
        layout(local_size_x = ${this.workGroupSize[0]}, local_size_y = ${
        this.workGroupSize[1]}, local_size_z = 1) in;
        const uint TS =  ${this.workGroupSize[0]};

        // uniform uvec3 MNK;
        shared vec4 Asub[TS/4][TS];  // Local memory to fit a tile of
        shared vec4 Bsub[TS/4][TS];  // TS*TS elements of A and B
      void main() {
          //uint M = MNK.x, N = MNK.y, K = MNK.z;
          // TODO: change this to INPUT SIZE.
          // uint M = 32, N = 32, K = 32;
          uint M = uniforms.inputWidth;
          uint N = uniforms.inputWidth;
          uint K = uniforms.inputWidth;
    
          // Thread identifiers
          uint row = gl_LocalInvocationID.x; // Local row ID (max: TS)
          uint col = gl_LocalInvocationID.y; // Local col ID (max: TS)
          uint globalRow = TS/4*gl_WorkGroupID.x + row; // Row ID of C (0..M)
          uint globalCol = TS*gl_WorkGroupID.y + col; // Col ID of C (0..N)

          // Initialise the accumulation register
          vec4 acc = vec4(0.0);
          // Loop over all tiles
          uint numTiles = K/TS; //4
          for (uint t=0u; t < numTiles; t++) {
              // Load one tile of A and B into local memory
              uint tiledRow = TS/4*t + row;
              uint tiledCol = TS*t + col;
              Asub[col][row] = imageLoad(A, ivec2(tiledCol*M + globalRow));// .r;//A[tiledCol*M + globalRow];
              Bsub[col][row] = imageLoad(B, ivec2(globalCol*K + tiledRow));// .r;//B[globalCol*K + tiledRow];

              // Synchronise to make sure the tile is loaded
              memoryBarrierShared();
              barrier();

              // Perform the computation for a single tile
              for (uint k=0u; k < TS/4; k++) {
                  acc += Asub[k][row] * Bsub[col][k];
              }
              // Synchronise before loading the next tile
              barrier();
          }
          // Store the final result in C
          // C[globalCol*M + globalRow] = acc;
          imageStore(C, ivec2(globalRow,globalCol), vec4(row, row,row,row));
          // imageStore(C, ivec2(globalRow,globalCol), vec4(3,80,90,100));
      }   
        `;
    return computeShaderCode;
  }
}