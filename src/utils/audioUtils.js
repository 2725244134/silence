/**
 * 音频处理工具函数
 */

/**
 * 合并两个 Float32Array
 */
export const concatFloat32 = (a, b) => {
  if (!a || a.length === 0) return b;
  if (!b || b.length === 0) return a;
  const merged = new Float32Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);
  return merged;
};

/**
 * 重采样 Float32Array
 */
export const resampleFloat32 = (input, inputRate, outputRate) => {
  if (!input || input.length === 0) return new Float32Array(0);
  if (inputRate === outputRate) return input;

  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = (i * inputRate) / outputRate;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const weight = position - leftIndex;
    output[i] = input[leftIndex] + (input[rightIndex] - input[leftIndex]) * weight;
  }

  return output;
};

/**
 * Float32 转 PCM16
 */
export const float32ToPCM16 = (samples) => {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16.buffer);
};

/**
 * 音频配置常量
 */
export const AUDIO_CONFIG = {
  TARGET_SAMPLE_RATE: 16000,
  TARGET_CHANNELS: 1,
  DEFAULT_CHUNK_MS: 40,
};
