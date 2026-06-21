import { describe, expect, it, vi } from 'vitest'
import type { SttTranscriptEvent } from '../../../shared/types/ipc'
import type { CreatePcmCaptureNode } from './audio/pcmCaptureNode'
import { createInterviewerLoopbackSttPipeline } from './interviewerLoopbackSttPipeline'

describe('createInterviewerLoopbackSttPipeline', () => {
  it('captures loopback audio, starts STT, and sends PCM chunks', async () => {
    const track = { stop: vi.fn() }
    const audio = createFakeAudioContext(16000)
    const capture = createFakeCaptureNode()
    const sentChunks: ArrayBuffer[] = []
    const startStt = vi.fn(async () => undefined)
    const pipeline = createInterviewerLoopbackSttPipeline({
      getLoopbackStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      createCaptureNode: capture.create,
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
    capture.emit(new Float32Array(4000).fill(0.5))
    await flushPromises()

    expect(startStt).toHaveBeenCalledWith({
      sampleRate: 16000,
      language: 'ja-JP',
      speaker: 'interviewer'
    })
    expect(sentChunks).toHaveLength(1)
    expect(sentChunks[0].byteLength).toBe(8000)
    expect(new DataView(sentChunks[0]).getInt16(0, true)).toBe(16383)
  })

  it('unsubscribes transcript listener and releases loopback resources on stop', async () => {
    const track = { stop: vi.fn() }
    const unsubscribe = vi.fn()
    const stopStt = vi.fn(async () => undefined)
    const audio = createFakeAudioContext(48000)
    const capture = createFakeCaptureNode()
    const pipeline = createInterviewerLoopbackSttPipeline({
      getLoopbackStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      createCaptureNode: capture.create,
      startStt: vi.fn(async () => undefined),
      stopStt,
      sendAudioChunk: vi.fn(async () => undefined),
      onTranscript: vi.fn((_listener: (event: SttTranscriptEvent) => void) => unsubscribe)
    })

    await pipeline.start({ onTranscript: vi.fn() })
    await pipeline.stop()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(audio.source.disconnect).toHaveBeenCalledOnce()
    expect(capture.dispose).toHaveBeenCalledOnce()
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
  mute: GainNode
  close: ReturnType<typeof vi.fn>
} {
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn()
  } as unknown as MediaStreamAudioSourceNode
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
    createGain: vi.fn(() => mute),
    resume: vi.fn(async () => undefined),
    close
  } as unknown as AudioContext

  return { context, source, mute, close }
}

function createFakeCaptureNode(): {
  create: ReturnType<typeof vi.fn> & CreatePcmCaptureNode
  node: AudioNode
  dispose: ReturnType<typeof vi.fn>
  emit: (samples: Float32Array) => void
} {
  const node = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode
  const dispose = vi.fn()
  let onChunk: ((samples: Float32Array) => void) | undefined
  const create = vi.fn(
    async (_context: AudioContext, options: { onChunk: (samples: Float32Array) => void }) => {
      onChunk = options.onChunk
      return { node, dispose }
    }
  ) as unknown as ReturnType<typeof vi.fn> & CreatePcmCaptureNode

  return {
    create,
    node,
    dispose,
    emit: (samples) => onChunk?.(samples)
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
