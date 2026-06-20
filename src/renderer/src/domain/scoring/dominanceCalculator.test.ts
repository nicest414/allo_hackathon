import { describe, expect, it } from 'vitest'
import { DOMINANCE_WEIGHTS, calculateDominance } from './dominanceCalculator'

describe('calculateDominance', () => {
  it('returns 100 when every signal fully favors the candidate', () => {
    const result = calculateDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 100 },
      interviewerFace: { subject: 'interviewer', value: 100 },
      voice: { value: 0 },
      filler: { matchedFillers: [], fillerCount: 0, score: 0 },
      response: 100
    })

    expect(result.value).toBe(100)
    expect(result.breakdown).toEqual({
      candidateFace: 100,
      interviewerFace: 100,
      voice: 100,
      filler: 100,
      response: 100
    })
  })

  it('returns 0 when every signal fully favors the interviewer', () => {
    const result = calculateDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 0 },
      interviewerFace: { subject: 'interviewer', value: 0 },
      voice: { value: 100 },
      filler: { matchedFillers: ['なんか'], fillerCount: 20, score: 100 },
      response: 0
    })

    expect(result.value).toBe(0)
    expect(result.breakdown).toEqual({
      candidateFace: 0,
      interviewerFace: 0,
      voice: 0,
      filler: 0,
      response: 0
    })
  })

  it('inverts voice and filler scores before weighting them', () => {
    const result = calculateDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 50 },
      interviewerFace: { subject: 'interviewer', value: 50 },
      voice: { value: 30 },
      filler: { matchedFillers: [], fillerCount: 1, score: 15 },
      response: 50
    })

    expect(result.breakdown.voice).toBe(70)
    expect(result.breakdown.filler).toBe(85)
  })

  it('carries the timestamp through unchanged', () => {
    const result = calculateDominance({
      timestamp: 42,
      candidateFace: { subject: 'candidate', value: 50 },
      interviewerFace: { subject: 'interviewer', value: 50 },
      voice: { value: 50 },
      filler: { matchedFillers: [], fillerCount: 0, score: 0 },
      response: 50
    })

    expect(result.timestamp).toBe(42)
  })

  it('weights sum to 1 so a uniform input maps to itself', () => {
    const totalWeight = Object.values(DOMINANCE_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
    expect(totalWeight).toBeCloseTo(1)

    const result = calculateDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 60 },
      interviewerFace: { subject: 'interviewer', value: 60 },
      voice: { value: 40 },
      filler: { matchedFillers: [], fillerCount: 0, score: 40 },
      response: 60
    })

    expect(result.value).toBeCloseTo(60)
  })
})
