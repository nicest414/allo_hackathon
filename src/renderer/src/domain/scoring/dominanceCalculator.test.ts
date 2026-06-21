import { describe, expect, it } from 'vitest'
import {
  BASE_DOMINANCE_WEIGHTS,
  accumulateResponseScore,
  applyResponseCorrection,
  calculateBaseDominance,
  calculateDominance,
  calculateResponseCorrection
} from './dominanceCalculator'

const baseInput = {
  timestamp: 1,
  candidateFace: { subject: 'candidate', value: 50 } as const,
  interviewerFace: { subject: 'interviewer', value: 50 } as const,
  voice: { value: 50 },
  filler: { matchedFillers: [], fillerCount: 0, score: 50 },
  talkRatio: { candidateChars: 0, interviewerChars: 0, value: 50 }
}

describe('calculateBaseDominance', () => {
  it('returns 100 when every realtime signal fully favors the candidate', () => {
    const result = calculateBaseDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 100 },
      interviewerFace: { subject: 'interviewer', value: 100 },
      voice: { value: 0 },
      filler: { matchedFillers: [], fillerCount: 0, score: 0 },
      talkRatio: { candidateChars: 100, interviewerChars: 0, value: 100 }
    })

    expect(result.value).toBe(100)
    expect(result.breakdown).toEqual({
      candidateFace: 100,
      interviewerFace: 100,
      voice: 100,
      filler: 100,
      talkRatio: 100
    })
  })

  it('returns 0 when every realtime signal fully favors the interviewer', () => {
    const result = calculateBaseDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 0 },
      interviewerFace: { subject: 'interviewer', value: 0 },
      voice: { value: 100 },
      filler: { matchedFillers: ['なんか'], fillerCount: 20, score: 100 },
      talkRatio: { candidateChars: 0, interviewerChars: 100, value: 0 }
    })

    expect(result.value).toBe(0)
  })

  it('inverts voice and filler scores before weighting them', () => {
    const result = calculateBaseDominance({
      ...baseInput,
      voice: { value: 30 },
      filler: { matchedFillers: [], fillerCount: 1, score: 15 }
    })

    expect(result.breakdown.voice).toBe(70)
    expect(result.breakdown.filler).toBe(85)
  })

  it('does not invert talkRatio (higher means more candidate speaking time)', () => {
    const result = calculateBaseDominance({
      ...baseInput,
      talkRatio: { candidateChars: 80, interviewerChars: 20, value: 80 }
    })

    expect(result.breakdown.talkRatio).toBe(80)
  })

  it('base weights sum to 1 so a uniform realtime input maps to itself', () => {
    const totalWeight = Object.values(BASE_DOMINANCE_WEIGHTS).reduce((sum, w) => sum + w, 0)
    expect(totalWeight).toBeCloseTo(1)

    const result = calculateBaseDominance({
      timestamp: 1,
      candidateFace: { subject: 'candidate', value: 60 },
      interviewerFace: { subject: 'interviewer', value: 60 },
      voice: { value: 40 }, // inverted -> 60
      filler: { matchedFillers: [], fillerCount: 0, score: 40 }, // inverted -> 60
      talkRatio: { candidateChars: 60, interviewerChars: 40, value: 60 }
    })

    expect(result.value).toBeCloseTo(60)
  })
})

describe('calculateResponseCorrection', () => {
  it('returns 0 when the response score is missing (no correction)', () => {
    expect(calculateResponseCorrection(undefined)).toBe(0)
    expect(calculateResponseCorrection(Number.NaN)).toBe(0)
  })

  it('adds when above neutral and subtracts when below neutral', () => {
    expect(calculateResponseCorrection(100)).toBeCloseTo(20) // (100-50)*0.4
    expect(calculateResponseCorrection(0)).toBeCloseTo(-20)
    expect(calculateResponseCorrection(50)).toBe(0)
  })
})

describe('applyResponseCorrection', () => {
  it('shifts the base value by the correction and clamps to 0-100', () => {
    expect(applyResponseCorrection(50, 100)).toBe(70)
    expect(applyResponseCorrection(50, 0)).toBe(30)
    expect(applyResponseCorrection(95, 100)).toBe(100) // clamped
    expect(applyResponseCorrection(5, 0)).toBe(0) // clamped
  })

  it('leaves the base value unchanged when no response score', () => {
    expect(applyResponseCorrection(63, undefined)).toBe(63)
  })
})

describe('accumulateResponseScore', () => {
  it('adopts the latest value when there is no previous score', () => {
    expect(accumulateResponseScore(undefined, 80)).toBe(80)
  })

  it('blends previous and latest with the EMA factor (recent weighted more)', () => {
    // 0.6*40 + 0.4*80 = 56
    expect(accumulateResponseScore(80, 40)).toBeCloseTo(56)
  })
})

describe('calculateDominance (two-stage convenience)', () => {
  it('applies the LLM correction on top of the base dominance', () => {
    const result = calculateDominance({ ...baseInput, response: 100 })

    // base is 50 (uniform), correction +20 -> 70
    expect(result.value).toBe(70)
    expect(result.breakdown.response).toBe(100)
  })

  it('uses neutral response in the breakdown and no correction when response is missing', () => {
    const result = calculateDominance(baseInput)

    expect(result.value).toBe(50)
    expect(result.breakdown.response).toBe(50)
  })

  it('carries the timestamp through unchanged', () => {
    const result = calculateDominance({ ...baseInput, timestamp: 42, response: 50 })
    expect(result.timestamp).toBe(42)
  })
})
