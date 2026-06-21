import type { CaptureErrorInfo } from '../../../shared/types/capture'
import type { SttSpeaker, SttTranscriptEvent } from '../../../shared/types/ipc'
import { getInterviewerLoopbackAudioStream } from '../capture/interviewerScreen'
import { toCaptureErrorInfo } from '../capture/types'
import {
  onSttTranscript,
  sendSttAudioChunk,
  startStt,
  stopStt
} from './sttService'
import {
  appendSamples,
  createDefaultAudioContext,
  encodePcm16,
  resumeAudioContext,
  toChunkSampleCount
} from './sttAudioUtils'
import { createAsyncOperationQueue } from './asyncOperationQueue'

const SPEAKER: SttSpeaker = 'interviewer'

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
  processor: ScriptProcessorNode
  mute: GainNode
  chunkSampleCount: number
  pendingSamples: Float32Array
  sendQueue: Promise<void>
  unsubscribeTranscript?: () => void
}

const PROCESSOR_BUFFER_SIZE = 4096
const INPUT_CHANNELS = 1
const OUTPUT_CHANNELS = 1

export function createInterviewerLoopbackSttPipeline(
  dependencies: InterviewerLoopbackSttPipelineDependencies = {}
): InterviewerLoopbackSttPipeline {
  const getLoopbackStream = dependencies.getLoopbackStream ?? getInterviewerLoopbackAudioStream
  const createAudioContext = dependencies.createAudioContext ?? createDefaultAudioContext
  const startSttService = dependencies.startStt ?? startStt
  const stopSttService = dependencies.stopStt ?? stopStt
  const sendAudioChunk = dependencies.sendAudioChunk ?? sendSttAudioChunk
  const subscribeTranscript = dependencies.onTranscript ?? onSttTranscript

  let session: InterviewerLoopbackSttSession | undefined
  const operationQueue = createAsyncOperationQueue()

  async function start(
    options: InterviewerLoopbackSttPipelineStartOptions = {}
  ): Promise<InterviewerLoopbackSttPipelineStartResult> {
    return operationQueue.enqueue(async () => {
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

        const nextSession = createSession(loopbackResult.stream, audioContext, options)
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
    await operationQueue.enqueue(stopNow)
  }

  function createSession(
    stream: MediaStream,
    audioContext: AudioContext,
    options: InterviewerLoopbackSttPipelineStartOptions
  ): InterviewerLoopbackSttSession {
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      INPUT_CHANNELS,
      OUTPUT_CHANNELS
    )
    const mute = audioContext.createGain()
    mute.gain.value = 0

    const nextSession: InterviewerLoopbackSttSession = {
      stream,
      audioContext,
      source,
      processor,
      mute,
      chunkSampleCount: toChunkSampleCount(audioContext.sampleRate, options.chunkMs),
      pendingSamples: new Float32Array(0),
      sendQueue: Promise.resolve()
    }

    processor.onaudioprocess = (event) => {
      processAudioFrame(nextSession, event)
    }

    source.connect(processor)
    processor.connect(mute)
    mute.connect(audioContext.destination)

    return nextSession
  }

  function processAudioFrame(
    activeSession: InterviewerLoopbackSttSession,
    event: AudioProcessingEvent
  ): void {
    if (session !== activeSession) {
      return
    }

    const input = event.inputBuffer.getChannelData(0)
    activeSession.pendingSamples = appendSamples(activeSession.pendingSamples, input)

    while (activeSession.pendingSamples.length >= activeSession.chunkSampleCount) {
      const chunk = activeSession.pendingSamples.slice(0, activeSession.chunkSampleCount)
      activeSession.pendingSamples = activeSession.pendingSamples.slice(
        activeSession.chunkSampleCount
      )
      queueChunk(activeSession, encodePcm16(chunk))
    }
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
    activeSession.processor.onaudioprocess = null
    activeSession.source.disconnect()
    activeSession.processor.disconnect()
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

  return {
    start,
    stop,
    getState: () => ({
      running: session !== undefined,
      sampleRate: session?.audioContext.sampleRate
    })
  }
}

export const interviewerLoopbackSttPipeline = createInterviewerLoopbackSttPipeline()
