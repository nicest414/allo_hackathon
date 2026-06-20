import { describe, expect, it, vi } from 'vitest'
import { createCandidateFaceAnalyzer, toFaceAnalysisResult } from './candidateFaceAnalyzer'
import { createInterviewerFaceAnalyzer } from './interviewerFaceAnalyzer'
import {
  createFaceLandmarker,
  createStubFaceLandmarker,
  type NormalizedFaceLandmark
} from './faceLandmarker'

describe('face analyzers', () => {
  it('returns unknown when the landmarker has no face result', () => {
    const result = toFaceAnalysisResult('candidate', null, 123)

    expect(result).toEqual({
      subject: 'candidate',
      timestamp: 123,
      tensionLevel: 0,
      smileLevel: 0,
      expression: 'unknown'
    })
  })

  it('maps candidate landmarks to FaceAnalysisResult', async () => {
    const analyzer = createCandidateFaceAnalyzer({
      landmarker: createStubFaceLandmarker(smilingLandmarks()),
      now: () => 456
    })

    const result = await analyzer.analyze({} as ImageData)

    expect(result.subject).toBe('candidate')
    expect(result.timestamp).toBe(456)
    expect(result.expression).toBe('smile')
    expect(result.smileLevel).toBeGreaterThan(60)
  })

  it('preserves interviewer subject for screen-frame analysis', async () => {
    const analyzer = createInterviewerFaceAnalyzer({
      landmarker: createStubFaceLandmarker(smilingLandmarks()),
      now: () => 789
    })

    const result = await analyzer.analyze({} as ImageData)

    expect(result.subject).toBe('interviewer')
  })

  it('forwards landmarker cleanup through the analyzer boundary', async () => {
    const close = vi.fn()
    const analyzer = createCandidateFaceAnalyzer({
      landmarker: createFaceLandmarker({
        detect: () => [],
        close
      })
    })

    await analyzer.close?.()

    expect(close).toHaveBeenCalledOnce()
  })
})

function smilingLandmarks(): NormalizedFaceLandmark[] {
  const landmarks = Array.from({ length: 301 }, () => ({ x: 0, y: 0 }))
  landmarks[13] = { x: 0.5, y: 0.48 }
  landmarks[14] = { x: 0.5, y: 0.52 }
  landmarks[33] = { x: 0.3, y: 0.35 }
  landmarks[61] = { x: 0.35, y: 0.5 }
  landmarks[70] = { x: 0.3, y: 0.25 }
  landmarks[263] = { x: 0.7, y: 0.35 }
  landmarks[291] = { x: 0.65, y: 0.5 }
  landmarks[300] = { x: 0.7, y: 0.25 }

  return landmarks
}
