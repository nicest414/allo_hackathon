import type { CaptureErrorInfo } from '../../../shared/types/capture'
import type { SttSpeaker, SttTranscriptEvent } from '../../../shared/types/ipc'
import { getInterviewerLoopbackAudioStream } from '../capture/interviewerScreen'

const SPEAKER: SttSpeaker = 'interviewer'
import { toCaptureErrorInfo } from '../capture/types'
import {
  createPcmCaptureNode,
  type CreatePcmCaptureNode,
  type PcmCaptureNode
} from './audio/pcmCaptureNode'
import { encodePcm16 } from './candidateMicSttPipeline'
import { onSttTranscript, sendSttAudioChunk, startStt, stopStt } from './sttService'

export interface InterviewerLoopbackSttPipelineStartOptions {
  chunkMs?: number
  language?: string
  onTranscript?: (event: SttTranscriptEvent) => void
}

export type InterviewerLoopbackSttPipelineStartResult =
  | { ok: true; sampleRate: number }
  | { ok: false; error: CaptureErrorInfo }

export interface InterviewerLoopbackSttPipelineState {
  running: boolean
  sampleRate?: number
}

export interface InterviewerLoopbackSttPipeline {
  start(
    options?: InterviewerLoopbackSttPipelineStartOptions
  ): Promise<InterviewerLoopbackSttPipelineStartResult>
  stop(): Promise<void>
  getState(): InterviewerLoopbackSttPipelineState
}

interface InterviewerLoopbackSttPipelineDependencies {
  getLoopbackStream?: typeof getInterviewerLoopbackAudioStream
  createAudioContext?: () => AudioContext
  createCaptureNode?: CreatePcmCaptureNode
  startStt?: typeof startStt
  stopStt?: typeof stopStt
  sendAudioChunk?: typeof sendSttAudioChunk
  onTranscript?: typeof onSttTranscript
  onError?: (error: unknown) => void
}

interface InterviewerLoopbackSttSession {
  stream: MediaStream
  audioContext: AudioContext
  source: MediaStreamAudioSourceNode
  capture: PcmCaptureNode
  mute: GainNode
  sendQueue: Promise<void>
  unsubscribeTranscript?: () => void
}

const DEFAULT_CHUNK_MS = 250

export function createInterviewerLoopbackSttPipeline(
  dependencies: InterviewerLoopbackSttPipelineDependencies = {}
): InterviewerLoopbackSttPipeline {
  const getLoopbackStream = dependencies.getLoopbackStream ?? getInterviewerLoopbackAudioStream
  const createAudioContext = dependencies.createAudioContext ?? createDefaultAudioContext
  const createCaptureNode = dependencies.createCaptureNode ?? createPcmCaptureNode
  const startSttService = dependencies.startStt ?? startStt
  const stopSttService = dependencies.stopStt ?? stopStt
  const sendAudioChunk = dependencies.sendAudioChunk ?? sendSttAudioChunk
  const subscribeTranscript = dependencies.onTranscript ?? onSttTranscript

  let session: InterviewerLoopbackSttSession | undefined
  let operationQueue: Promise<void> = Promise.resolve()

  async function start(
    options: InterviewerLoopbackSttPipelineStartOptions = {}
  ): Promise<InterviewerLoopbackSttPipelineStartResult> {
    return enqueueOperation(async () => {
      await stopNow()
      const { language, onTranscript: transcriptListener } = options
      const loopbackResult = await getLoopbackStream()

      if (!loopbackResult.ok) {
        return loopbackResult
      }

      let audioContext: AudioContext | undefined
      let unsubscribeTranscript: (() => void) | undefined

      try {
        audioContext = createAudioContext()
        const sampleRate = audioContext.sampleRate
        await resumeAudioContext(audioContext)
        if (transcriptListener) {
          // 自分の話者のtranscriptだけを呼び出し元へ渡す（就活生と同時購読するため）。
          unsubscribeTranscript = subscribeTranscript((event) => {
            if (event.speaker === SPEAKER) {
              transcriptListener(event)
            }
          })
        }
        await startSttService({ sampleRate, language, speaker: SPEAKER })

        const nextSession = await createSession(loopbackResult.stream, audioContext, options)
        session = nextSession
        nextSession.unsubscribeTranscript = unsubscribeTranscript
        unsubscribeTranscript = undefined

        return { ok: true, sampleRate }
      } catch (error) {
        unsubscribeTranscript?.()
        dependencies.onError?.(error)
        await cleanupFailedStart(loopbackResult.stream, audioContext)

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
    options: InterviewerLoopbackSttPipelineStartOptions
  ): Promise<InterviewerLoopbackSttSession> {
    const source = audioContext.createMediaStreamSource(stream)
    const mute = audioContext.createGain()
    mute.gain.value = 0
    const chunkSampleCount = toChunkSampleCount(audioContext.sampleRate, options.chunkMs)

    const nextSession: InterviewerLoopbackSttSession = {
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

  function queueChunk(activeSession: InterviewerLoopbackSttSession, audio: ArrayBuffer): void {
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

export const interviewerLoopbackSttPipeline = createInterviewerLoopbackSttPipeline()
