
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Blob } from "@google/genai";

export type GetAudioContextOptions = AudioContextOptions & {
  id?: string;
};

const map: Map<string, AudioContext> = new Map();

export const audioContext: (
  options?: GetAudioContextOptions
) => Promise<AudioContext> = (() => {
  const didInteract = new Promise(res => {
    window.addEventListener('pointerdown', res, { once: true });
    window.addEventListener('keydown', res, { once: true });
  });

  return async (options?: GetAudioContextOptions) => {
    try {
      const a = new Audio();
      a.src =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      await a.play();
      if (options?.id && map.has(options.id)) {
        const ctx = map.get(options.id);
        if (ctx) {
          return ctx;
        }
      }
      const ctx = new AudioContext(options);
      if (options?.id) {
        map.set(options.id, ctx);
      }
      return ctx;
    } catch (e) {
      await didInteract;
      if (options?.id && map.has(options.id)) {
        const ctx = map.get(options.id);
        if (ctx) {
          return ctx;
        }
      }
      const ctx = new AudioContext(options);
      if (options?.id) {
        map.set(options.id, ctx);
      }
      return ctx;
    }
  };
})();

export type Listener = (...args: any[]) => void;

export class EventEmitter<T extends Record<string, Listener> = Record<string, Listener>> {
  private listeners: Map<keyof T, Listener[]> = new Map();

  on<K extends keyof T>(event: K, listener: T[K]): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(listener);
    return this;
  }

  off<K extends keyof T>(event: K, listener: T[K]): this {
    const handlers = this.listeners.get(event);
    if (handlers) {
      this.listeners.set(event, handlers.filter(h => h !== listener));
    }
    return this;
  }

  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): boolean {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.length === 0) return false;
    handlers.forEach(h => h(...args));
    return true;
  }

  removeAllListeners(event?: keyof T): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}

// --- Audio Processing Helpers for Gemini Live API ---

export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to [-1, 1] range to prevent wrapping artifacts
    const s = Math.max(-1, Math.min(1, data[i]));
    // Convert to 16-bit PCM
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

export function float32ToInt16(data: Float32Array): Int16Array {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return decode(base64).buffer as ArrayBuffer;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Resamples audio data to 16kHz using Web Audio API OfflineAudioContext.
 * This is crucial for matching Gemini's input requirements.
 */
export async function resampleTo16k(audioData: Float32Array, originalSampleRate: number): Promise<Float32Array> {
  if (originalSampleRate === 16000) return audioData;
  if (!audioData || audioData.length === 0) return new Float32Array(0);

  // Calculate target length
  const targetSampleRate = 16000;
  const targetLength = Math.ceil(audioData.length * targetSampleRate / originalSampleRate);

  // Create offline context
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);

  // Create source buffer
  const buffer = offlineCtx.createBuffer(1, audioData.length, originalSampleRate);
  buffer.copyToChannel(audioData as any, 0);

  // Play source into offline context
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();

  // Render
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer.getChannelData(0);
}

export function parseRateFromMime(mimeType?: string, fallback = 24000): number {
  if (!mimeType) return fallback;
  const m = mimeType.match(/rate=(\d+)/);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function pcm16LEBytesToInt16(bytes: Uint8Array): Int16Array {
  const len = Math.floor(bytes.length / 2);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let v = (hi << 8) | lo;
    if (v & 0x8000) v = v - 0x10000;
    out[i] = v;
  }
  return out;
}

export function int16ToPCM16LEBytes(int16: Int16Array): Uint8Array {
  const out = new Uint8Array(int16.length * 2);
  for (let i = 0; i < int16.length; i++) {
    let v = int16[i];
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}

export function calculatePCM16RMS(bytes: Uint8Array): number {
  if (!bytes || bytes.length === 0) return 0;
  const int16 = pcm16LEBytesToInt16(bytes);
  let sum = 0;
  for (let i = 0; i < int16.length; i++) {
    const float = int16[i] / 32768.0;
    sum += float * float;
  }
  return Math.sqrt(sum / int16.length);
}

export function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function processAudioToStandardFloat16kMono(audioBuffer: AudioBuffer): Promise<Float32Array> {
  let mono: Float32Array;
  if (audioBuffer.numberOfChannels >= 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const len = Math.min(left.length, right.length);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = (left[i] + right[i]) / 2;
    mono = out;
  } else {
    mono = audioBuffer.getChannelData(0);
  }
  if (audioBuffer.sampleRate !== 16000) {
    return await resampleTo16k(mono, audioBuffer.sampleRate);
  }
  return mono;
}

export function resamplePCM16Mono(pcm: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) return pcm;
  if (pcm.length === 0) return pcm;
  const ratio = dstRate / srcRate;
  const outLen = Math.max(1, Math.round(pcm.length * ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s1 = pcm[Math.min(idx, pcm.length - 1)];
    const s2 = pcm[Math.min(idx + 1, pcm.length - 1)];
    const v = s1 + (s2 - s1) * frac;
    let vv = Math.round(v);
    if (vv > 32767) vv = 32767;
    if (vv < -32768) vv = -32768;
    out[i] = vv;
  }
  return out;
}
