import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDominanceStore } from '../store/useDominanceStore'

vi.mock('../analysis/face/mediapipeFaceLandmarker', () => ({
  createMediaPipeFaceLandmarker: vi.fn()
}))

vi.mock('../capture/portraitFrame', () => ({
  captureCandidatePortraitImage: vi.fn(),
  captureInterviewerPortraitImage: vi.fn()
}))

import { createMediaPipeFaceLandmarker } from '../analysis/face/mediapipeFaceLandmarker'
import {
  captureCandidatePortraitImage,
  captureInterviewerPortraitImage
} from '../capture/portraitFrame'
import {
  captureAndStoreCandidatePortrait,
  captureAndStoreInterviewerPortrait
} from './portraitCaptureService'

const createLandmarker = vi.mocked(createMediaPipeFaceLandmarker)
const captureCandidate = vi.mocked(captureCandidatePortraitImage)
const captureInterviewer = vi.mocked(captureInterviewerPortraitImage)
const close = vi.fn()

describe('portraitCaptureService', () => {
  beforeEach(() => {
    useDominanceStore.getState().reset()
    useDominanceStore.setState({ portraitImageUrls: {} })
    createLandmarker.mockReset()
    captureCandidate.mockReset()
    captureInterviewer.mockReset()
    close.mockReset()
    createLandmarker.mockResolvedValue({ detect: vi.fn(), close })
  })

  describe('captureAndStoreCandidatePortrait', () => {
    it('stores the captured image and closes the landmarker', async () => {
      captureCandidate.mockResolvedValue({ ok: true, stream: 'candidate.png' })

      const result = await captureAndStoreCandidatePortrait()

      expect(result).toBe('candidate.png')
      expect(useDominanceStore.getState().portraitImageUrls.candidate).toBe('candidate.png')
      expect(close).toHaveBeenCalledOnce()
    })

    it('returns undefined and leaves the store untouched when capture fails', async () => {
      captureCandidate.mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'failed' }
      })

      const result = await captureAndStoreCandidatePortrait()

      expect(result).toBeUndefined()
      expect(useDominanceStore.getState().portraitImageUrls.candidate).toBeUndefined()
      expect(close).toHaveBeenCalledOnce()
    })

    it('still captures the portrait when the landmarker fails to initialize', async () => {
      createLandmarker.mockRejectedValue(new Error('init failed'))
      captureCandidate.mockResolvedValue({ ok: true, stream: 'candidate.png' })

      const result = await captureAndStoreCandidatePortrait()

      expect(result).toBe('candidate.png')
      expect(captureCandidate).toHaveBeenCalledWith({ landmarker: undefined })
    })
  })

  describe('captureAndStoreInterviewerPortrait', () => {
    it('stores the captured image for the given screen source', async () => {
      captureInterviewer.mockResolvedValue({ ok: true, stream: 'interviewer.png' })

      const result = await captureAndStoreInterviewerPortrait({ sourceId: 'screen:1' })

      expect(captureInterviewer).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'screen:1' })
      )
      expect(result).toBe('interviewer.png')
      expect(useDominanceStore.getState().portraitImageUrls.interviewer).toBe('interviewer.png')
    })

    it('returns undefined and leaves the store untouched when capture fails', async () => {
      captureInterviewer.mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'failed' }
      })

      const result = await captureAndStoreInterviewerPortrait({ sourceId: 'screen:1' })

      expect(result).toBeUndefined()
      expect(useDominanceStore.getState().portraitImageUrls.interviewer).toBeUndefined()
    })
  })
})
