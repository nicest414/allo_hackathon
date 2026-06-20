import { useEffect } from 'react'
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

    void getInitialCandidatePortraitImage().then((imageUrl) => {
      if (!cancelled && imageUrl !== undefined) {
        setCandidatePortraitImageUrl(imageUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [candidatePortraitImageUrl, setCandidatePortraitImageUrl])
}

function getInitialCandidatePortraitImage(): Promise<string | undefined> {
  initialCandidatePortraitPromise ??= captureCandidatePortraitImage().then((result) => {
    if (result.ok) {
      return result.stream
    }

    console.warn('Failed to capture candidate portrait image', result.error)
    return undefined
  })

  return initialCandidatePortraitPromise
}
