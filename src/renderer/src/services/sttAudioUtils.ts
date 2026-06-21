const DEFAULT_CHUNK_MS = 250

export function createDefaultAudioContext(): AudioContext {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextConstructor) {
    throw new Error('この環境ではAudioContextがサポートされていません')
  }

  return new AudioContextConstructor()
}

export async function resumeAudioContext(audioContext: AudioContext): Promise<void> {
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
}

export function toChunkSampleCount(sampleRate: number, chunkMs = DEFAULT_CHUNK_MS): number {
  const safeChunkMs = Number.isFinite(chunkMs) && chunkMs > 0 ? chunkMs : DEFAULT_CHUNK_MS
  return Math.max(1, Math.round((sampleRate * safeChunkMs) / 1000))
}

export function appendSamples(current: Float32Array, next: Float32Array): Float32Array {
  const combined = new Float32Array(current.length + next.length)
  combined.set(current)
  combined.set(next, current.length)
  return combined
}

export function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT)
  const view = new DataView(buffer)

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, pcm, true)
  }

  return buffer
}
