import type { CaptureResult } from './types'
import { toCaptureErrorInfo } from './types'

export interface CandidateCameraOptions {
  deviceId?: string
  width?: number
  height?: number
  frameRate?: number
}

export async function getCandidateCameraStream(
  options: CandidateCameraOptions = {}
): Promise<CaptureResult<MediaStream>> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        width: options.width ? { ideal: options.width } : undefined,
        height: options.height ? { ideal: options.height } : undefined,
        frameRate: options.frameRate ? { ideal: options.frameRate } : undefined
      }
    })

    return { ok: true, stream }
  } catch (error) {
    return { ok: false, error: toCaptureErrorInfo(error) }
  }
}
