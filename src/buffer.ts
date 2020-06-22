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
    const actual = new Uint8Array((await dst.mapReadAsync()));
    const result = expectContents(actual, exp);
    console.log(result);
    dst.destroy();
  }

  now(): number {
    return performance.now();
  }

  /*
    var x = new Int32Array(1);
    x[0] = 17;
    console.log(x[0]);
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
  // TIMESTAMP
  /*
  async getQueryTime(dstBuffer: GPUBuffer) {
    const dst = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
	console.log("getQueryTime.....................before submit.....");

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(dstBuffer, 0, dst, 0, 16);

    this.device.defaultQueue.submit([commandEncoder.finish()]);
	console.log("getQueryTime.....................after submit.....");

    // @ts-ignore
    const arrayBuf = new BigUint64Array(await dst.mapReadAsync());

    // Time delta is a gpu ticks, we need convert to time using gpu frequency
    const timeDelta = arrayBuf[1] - arrayBuf[0];
	console.log("getQueryTime.......................... timeDelta="+timeDelta);
    console.log(timeDelta);

    // gpu frequency can be got from console in chromium.
    // const timeInNS = timeDelta * 1000000000 / frequency;
	dstBuffer.destroy();
    return Number(timeDelta);
  }
  */

  private compile(
      firstMatrix: Float32Array|Uint32Array,
      secondMatrix: Float32Array|Uint32Array, shape: Uint32Array,
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
        Float32Array.BYTES_PER_ELEMENT * (shape[4] * shape[5]);
    this.resultMatrixBuffer = this.device.createBuffer({
      size: this.resultMatrixBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    console.log(this.resultMatrixBufferSize);

    // This works.
    const [shapeBuffer, shapeMapping] = this.device.createBufferMapped({
      size: shape.byteLength,
      usage: GPUBufferUsage.UNIFORM,
    });
    new Uint32Array(shapeMapping).set(shape);
    shapeBuffer.unmap();

    // This works too.
    /*
     const shapeBuffer = this.uploadToGPU(
         shape, shape.byteLength,
         GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC |
             GPUBufferUsage.COPY_DST);
     */

    return this.createLayout(
        gpuBufferFirstMatrix, gpuBufferSecondMatrix, shapeBuffer,
        computeShaderCode);
  }

  private createLayout(
      gpuBufferFirstMatrix: GPUBuffer, gpuBufferSecondMatrix: GPUBuffer,
      shapeBuffer: GPUBuffer, computeShaderCode: any) {

    // Use old layout:
	// Bind group layout and bind group
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          type: 'uniform-buffer'
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        },
        {binding: 3, visibility: GPUShaderStage.COMPUTE, type: 'storage-buffer'}
      ]
    });

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {binding: 0, resource: {buffer: shapeBuffer}},
        {binding: 1, resource: {buffer: gpuBufferFirstMatrix}},
        {binding: 2, resource: {buffer: gpuBufferSecondMatrix}},
        {binding: 3, resource: {buffer: this.resultMatrixBuffer}}
      ]
    });
	// Old layout end.

    // Pipeline setup
    const result =
        this.glslang.compileGLSLZeroCopy(computeShaderCode, 'compute', false);
    if (result.data.length === 0) {
      throw new Error('Shader compilation failed');
    }
    const computePipeline = this.device.createComputePipeline({
	  // For new layout, remove this line.
	  layout: this.device.createPipelineLayout(
          {bindGroupLayouts: [bindGroupLayout]}),
      computeStage: {
        module: this.device.createShaderModule({code: result.data}),
        entryPoint: 'main'
      }
    });
	
    /* New layout
    const bindGroup = this.device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: shapeBuffer}},
        {binding: 1, resource: {buffer: gpuBufferFirstMatrix}},
        {binding: 2, resource: {buffer: gpuBufferSecondMatrix}},
        {binding: 3, resource: {buffer: this.resultMatrixBuffer}}
      ]
    });
	*/

    return {
      computePipeline, bindGroup
    }
  }

  private compileStaging(
      firstMatrix: Float32Array|Uint32Array,
      secondMatrix: Float32Array|Uint32Array, shape: Uint32Array,
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
        Float32Array.BYTES_PER_ELEMENT * (shape[4] * shape[5]);
    this.resultMatrixBuffer = this.device.createBuffer({
      size: this.resultMatrixBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const shapeBuffer = this.uploadToGPU(
        shape, shape.byteLength,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST);

    return this.createLayout(
        gpuBufferFirstMatrix, gpuBufferSecondMatrix, shapeBuffer,
        computeShaderCode);
  }

  async data() {
    const arrayBuffer = await this.getBufferData();
    return new Float32Array(arrayBuffer);
  }

  // TODO: Float32Array is bad. And buffer is bad.
  async compileAndRun(
      firstMatrix: Float32Array|Uint32Array,
      secondMatrix: Float32Array|Uint32Array, shape: Uint32Array,
      computeShaderCode: any, mode: number) {
    // TODO: figure out how to return non const two values.
    if (mode == 0) {
      const {computePipeline, bindGroup} =
          this.compile(firstMatrix, secondMatrix, shape, computeShaderCode);
      await this.dispatchAndSubmit(
          computePipeline, bindGroup, shape[0], shape[1]);
    } else {
      const {computePipeline, bindGroup} = this.compileStaging(
          firstMatrix, secondMatrix, shape, computeShaderCode);
      await this.dispatchAndSubmit(
          computePipeline, bindGroup, shape[0], shape[1]);
    }

    return true;
  }

  private async dispatchAndSubmit(
      computePipeline: any, bindGroup: any, dispatchX: number,
      dispatchY: number) {
    const start = this.now();
	// TIMESTAMP
	/*
	const querySet = this.device.createQuerySet({
      type: 'timestamp',
      count: 2,
    });
	const dstBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
	*/
    // Commands submission
    const commandEncoder = this.device.createCommandEncoder();

    const passEncoder = commandEncoder.beginComputePass();
	// TIMESTAMPpassEncoder.writeTimestamp(querySet, 0);
    passEncoder.setPipeline(computePipeline);
    passEncoder.setBindGroup(0, bindGroup);
    console.log(dispatchX + '+' + dispatchY);
    passEncoder.dispatch(dispatchX, dispatchY);
	// TIMESTAMPpassEncoder.writeTimestamp(querySet, 1);
    passEncoder.endPass();
	// TIMESTAMPcommandEncoder.resolveQuerySet(querySet, 0, 2, dstBuffer, 0);
    // Submit GPU commands.
    const gpuCommands = commandEncoder.finish();
    this.device.defaultQueue.submit([gpuCommands]);
	// TIMESTAMPawait this.getQueryTime(dstBuffer);
    const fence = this.queue.createFence();
    this.queue.signal(fence, 1);
    await fence.onCompletion(1);
    console.log('Fence time: ' + (this.now() - start));
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
