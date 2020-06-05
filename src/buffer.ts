// import {Glslang} from '@webgpu/glslang/dist/web-devel-onefile/glslang';
import {Glslang} from '@webgpu/glslang/dist/web-devel/glslang.onefile';
import {expectContents} from './fixture';

export class BufferOp {
  device: GPUDevice;
  queue: GPUQueue;
  glslang: Glslang;
  commandQueue: GPUCommandEncoder[];
  times: [];
  resultMatrixBuffer: GPUBuffer;
  resultMatrixBufferSize: number;
  constructor(device: GPUDevice, glslang: Glslang) {
    this.device = device;
    this.queue = device.defaultQueue;
    this.glslang = glslang;
    this.commandQueue = [];
  }

  createCopyForMapRead(src: any, size: any) {
    const dst = this.device.createBuffer(
        {size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
    const c = this.device.createCommandEncoder();
    c.copyBufferToBuffer(src, 0, dst, 0, size);
    this.device.defaultQueue.submit([c.finish()]);
    return dst;
  }

  async checkContents(src: any, expected: any) {
    const exp = new Uint8Array(
        expected.buffer, expected.byteOffset, expected.byteLength);
    const dst = this.createCopyForMapRead(src, expected.buffer.byteLength);
    console.log(exp);
    console.log(dst);
    // eventualAsyncExpectation(async (niceStack: {message: any;}) => {
    const actual = new Uint8Array((await dst.mapReadAsync()));
    const result = expectContents(actual, exp);
    console.log(result);
    dst.destroy();
  }

  now(): number {
    return performance.now();
  }

  createCopyForMapRead2(size: any) {
    const data = new Uint32Array([0x01020304]);
    // the HOST buffer
    const [src, map] = this.device.createBufferMapped({
      size: 4,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST |
          GPUBufferUsage.MAP_READ,
    });
    new Uint32Array(map).set(data);
    src.unmap();
    // the Device buffer
    const dst = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const c = this.device.createCommandEncoder();
    c.copyBufferToBuffer(src, 0, dst, 0, size);
    this.device.defaultQueue.submit([c.finish()]);
    return dst;
  }

  compile(
      firstMatrix: Float32Array, secondMatrix: Float32Array,
      computeShaderCode: any) {
    const [gpuBufferFirstMatrix, arrayBufferFirstMatrix] =
        this.device.createBufferMapped({
          size: (firstMatrix as Float32Array).byteLength,
          usage: GPUBufferUsage.STORAGE
        });
    new Float32Array(arrayBufferFirstMatrix).set(firstMatrix);
    gpuBufferFirstMatrix.unmap();

    const [gpuBufferSecondMatrix, arrayBufferSecondMatrix] =
        this.device.createBufferMapped({
          size: (secondMatrix as Float32Array).byteLength,
          usage: GPUBufferUsage.STORAGE
        });
    new Float32Array(arrayBufferSecondMatrix).set(secondMatrix);
    gpuBufferSecondMatrix.unmap();

    // Result Matrix
    this.resultMatrixBufferSize =
        Float32Array.BYTES_PER_ELEMENT * (2 + firstMatrix[0] * secondMatrix[1]);
    this.resultMatrixBuffer = this.device.createBuffer({
      size: this.resultMatrixBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Bind group layout and bind group
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        },
        {binding: 2, visibility: GPUShaderStage.COMPUTE, type: 'storage-buffer'}
      ]
    });

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {binding: 0, resource: {buffer: gpuBufferFirstMatrix}},
        {binding: 1, resource: {buffer: gpuBufferSecondMatrix}},
        {binding: 2, resource: {buffer: this.resultMatrixBuffer}}
      ]
    });

    // Pipeline setup
    const result =
        this.glslang.compileGLSLZeroCopy(computeShaderCode, 'compute', false);
    if (result.data.length === 0) {
      throw new Error('Shader compilation failed');
    }
    const computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout(
          {bindGroupLayouts: [bindGroupLayout]}),

      computeStage: {
        module: this.device.createShaderModule({code: result.data}),
        entryPoint: 'main'
      }
    });
    return {
      computePipeline, bindGroup
    }
  }
  /*
    var x = new Int32Array(1);
    x[0] = 17;
    console.log(x[0]);
    console.log(x[1]);
    console.log(x.length);
    this.uploadToGPU(x, 4, GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  */
  private uploadToGPU(values: ArrayBufferView, byteSize: number, usage: any) {
    const buffer = this.device.createBuffer({size: byteSize, usage});

    if (values) {
      buffer.setSubData(0, values as ArrayBufferView);
      values = null;
    }
    return buffer;
  }

  compileStaging(
      firstMatrix: Float32Array, secondMatrix: Float32Array,
      computeShaderCode: any) {
    const gpuBufferFirstMatrix = this.uploadToGPU(
        firstMatrix, (firstMatrix as Float32Array).byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST);
    const gpuBufferSecondMatrix = this.uploadToGPU(
        secondMatrix, (firstMatrix as Float32Array).byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST);

    // Result Matrix
    this.resultMatrixBufferSize =
        Float32Array.BYTES_PER_ELEMENT * (2 + firstMatrix[0] * secondMatrix[1]);
    this.resultMatrixBuffer = this.device.createBuffer({
      size: this.resultMatrixBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Bind group layout and bind group
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        },
        {binding: 2, visibility: GPUShaderStage.COMPUTE, type: 'storage-buffer'}
      ]
    });

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {binding: 0, resource: {buffer: gpuBufferFirstMatrix}},
        {binding: 1, resource: {buffer: gpuBufferSecondMatrix}},
        {binding: 2, resource: {buffer: this.resultMatrixBuffer}}
      ]
    });

    // Pipeline setup
    const result =
        this.glslang.compileGLSLZeroCopy(computeShaderCode, 'compute', false);
    if (result.data.length === 0) {
      throw new Error('Shader compilation failed');
    }
    const computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout(
          {bindGroupLayouts: [bindGroupLayout]}),

      computeStage: {
        module: this.device.createShaderModule({code: result.data}),
        entryPoint: 'main'
      }
    });
    return {
      computePipeline, bindGroup
    }
  }

  // TODO: Float32Array is bad. And buffer is bad.
  async compileAndRun(
      firstMatrix: Float32Array, secondMatrix: Float32Array,
      computeShaderCode: any) {
    const {computePipeline, bindGroup} =
        this.compile(firstMatrix, secondMatrix, computeShaderCode);
    const start = this.now();
    // Commands submission
    const commandEncoder = this.device.createCommandEncoder();

    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(computePipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatch(firstMatrix[0] /* x */, secondMatrix[1] /* y */);
    passEncoder.endPass();
    // Submit GPU commands.
    const gpuCommands = commandEncoder.finish();
    this.device.defaultQueue.submit([gpuCommands]);
    const fence = this.queue.createFence();
    this.queue.signal(fence, 1);
    await fence.onCompletion(1);
    console.log('Fence time: ' + (this.now() - start));
    return true;
  }

  // TODO: Float32Array is bad. And buffer is bad.
  async compileAndRunStaging(
      firstMatrix: Float32Array, secondMatrix: Float32Array,
      computeShaderCode: any) {
    const {computePipeline, bindGroup} =
        this.compileStaging(firstMatrix, secondMatrix, computeShaderCode);
    const start = this.now();
    // Commands submission
    const commandEncoder = this.device.createCommandEncoder();

    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(computePipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatch(firstMatrix[0] /* x */, secondMatrix[1] /* y */);
    passEncoder.endPass();
    // Submit GPU commands.
    const gpuCommands = commandEncoder.finish();
    this.device.defaultQueue.submit([gpuCommands]);
    const fence = this.queue.createFence();
    this.queue.signal(fence, 1);
    await fence.onCompletion(1);
    console.log('Fence time: ' + (this.now() - start));
    return true;
  }

  async getBufferData() {
    // Get a GPU buffer for reading in an unmapped state.
    const gpuReadBuffer = this.device.createBuffer({
      size: this.resultMatrixBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    // Commands submission
    const commandEncoder = this.device.createCommandEncoder();
    // Encode commands for copying buffer to buffer.
    commandEncoder.copyBufferToBuffer(
        this.resultMatrixBuffer /* source buffer */, 0 /* source offset */,
        gpuReadBuffer /* destination buffer */, 0 /* destination offset */,
        this.resultMatrixBufferSize /* size */
    );

    // Submit GPU commands.
    const gpuCommands = commandEncoder.finish();
    this.device.defaultQueue.submit([gpuCommands]);

    const fence = this.queue.createFence();
    this.queue.signal(fence, 2);
    await fence.onCompletion(2);
    // Read buffer.
    const arrayBuffer = await gpuReadBuffer.mapReadAsync();
    return arrayBuffer;
  }
}