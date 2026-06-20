import { useEffect } from 'react'
import { createFaceLandmarker } from '../../analysis/face/faceLandmarker'
import { captureCandidatePortraitImage } from '../../capture/portraitFrame'
import { useDominanceStore } from '../../store/useDominanceStore'

let initialCandidatePortraitPromise: Promise<string | undefined> | undefined

export function useInitialCandidatePortraitImage(): void {
  const candidatePortraitImageUrl = useDominanceStore((state) => state.portraitImageUrls.candidate)
  const setCandidatePortraitImageUrl = useDominanceStore(
    (state) => state.setCandidatePortraitImageUrl
  )

  useEffect(() => {
    if (candidatePortraitImageUrl !== undefined) {
      return
    }

    let cancelled = false

    void getInitialCandidatePortraitImage()
      .then((imageUrl) => {
        if (!cancelled && imageUrl !== undefined) {
          setCandidatePortraitImageUrl(imageUrl)
        }
      })
      .catch((error: unknown) => {
        console.warn('Failed to initialize candidate portrait image', error)
      })

    return () => {
      cancelled = true
    }
  }, [candidatePortraitImageUrl, setCandidatePortraitImageUrl])
}

function getInitialCandidatePortraitImage(): Promise<string | undefined> {
  initialCandidatePortraitPromise ??= captureWithMediaPipeFaceCrop()

  return initialCandidatePortraitPromise
}

async function captureWithMediaPipeFaceCrop(): Promise<string | undefined> {
  const landmarker = createFaceLandmarker()

  try {
    const result = await captureCandidatePortraitImage({ landmarker })

    if (result.ok) {
      return result.stream
    }

    console.warn('Failed to capture candidate portrait image', result.error)
    return undefined
  } finally {
    await Promise.resolve(landmarker.close?.()).catch((error: unknown) => {
      console.warn('Failed to close MediaPipe face landmarker', error)
    })
  }
}
