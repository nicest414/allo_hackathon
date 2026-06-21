import type { CaptureErrorInfo } from '../../../shared/types/capture'
import type { SttSpeaker, SttTranscriptEvent } from '../../../shared/types/ipc'

const SPEAKER: SttSpeaker = 'candidate'
import { getCandidateMicStream, type CandidateMicOptions } from '../capture/candidateMic'
import { toCaptureErrorInfo } from '../capture/types'
import {
  createPcmCaptureNode,
  type CreatePcmCaptureNode,
  type PcmCaptureNode
} from './audio/pcmCaptureNode'
import { onSttTranscript, sendSttAudioChunk, startStt, stopStt } from './sttService'

export interface CandidateMicSttPipelineStartOptions extends CandidateMicOptions {
  chunkMs?: number
  language?: string
  onTranscript?: (event: SttTranscriptEvent) => void
}

export type CandidateMicSttPipelineStartResult =
  | { ok: true; sampleRate: number }
  | { ok: false; error: CaptureErrorInfo }

export interface CandidateMicSttPipelineState {
  running: boolean
  sampleRate?: number
}

export interface CandidateMicSttPipeline {
  start(options?: CandidateMicSttPipelineStartOptions): Promise<CandidateMicSttPipelineStartResult>
  stop(): Promise<void>
  getState(): CandidateMicSttPipelineState
}

interface CandidateMicSttPipelineDependencies {
  getMicStream?: typeof getCandidateMicStream
  createAudioContext?: () => AudioContext
  createCaptureNode?: CreatePcmCaptureNode
  startStt?: typeof startStt
  stopStt?: typeof stopStt
  sendAudioChunk?: typeof sendSttAudioChunk
  onTranscript?: typeof onSttTranscript
  onError?: (error: unknown) => void
}

interface CandidateMicSttSession {
  stream: MediaStream
  audioContext: AudioContext
  source: MediaStreamAudioSourceNode
  capture: PcmCaptureNode
  mute: GainNode
  sendQueue: Promise<void>
  unsubscribeTranscript?: () => void
}

const DEFAULT_CHUNK_MS = 250

