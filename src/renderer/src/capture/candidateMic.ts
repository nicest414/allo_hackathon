import type { CaptureResult } from './types'
import { toCaptureErrorInfo } from './types'

export interface CandidateMicOptions {
  deviceId?: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  sampleRate?: number
  channelCount?: number
}

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
