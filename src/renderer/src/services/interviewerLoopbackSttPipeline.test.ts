import { describe, expect, it, vi } from 'vitest'
import type { SttTranscriptEvent } from '../../../shared/types/ipc'
import { createInterviewerLoopbackSttPipeline } from './interviewerLoopbackSttPipeline'

describe('createInterviewerLoopbackSttPipeline', () => {
  it('captures loopback audio, starts STT, and sends PCM chunks', async () => {
    const track = { stop: vi.fn() }
    const audio = createFakeAudioContext(16000)
    const sentChunks: ArrayBuffer[] = []
    const startStt = vi.fn(async () => undefined)
    const pipeline = createInterviewerLoopbackSttPipeline({
      getLoopbackStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      startStt,
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: async ({ audio }) => {
        sentChunks.push(audio)
      }
    })

    await expect(pipeline.start({ chunkMs: 250, language: 'ja-JP' })).resolves.toEqual({
      ok: true,
      sampleRate: 16000
    })
    audio.emit(new Float32Array(4000).fill(0.5))
    await flushPromises()

    expect(startStt).toHaveBeenCalledWith({ sampleRate: 16000, language: 'ja-JP' })
    expect(sentChunks).toHaveLength(1)
    expect(sentChunks[0].byteLength).toBe(8000)
    expect(new DataView(sentChunks[0]).getInt16(0, true)).toBe(16383)
  })

  it('unsubscribes transcript listener and releases loopback resources on stop', async () => {
    const track = { stop: vi.fn() }
    const unsubscribe = vi.fn()
    const stopStt = vi.fn(async () => undefined)
    const audio = createFakeAudioContext(48000)
    const pipeline = createInterviewerLoopbackSttPipeline({
      getLoopbackStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      startStt: vi.fn(async () => undefined),
      stopStt,
      sendAudioChunk: vi.fn(async () => undefined),
      onTranscript: vi.fn((_listener: (event: SttTranscriptEvent) => void) => unsubscribe)
    })

    await pipeline.start({ onTranscript: vi.fn() })
    await pipeline.stop()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(audio.source.disconnect).toHaveBeenCalledOnce()
    expect(audio.processor.disconnect).toHaveBeenCalledOnce()
    expect(audio.mute.disconnect).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(audio.close).toHaveBeenCalledOnce()
    expect(stopStt).toHaveBeenCalledOnce()
    expect(pipeline.getState()).toEqual({ running: false, sampleRate: undefined })
  })
})

function createFakeAudioContext(sampleRate: number): {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  mute: GainNode
  close: ReturnType<typeof vi.fn>
  emit: (samples: Float32Array) => void
} {
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn()
  } as unknown as MediaStreamAudioSourceNode
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null
  } as unknown as ScriptProcessorNode
  const mute = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn()
  } as unknown as GainNode
  const close = vi.fn(async () => undefined)
  const context = {
    sampleRate,
    state: 'running',
    destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => mute),
    resume: vi.fn(async () => undefined),
    close
  } as unknown as AudioContext

  return {
    context,
    source,
    processor,
    mute,
    close,
    emit: (samples) => {
      processor.onaudioprocess?.({
        inputBuffer: {
          getChannelData: () => samples
        }
      } as unknown as AudioProcessingEvent)
    }
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