export function createCandidateMicSttPipeline(
  dependencies: CandidateMicSttPipelineDependencies = {}
): CandidateMicSttPipeline {
  const getMicStream = dependencies.getMicStream ?? getCandidateMicStream
  const createAudioContext = dependencies.createAudioContext ?? createDefaultAudioContext
  const createCaptureNode = dependencies.createCaptureNode ?? createPcmCaptureNode
  const startSttService = dependencies.startStt ?? startStt
  const stopSttService = dependencies.stopStt ?? stopStt
  const sendAudioChunk = dependencies.sendAudioChunk ?? sendSttAudioChunk
  const subscribeTranscript = dependencies.onTranscript ?? onSttTranscript

  let session: CandidateMicSttSession | undefined
  let operationQueue: Promise<void> = Promise.resolve()

  async function start(
    options: CandidateMicSttPipelineStartOptions = {}
  ): Promise<CandidateMicSttPipelineStartResult> {
    return enqueueOperation(async () => {
      await stopNow()
      const { language, onTranscript: transcriptListener } = options

      const micResult = await getMicStream(toMicOptions(options))

      if (!micResult.ok) {
        return micResult
      }

      let audioContext: AudioContext | undefined
      let unsubscribeTranscript: (() => void) | undefined

      try {
        audioContext = createAudioContext()
        const sampleRate = audioContext.sampleRate
        await resumeAudioContext(audioContext)
        if (transcriptListener) {
          // 自分の話者のtranscriptだけを呼び出し元へ渡す（面接官と同時購読するため）。
          unsubscribeTranscript = subscribeTranscript((event) => {
            if (event.speaker === SPEAKER) {
              transcriptListener(event)
            }
          })
        }
        await startSttService({ sampleRate, language, speaker: SPEAKER })

        const nextSession = await createSession(micResult.stream, audioContext, options)
        session = nextSession
        nextSession.unsubscribeTranscript = unsubscribeTranscript
        unsubscribeTranscript = undefined

        return { ok: true, sampleRate }
      } catch (error) {
        unsubscribeTranscript?.()
        dependencies.onError?.(error)
        await cleanupFailedStart(micResult.stream, audioContext)

        return { ok: false, error: toCaptureErrorInfo(error) }
      }
    })
  }

  async function stop(): Promise<void> {
    await enqueueOperation(stopNow)
  }

  async function createSession(
    stream: MediaStream,
    audioContext: AudioContext,
    options: CandidateMicSttPipelineStartOptions
  ): Promise<CandidateMicSttSession> {
    const source = audioContext.createMediaStreamSource(stream)
    const mute = audioContext.createGain()
    mute.gain.value = 0
    const chunkSampleCount = toChunkSampleCount(audioContext.sampleRate, options.chunkMs)

    const nextSession: CandidateMicSttSession = {
      stream,
      audioContext,
      source,
      // capture は onChunk から session を参照したいため後入れで差し込む
      capture: undefined as unknown as PcmCaptureNode,
      mute,
      sendQueue: Promise.resolve()
    }

    nextSession.capture = await createCaptureNode(audioContext, {
      chunkSampleCount,
      onChunk: (samples) => {
        if (session !== nextSession) {
          return
        }
        queueChunk(nextSession, encodePcm16(samples))
      }
    })

    source.connect(nextSession.capture.node)
    nextSession.capture.node.connect(mute)
    mute.connect(audioContext.destination)

    return nextSession
  }

  function queueChunk(activeSession: CandidateMicSttSession, audio: ArrayBuffer): void {
    activeSession.sendQueue = activeSession.sendQueue
      .catch(() => undefined)
      .then(async () => {
        if (session !== activeSession) {
          return
        }

        await sendAudioChunk({ audio, speaker: SPEAKER })
      })
      .catch((error: unknown) => {
        dependencies.onError?.(error)
      })
  }

  async function stopNow(): Promise<void> {
    const activeSession = session
    if (!activeSession) {
      return
    }

    session = undefined
    activeSession.unsubscribeTranscript?.()
    activeSession.capture.dispose()
    activeSession.source.disconnect()
    activeSession.mute.disconnect()
    activeSession.stream.getTracks().forEach((track) => track.stop())

    await activeSession.sendQueue.catch(() => undefined)
    if (activeSession.audioContext.state !== 'closed') {
      await activeSession.audioContext.close()
    }
    await stopSttService(SPEAKER)
  }

  async function cleanupFailedStart(
    stream: MediaStream,
    audioContext: AudioContext | undefined
  ): Promise<void> {
    stream.getTracks().forEach((track) => track.stop())
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close()
    }
    await stopSttService(SPEAKER).catch((error: unknown) => {
      dependencies.onError?.(error)
    })
  }

  function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationQueue.catch(() => undefined).then(operation)
    operationQueue = next.then(
      () => undefined,
      () => undefined
    )

    return next
  }

  return {
    start,
    stop,
    getState: () => ({
      running: session !== undefined,
      sampleRate: session?.audioContext.sampleRate
    })
  }
}

function createDefaultAudioContext(): AudioContext {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextConstructor) {
    throw new Error('この環境ではAudioContextがサポートされていません')
  }

  return new AudioContextConstructor()
}

async function resumeAudioContext(audioContext: AudioContext): Promise<void> {
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
}

function toChunkSampleCount(sampleRate: number, chunkMs = DEFAULT_CHUNK_MS): number {
  const safeChunkMs = Number.isFinite(chunkMs) && chunkMs > 0 ? chunkMs : DEFAULT_CHUNK_MS
  return Math.max(1, Math.round((sampleRate * safeChunkMs) / 1000))
}

function toMicOptions(options: CandidateMicSttPipelineStartOptions): CandidateMicOptions {
  const micOptions: CandidateMicOptions = {
    channelCount: options.channelCount ?? 1
  }

  if (options.deviceId !== undefined) {
    micOptions.deviceId = options.deviceId
  }
  if (options.echoCancellation !== undefined) {
    micOptions.echoCancellation = options.echoCancellation
  }
  if (options.noiseSuppression !== undefined) {
    micOptions.noiseSuppression = options.noiseSuppression
  }
  if (options.autoGainControl !== undefined) {
    micOptions.autoGainControl = options.autoGainControl
  }
  if (options.sampleRate !== undefined) {
    micOptions.sampleRate = options.sampleRate
  }

  return micOptions
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

export const candidateMicSttPipeline = createCandidateMicSttPipeline()
