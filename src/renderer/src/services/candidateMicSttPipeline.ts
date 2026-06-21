import type { CaptureErrorInfo } from '../../../shared/types/capture'
import type { SttSpeaker, SttTranscriptEvent } from '../../../shared/types/ipc'
import {
  getCandidateMicStream,
  type CandidateMicOptions
} from '../capture/candidateMic'
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

const SPEAKER: SttSpeaker = 'candidate'

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

export function createCandidateMicSttPipeline(
  dependencies: CandidateMicSttPipelineDependencies = {}
): CandidateMicSttPipeline {
  const getMicStream = dependencies.getMicStream ?? getCandidateMicStream
  const createAudioContext = dependencies.createAudioContext ?? createDefaultAudioContext
  const startSttService = dependencies.startStt ?? startStt
  const stopSttService = dependencies.stopStt ?? stopStt
  const sendAudioChunk = dependencies.sendAudioChunk ?? sendSttAudioChunk
  const subscribeTranscript = dependencies.onTranscript ?? onSttTranscript

  let session: CandidateMicSttSession | undefined
  const operationQueue = createAsyncOperationQueue()

  async function start(
    options: CandidateMicSttPipelineStartOptions = {}
  ): Promise<CandidateMicSttPipelineStartResult> {
    return operationQueue.enqueue(async () => {
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

        const nextSession = createSession(micResult.stream, audioContext, options)
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
    await operationQueue.enqueue(stopNow)
  }

  function createSession(
    stream: MediaStream,
    audioContext: AudioContext,
    options: CandidateMicSttPipelineStartOptions
  ): CandidateMicSttSession {
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      INPUT_CHANNELS,
      OUTPUT_CHANNELS
    )
    const mute = audioContext.createGain()
    mute.gain.value = 0

    const nextSession: CandidateMicSttSession = {
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
    activeSession: CandidateMicSttSession,
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

export const candidateMicSttPipeline = createCandidateMicSttPipeline()

export { encodePcm16 }
