import type { CaptureResult } from './types'
import {
  createMeydaVoiceAnalyzer,
  type MeydaVoiceAnalyzerOptions,
  type RealtimeVoiceAnalyzer
} from '../analysis/voice/voiceAnalyzer'
import { toCaptureErrorInfo } from './types'

export interface CandidateMicOptions {
  deviceId?: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  sampleRate?: number
  channelCount?: number
}

export type CandidateMicVoiceAnalyzerOptions = CandidateMicOptions &
  Omit<MeydaVoiceAnalyzerOptions, 'stream'>

export async function getCandidateMicStream(
  options: CandidateMicOptions = {}
): Promise<CaptureResult<MediaStream>> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        echoCancellation: options.echoCancellation ?? true,
        noiseSuppression: options.noiseSuppression ?? true,
        autoGainControl: options.autoGainControl ?? true,
        sampleRate: options.sampleRate ? { ideal: options.sampleRate } : undefined,
        channelCount: options.channelCount ? { ideal: options.channelCount } : undefined
      },
      video: false
    })

    return { ok: true, stream }
  } catch (error) {
    return { ok: false, error: toCaptureErrorInfo(error) }
  }
}

export async function createCandidateMicVoiceAnalyzer(
  options: CandidateMicVoiceAnalyzerOptions = {}
): Promise<CaptureResult<RealtimeVoiceAnalyzer>> {
  const streamResult = await getCandidateMicStream(options)

  if (!streamResult.ok) {
    return streamResult
  }

  const analyzer = await createMeydaVoiceAnalyzer({
    ...options,
    stream: streamResult.stream
  })

  return {
    ok: true,
    stream: {
      ...analyzer,
      async dispose() {
        await analyzer.dispose()
        streamResult.stream.getTracks().forEach((track) => track.stop())
      }
    }
  }
}
