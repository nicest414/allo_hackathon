import { describe, expect, it, vi } from 'vitest'
import type { SttTranscriptEvent } from '../../../shared/types/ipc'
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
    const sentChunks: ArrayBuffer[] = []
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
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
    audio.emit(new Float32Array(4000).fill(0.5))
    await flushPromises()

    expect(sentChunks).toHaveLength(1)
    expect(sentChunks[0].byteLength).toBe(8000)
    expect(new DataView(sentChunks[0]).getInt16(0, true)).toBe(16383)
    expect(audio.source.connect).toHaveBeenCalledWith(audio.processor)
    expect(audio.processor.connect).toHaveBeenCalledWith(audio.mute)
    expect(audio.mute.connect).toHaveBeenCalledWith(audio.context.destination)
    expect(pipeline.getState()).toEqual({ running: true, sampleRate: 16000 })
  })

  it('buffers partial frames until the configured chunk size is reached', async () => {
    const audio = createFakeAudioContext(1000)
    const sentChunks: ArrayBuffer[] = []
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
        ok: true,
        stream: { getTracks: () => [] } as unknown as MediaStream
      }),
      createAudioContext: () => audio.context,
      startStt: vi.fn(async () => undefined),
      stopStt: vi.fn(async () => undefined),
      sendAudioChunk: async ({ audio }) => {
        sentChunks.push(audio)
      }
    })

    await pipeline.start({ chunkMs: 4 })
    audio.emit(new Float32Array([0.1, 0.2]))
    await flushPromises()
    audio.emit(new Float32Array([0.3, 0.4, 0.5]))
    await flushPromises()

    expect(sentChunks).toHaveLength(1)
    expect(sentChunks[0].byteLength).toBe(8)
  })

  it('unsubscribes transcript listener and releases audio resources on stop', async () => {
    const track = { stop: vi.fn() }
    const unsubscribe = vi.fn()
    const stopStt = vi.fn(async () => undefined)
    const audio = createFakeAudioContext(48000)
    const pipeline = createCandidateMicSttPipeline({
      getMicStream: async () => ({
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
})

function readInt16Values(view: DataView): number[] {
  return Array.from({ length: view.byteLength / 2 }, (_unused, index) =>
    view.getInt16(index * 2, true)
  )
}

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
