import { createMediaPipeFaceLandmarker } from '../analysis/face/mediapipeFaceLandmarker'
import type { FaceLandmarker } from '../analysis/face/faceLandmarker'
import {
  captureCandidatePortraitImage,
  captureInterviewerPortraitImage
} from '../capture/portraitFrame'
import type { CaptureResult } from '../capture/types'
import { useDominanceStore } from '../store/useDominanceStore'

export async function captureAndStoreCandidatePortrait(): Promise<string | undefined> {
  const imageUrl = await captureWithMediaPipeFaceLandmarker((landmarker) =>
    captureCandidatePortraitImage({ landmarker })
  )

  if (imageUrl !== undefined) {
    useDominanceStore.getState().setCandidatePortraitImageUrl(imageUrl)
  }

  return imageUrl
}

export async function captureAndStoreInterviewerPortrait(params: {
  sourceId: string
}): Promise<string | undefined> {
  const imageUrl = await captureWithMediaPipeFaceLandmarker((landmarker) =>
    captureInterviewerPortraitImage({ landmarker, sourceId: params.sourceId })
  )

  if (imageUrl !== undefined) {
    useDominanceStore.getState().setInterviewerPortraitImageUrl(imageUrl)
  }

  return imageUrl
}

async function captureWithMediaPipeFaceLandmarker(
  capture: (landmarker: FaceLandmarker | undefined) => Promise<CaptureResult<string>>
): Promise<string | undefined> {
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
