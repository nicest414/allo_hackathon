import type { CaptureErrorCode, CaptureErrorInfo } from '../../../shared/types/capture'

export type CaptureResult<T> =
  | {
      ok: true
      stream: T
    }
  | {
      ok: false
      error: CaptureErrorInfo
    }

export function toCaptureErrorInfo(error: unknown): CaptureErrorInfo {
  if (error instanceof DOMException) {
    return {
      code: toCaptureErrorCode(error.name),
      message: error.message || fallbackMessageForName(error.name),
      name: error.name
    }
  }

  if (error instanceof Error) {
    return {
      code: 'unknown',
      message: error.message,
      name: error.name
    }
  }

  return {
    code: 'unknown',
    message: 'メディア取得中に不明なエラーが発生しました'
  }
}

function toCaptureErrorCode(name: string): CaptureErrorCode {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'device-not-found'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'device-in-use'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'constraints-not-satisfied'
    case 'NotSupportedError':
      return 'unsupported'
    default:
      return 'unknown'
  }
}

function fallbackMessageForName(name: string): string {
  switch (toCaptureErrorCode(name)) {
    case 'permission-denied':
      return 'メディア取得権限が許可されていません'
    case 'device-not-found':
      return '利用可能な入力デバイスが見つかりません'
    case 'device-in-use':
      return '入力デバイスを開始できませんでした'
    case 'constraints-not-satisfied':
      return '指定した取得条件を満たす入力デバイスが見つかりません'
    case 'unsupported':
      return 'この環境ではメディア取得がサポートされていません'
    case 'unknown':
      return 'メディア取得中に不明なエラーが発生しました'
  }
}
