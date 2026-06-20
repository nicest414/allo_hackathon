export type CaptureErrorCode =
  | 'permission-denied'
  | 'device-not-found'
  | 'device-in-use'
  | 'constraints-not-satisfied'
  | 'unsupported'
  | 'unknown'

export interface CaptureErrorInfo {
  code: CaptureErrorCode
  message: string
  name?: string
}

export interface DesktopCaptureSource {
  id: string
  name: string
  displayId?: string
  thumbnailDataUrl?: string
  appIconDataUrl?: string
}

export interface DesktopCaptureSourcesRequest {
  types?: Array<'screen' | 'window'>
  thumbnailSize?: {
    width: number
    height: number
  }
}
