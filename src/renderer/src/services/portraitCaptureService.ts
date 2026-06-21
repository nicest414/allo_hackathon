import { createMediaPipeFaceLandmarker } from '../analysis/face/mediapipeFaceLandmarker'
import type { FaceLandmarker } from '../analysis/face/faceLandmarker'
import {
  captureCandidatePortraitImage,
  captureInterviewerPortraitImage,
  captureManualPortraitImage,
  type NormalizedRect,
  type PortraitManualCropRequired
} from '../capture/portraitFrame'
import type { CaptureResult } from '../capture/types'
import { useDominanceStore } from '../store/useDominanceStore'

export async function captureAndStoreCandidatePortrait(): Promise<string | undefined> {
  const result = await captureWithMediaPipeFaceLandmarker((landmarker) =>
    captureCandidatePortraitImage({ landmarker })
  )

  if (result !== undefined) {
    useDominanceStore.getState().setCandidatePortraitImageUrl(result)
  }

  return result
}

export type InterviewerPortraitCaptureResult =
  | { kind: 'stored'; imageUrl: string }
  | { kind: 'manual-required'; rawFrameDataUrl: string; sourceWidth: number; sourceHeight: number }
  | { kind: 'failed' }

export async function captureAndStoreInterviewerPortrait(params: {
  sourceId: string
  manualRect?: NormalizedRect
  allowManualFallback?: boolean
}): Promise<InterviewerPortraitCaptureResult> {
  const result = await captureWithMediaPipeFaceLandmarker((landmarker) =>
    captureInterviewerPortraitImage({
      landmarker,
      sourceId: params.sourceId,
      manualRect: params.manualRect,
      allowManualFallback: params.allowManualFallback
    })
  )

  if (result === undefined) {
    return { kind: 'failed' }
  }

  if (typeof result === 'string') {
    useDominanceStore.getState().setInterviewerPortraitImageUrl(result)
    return { kind: 'stored', imageUrl: result }
  }

  return {
    kind: 'manual-required',
    rawFrameDataUrl: result.rawFrameDataUrl,
    sourceWidth: result.sourceWidth,
    sourceHeight: result.sourceHeight
  }
}

/**
 * 手動範囲指定ダイアログで確定したrectを、既に手元にある生フレームに適用してストアへ保存する。
 * 生フレームは取得済みのため、画面ストリームを再キャプチャしない。
 */
export async function applyManualInterviewerPortraitRect(
  rawFrameDataUrl: string,
  rect: NormalizedRect
): Promise<string | undefined> {
  try {
    const imageUrl = await captureManualPortraitImage(rawFrameDataUrl, rect)
    useDominanceStore.getState().setInterviewerPortraitImageUrl(imageUrl)
    return imageUrl
  } catch (error) {
    console.warn('Failed to apply manual interviewer face rect', error)
    return undefined
  }
}

async function captureWithMediaPipeFaceLandmarker<T extends string | PortraitManualCropRequired>(
  capture: (landmarker: FaceLandmarker | undefined) => Promise<CaptureResult<T>>
): Promise<T | undefined> {
  const landmarker = await createMediaPipeFaceLandmarker().catch((error: unknown) => {
    console.warn('Failed to initialize MediaPipe face landmarker', error)
    return undefined
  })

  try {
    const result = await capture(landmarker)

    if (result.ok) {
      return result.stream
    }

    console.warn('Failed to capture portrait image', result.error)
    return undefined
  } finally {
    await landmarker?.close?.()
  }
}
