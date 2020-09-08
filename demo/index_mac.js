import * as compute from '@webgpu/compute';
// import glslangModule from '@webgpu/glslang/dist/web-devel/glslang.onefile';
import glslangInit from '@webgpu/glslang/dist/web-devel/glslang.onefile';
// import * as tfwebgpu from '@tensorflow/tfjs-backend-webgpu';
// import * as tf from '@tensorflow/tfjs-core';
import * as utils from './utils.js';
import * as common from './common_mac.js';

(async () => {
  if (!navigator.gpu) {
    console.log(
        'WebGPU is not supported. Enable chrome://flags/#enable-unsafe-webgpu flag.');
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  const enableTimeStamp = false;
  const device = await adapter.requestDevice();
  const glslang = await glslangInit();
  const trials = 0, reps = 0;
  var size = 256;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
  size = 384;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
  size = 512;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
  size = 768;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
  size = 1024;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
  size = 2048;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
  size = 4096;
  await common.runTestMatmul(device, glslang, size, size, trials, reps);
})();