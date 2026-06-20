import { useEffect } from 'react'
import { captureAndStoreCandidatePortrait } from '../../services/portraitCaptureService'
import { useDominanceStore } from '../../store/useDominanceStore'

let initialCandidatePortraitPromise: Promise<string | undefined> | undefined

export function useInitialCandidatePortraitImage(): void {
  const candidatePortraitImageUrl = useDominanceStore((state) => state.portraitImageUrls.candidate)

  useEffect(() => {
    if (candidatePortraitImageUrl !== undefined) {
      return
    }

    initialCandidatePortraitPromise ??= captureAndStoreCandidatePortrait()

    void initialCandidatePortraitPromise.catch((error: unknown) => {
      console.warn('Failed to initialize candidate portrait image', error)
    })
  }, [candidatePortraitImageUrl])
}
