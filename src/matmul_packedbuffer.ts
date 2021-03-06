import {Glslang} from '@webgpu/glslang/dist/web-devel/glslang.onefile';
import {BufferOp} from './buffer';

export class MatmulPackedBufferOp extends BufferOp {
  workGroupSize: [number, number, number];
  workPerThread: [number, number, number];
  constructor(
      device: GPUDevice, glslang: Glslang,
      firstMatrix: Float32Array|Uint32Array,
      secondMatrix: Float32Array|Uint32Array, shape: Uint32Array,
      workPerThread: [number, number, number] = [1, 1, 1]) {
    super(device, glslang);
    const TS = 16;
    const TS_Y = 16;
    this.workGroupSize = [TS, TS_Y, 1];
    this.workPerThread = workPerThread;
    this.compile(firstMatrix, secondMatrix, shape, this.getShader());
  }

  executeSync() {
    const result =
        this.compileAndRunSync(this.workGroupSize, this.workPerThread);
    return result;
  }

  // Experimental. DO not USE!
  async execute(
      firstMatrix: Float32Array|Uint32Array,
      secondMatrix: Float32Array|Uint32Array, shape: Uint32Array, mode = 0) {
    const result = await this.compileAndRun(this.workGroupSize);
    return result;
  }

  private getShader() {
    // Compute shader code (GLSL)
    // https://github.com/tensorflow/tfjs/blob/master/tfjs-backend-webgpu/src/kernels/matmul_packed_webgpu.ts
    const computeShaderCode = `#version 450

    layout(local_size_x = ${this.workGroupSize[0]}, local_size_y = ${
        this.workGroupSize[1]}, local_size_z = 1) in;
    
    /* TODO.
    layout(std140, set = 0, binding = 0) uniform Uniforms {
        ivec3 aShape; ivec3 bShape; ivec3 outShape; 
    };
    */
    layout(set = 0, binding = 0) uniform Uniforms {
      int inputWidth;
      int inputHeight;
      int filterWidth;
      int filterHeight;
      int outputWidth;
      int outputHeight;
    };     
  
    layout(std430, set = 0, binding = 1) readonly buffer ssbA {
      float A[];
    };
    
    layout(std430, set = 0, binding = 2) readonly buffer ssbB {
      float B[];
    };

    layout(std430, set = 0, binding = 3) writeonly buffer ssbOut {
        float result[];
    };

    void setOutput(int flatIndex, float value) {
        result[flatIndex] = value;
    }
    // TODO.
    int dimAOuter = inputWidth; // aShape[1];
    int dimInner = filterWidth; // aShape[2];
    int dimBOuter = outputWidth;// bShape[2];
      
    float mm_readA(int row, int col);
    float mm_readB(int row, int col);
    void mm_write(int row, int col, float value);
    void mm_matMul(int dimAOuter, int dimInner, int dimBOuter);
  
    const int RowPerThread = ${this.workPerThread[0]};
    const int ColPerThread = ${this.workPerThread[1]};
    const int TileAOuter = int(gl_WorkGroupSize.y) * RowPerThread;
    const int TileBOuter = int(gl_WorkGroupSize.x) * ColPerThread;
    const int TileInner = TileAOuter > TileBOuter ? TileAOuter : TileBOuter;
  
    shared float mm_Asub[TileAOuter][TileInner];
    shared float mm_Bsub[TileInner][TileBOuter];
  
    void mm_matMul(int dimAOuter, int dimInner, int dimBOuter) {
      int tileRow = int(gl_LocalInvocationID.y) * RowPerThread;
      int tileCol = int(gl_LocalInvocationID.x) * ColPerThread;
  
      int globalRow = int(gl_GlobalInvocationID.y) * RowPerThread;
      int globalCol = int(gl_GlobalInvocationID.x) * ColPerThread;
  
      int numTiles = (dimInner - 1) / TileInner + 1;
  
      float acc[RowPerThread][ColPerThread];
      float ACached;
      float BCached[ColPerThread];
  
      // Without this initialization strange values show up in acc.
      for (int innerRow = 0; innerRow < RowPerThread; innerRow++) {
        for (int innerCol = 0; innerCol < ColPerThread; innerCol++) {
          acc[innerRow][innerCol] = 0.0;
        }
      }
  
      const int ColPerThreadA = TileInner / int(gl_WorkGroupSize.x);
      int tileColA = int(gl_LocalInvocationID.x) * ColPerThreadA;
      const int RowPerThreadB = TileInner / int(gl_WorkGroupSize.y);
      int tileRowB = int(gl_LocalInvocationID.y) * RowPerThreadB;
  
      // Loop over shared dimension.
      for (int t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        for (int innerRow = 0; innerRow < RowPerThread; innerRow++) {
          for (int innerCol = 0; innerCol < ColPerThreadA; innerCol++) {
            int inputRow = tileRow + innerRow;
            int inputCol = tileColA + innerCol;
  
            mm_Asub[inputRow][inputCol] = mm_readA(
                globalRow + innerRow,
                t * TileInner + inputCol);
          }
        }
        // Load one tile of B into local memory.
        for (int innerRow = 0; innerRow < RowPerThreadB; innerRow++) {
          for (int innerCol = 0; innerCol < ColPerThread; innerCol++) {
            int inputRow = tileRowB + innerRow;
            int inputCol = tileCol + innerCol;
  
            mm_Bsub[inputRow][inputCol] = mm_readB(
              t * TileInner + inputRow,
              globalCol + innerCol);;
          }
        }
  
        barrier();
  
        // Compute acc values for a single thread.
        for (int k = 0; k < TileInner; k++) {
          for (int inner = 0; inner < ColPerThread; inner++) {
            BCached[inner] = mm_Bsub[k][tileCol + inner];
          }
  
          for (int innerRow = 0; innerRow < RowPerThread; innerRow++) {
            ACached = mm_Asub[tileRow + innerRow][k];
            for (int innerCol = 0; innerCol < ColPerThread; innerCol++) {
              acc[innerRow][innerCol] += ACached * BCached[innerCol];
            }
          }
        }
  
        barrier();
      }
  
      for (int innerRow = 0; innerRow < RowPerThread; innerRow++) {
        for (int innerCol = 0; innerCol < ColPerThread; innerCol++) {
  
          if ((globalCol + innerCol) < dimBOuter &&
              (globalRow + innerRow) < dimAOuter) {
            mm_write(globalRow + innerRow,
                     globalCol + innerCol,
                     acc[innerRow][innerCol]);
          }
        }
      }
    }
    float mm_readA(int row, int col) {
      return A[row * dimInner + col];
    }
  
    float mm_readB(int row, int col) {
      return B[row * dimBOuter + col];
    }
  
    void mm_write(int row, int col, float value) {
      setOutput(row * dimBOuter + col, value);
    }
  
    void main() {
      mm_matMul(dimAOuter, dimInner, dimBOuter);
    }
        `;
    return computeShaderCode;
  }
}
