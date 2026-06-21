import { describe, expect, it, vi } from 'vitest'
import type { SttTranscriptEvent } from '../../../shared/types/ipc'
import type { CreatePcmCaptureNode } from './audio/pcmCaptureNode'
import { createCandidateMicSttPipeline, encodePcm16 } from './candidateMicSttPipeline'

describe('encodePcm16', () => {
  it('converts float samples to little-endian signed 16-bit PCM', () => {
    const encoded = encodePcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]))
    const view = new DataView(encoded)

    expect(readInt16Values(view)).toEqual([-32768, -16384, 0, 16383, 32767])
  })

  it('clips samples outside the supported PCM range', () => {
    const encoded = encodePcm16(new Float32Array([-2, 2]))
    const view = new DataView(encoded)

    expect(readInt16Values(view)).toEqual([-32768, 32767])
  })
})

describe('createCandidateMicSttPipeline', () => {
  it('starts STT with the AudioContext sample rate and sends PCM chunks', async () => {
    const track = { stop: vi.fn() }
    const audio = createFakeAudioContext(16000)
    const capture = createFakeCaptureNode()
    const sentChunks: ArrayBuffer[] = []
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      createCaptureNode: capture.create,
      startStt: vi.fn(async () => undefined),
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: async ({ audio }) => {
        sentChunks.push(audio)
      }
    })

    await expect(pipeline.start({ chunkMs: 250, sampleRate: 16000 })).resolves.toEqual({
      ok: true,
      sampleRate: 16000
    })
    // chunkMs 250 @16000Hz = 4000 サンプル
    expect(capture.create).toHaveBeenCalledWith(
      audio.context,
      expect.objectContaining({ chunkSampleCount: 4000 })
    )
    capture.emit(new Float32Array(4000).fill(0.5))
    await flushPromises()

    expect(sentChunks).toHaveLength(1)
    expect(sentChunks[0].byteLength).toBe(8000)
    expect(new DataView(sentChunks[0]).getInt16(0, true)).toBe(16383)
    expect(audio.source.connect).toHaveBeenCalledWith(capture.node)
    expect(capture.node.connect).toHaveBeenCalledWith(audio.mute)
    expect(audio.mute.connect).toHaveBeenCalledWith(audio.context.destination)
    expect(pipeline.getState()).toEqual({ running: true, sampleRate: 16000 })
  })

  it('unsubscribes transcript listener and releases audio resources on stop', async () => {
    const track = { stop: vi.fn() }
    const unsubscribe = vi.fn()
    const stopStt = vi.fn(async () => undefined)
    const audio = createFakeAudioContext(48000)
    const capture = createFakeCaptureNode()
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
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
    expect(capture.dispose).toHaveBeenCalledOnce()
    expect(audio.source.disconnect).toHaveBeenCalledOnce()
    expect(audio.mute.disconnect).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(audio.close).toHaveBeenCalledOnce()
    expect(stopStt).toHaveBeenCalledOnce()
    expect(pipeline.getState()).toEqual({ running: false, sampleRate: undefined })
  })

  it('stops captured tracks and does not stay running when STT start fails', async () => {
    const track = { stop: vi.fn() }
    const audio = createFakeAudioContext(48000)
    const stopStt = vi.fn(async () => undefined)
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      createCaptureNode: createFakeCaptureNode().create,
      startStt: vi.fn(async () => {
        throw new Error('stt failed')
      }),
      stopStt,
      sendAudioChunk: vi.fn(async () => undefined)
    })

    const result = await pipeline.start()

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown',
        message: 'stt failed',
        name: 'Error'
      }
    })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(audio.close).toHaveBeenCalledOnce()
    expect(stopStt).toHaveBeenCalledOnce()
    expect(pipeline.getState()).toEqual({ running: false, sampleRate: undefined })
  })

  it('unsubscribes transcript listener when STT start fails', async () => {
    const unsubscribe = vi.fn()
    const audio = createFakeAudioContext(48000)
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      createCaptureNode: createFakeCaptureNode().create,
      startStt: vi.fn(async () => {
        throw new Error('stt failed')
      }),
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: vi.fn(async () => undefined),
      onTranscript: vi.fn((_listener: (event: SttTranscriptEvent) => void) => unsubscribe)
    })

    await pipeline.start({ onTranscript: vi.fn() })

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('stops captured tracks when AudioContext creation fails', async () => {
    const track = { stop: vi.fn() }
    const stopStt = vi.fn(async () => undefined)
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => {
        throw new Error('audio unsupported')
      },
      startStt: vi.fn(async () => undefined),
      stopStt,
      sendAudioChunk: vi.fn(async () => undefined)
    })

    const result = await pipeline.start()

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown',
        message: 'audio unsupported',
        name: 'Error'
      }
    })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(stopStt).toHaveBeenCalledOnce()
    expect(pipeline.getState()).toEqual({ running: false, sampleRate: undefined })
  })

  it('passes only mic capture options to getCandidateMicStream', async () => {
    const getMicStream = vi.fn(async () => ({
      ok: true as const,
      stream: { getTracks: () => [] } as unknown as MediaStream
    }))
    const audio = createFakeAudioContext(16000)
    const pipeline = createCandidateMicSttPipeline({
      getMicStream,
      createAudioContext: () => audio.context,
      createCaptureNode: createFakeCaptureNode().create,
      startStt: vi.fn(async () => undefined),
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: vi.fn(async () => undefined)
    })

    await pipeline.start({
      deviceId: 'mic-1',
      chunkMs: 100,
      language: 'ja-JP',
      onTranscript: vi.fn()
    })

    expect(getMicStream).toHaveBeenCalledWith({
      deviceId: 'mic-1',
      channelCount: 1
    })
  })

  it('serializes repeated starts and releases the superseded session', async () => {
    const firstTrack = { stop: vi.fn() }
    const secondTrack = { stop: vi.fn() }
    const firstAudio = createFakeAudioContext(16000)
    const secondAudio = createFakeAudioContext(16000)
    const audioContexts = [firstAudio.context, secondAudio.context]
    const streams = [
      { getTracks: () => [firstTrack] },
      { getTracks: () => [secondTrack] }
    ] as unknown as MediaStream[]
    let index = 0
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: streams[index]
      }),
      createAudioContext: () => audioContexts[index++],
      createCaptureNode: createFakeCaptureNode().create,
      startStt: vi.fn(async () => undefined),
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: vi.fn(async () => undefined)
    })

    const firstStart = pipeline.start()
    const secondStart = pipeline.start()

    await expect(firstStart).resolves.toEqual({ ok: true, sampleRate: 16000 })
    await expect(secondStart).resolves.toEqual({ ok: true, sampleRate: 16000 })

    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(firstAudio.close).toHaveBeenCalledOnce()
    expect(secondTrack.stop).not.toHaveBeenCalled()
    expect(secondAudio.close).not.toHaveBeenCalled()
    expect(pipeline.getState()).toEqual({ running: true, sampleRate: 16000 })
  })

  it('forwards only its own speaker (candidate) transcripts to the listener', async () => {
    const audio = createFakeAudioContext(16000)
    let wrapped: ((event: SttTranscriptEvent) => void) | undefined
    const received: SttTranscriptEvent[] = []

    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      createCaptureNode: createFakeCaptureNode().create,
      startStt: vi.fn(async () => undefined),
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: vi.fn(async () => undefined),
      onTranscript: (listener) => {
        wrapped = listener
        return vi.fn()
      }
    })

    await pipeline.start({ onTranscript: (event) => received.push(event) })

    wrapped?.({ text: '就活生の回答', isFinal: true, speaker: 'candidate' })
    wrapped?.({ text: '面接官の質問', isFinal: true, speaker: 'interviewer' })

    expect(received).toEqual([{ text: '就活生の回答', isFinal: true, speaker: 'candidate' }])
  })
})

function readInt16Values(view: DataView): number[] {
  return Array.from({ length: view.byteLength / 2 }, (_unused, index) =>
    view.getInt16(index * 2, true)
  )
}

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
