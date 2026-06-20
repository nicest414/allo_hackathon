import type {
  CaptureDesktopSourcesRequest,
  CaptureDesktopSourcesResult
} from '../../../shared/types/ipc'
import type { CaptureResult } from './types'
import { toCaptureErrorInfo } from './types'

export interface InterviewerScreenOptions {
  sourceId: string
  width?: number
  height?: number
  frameRate?: number
}

type ElectronDesktopVideoConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    maxWidth?: number
    maxHeight?: number
    maxFrameRate?: number
  }
}

export function listInterviewerScreenSources(
  request?: CaptureDesktopSourcesRequest
): Promise<CaptureDesktopSourcesResult> {
  return window.allo.capture.listDesktopSources(request)
}

export async function getInterviewerScreenStream(
  options: InterviewerScreenOptions
): Promise<CaptureResult<MediaStream>> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: toDesktopVideoConstraints(options)
    })

    return { ok: true, stream }
  } catch (error) {
    return { ok: false, error: toCaptureErrorInfo(error) }
  }
}

function toDesktopVideoConstraints(
  options: InterviewerScreenOptions
): ElectronDesktopVideoConstraints {
  const mandatory: ElectronDesktopVideoConstraints['mandatory'] = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: options.sourceId
  }

  if (options.width !== undefined) {
    mandatory.maxWidth = options.width
  }

  if (options.height !== undefined) {
    mandatory.maxHeight = options.height
  }

  if (options.frameRate !== undefined) {
    mandatory.maxFrameRate = options.frameRate
  }

  return {
    mandatory: {
      ...mandatory
    }
  }
}
