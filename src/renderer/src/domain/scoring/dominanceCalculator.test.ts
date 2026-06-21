import { describe, expect, it } from 'vitest'
import {
  BASE_DOMINANCE_WEIGHTS,
  accumulateResponseScore,
  applyRealtimeFineTune,
  calculateBaseDominance,
  calculateDominance,
  calculateRealtimeFineTune
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

describe('calculateRealtimeFineTune', () => {
  it('returns 0 when the realtime base value is neutral', () => {
    expect(calculateRealtimeFineTune(50)).toBe(0)
  })

  it('adds when the base value is above neutral and subtracts when below', () => {
    expect(calculateRealtimeFineTune(100)).toBeCloseTo(10) // (100-50)*0.2
    expect(calculateRealtimeFineTune(0)).toBeCloseTo(-10)
  })
})

describe('applyRealtimeFineTune', () => {
  it('shifts the LLM response score by the realtime fine-tune and clamps to 0-100', () => {
    expect(applyRealtimeFineTune(50, 100)).toBe(60)
    expect(applyRealtimeFineTune(50, 0)).toBe(40)
    expect(applyRealtimeFineTune(95, 100)).toBe(100) // clamped
    expect(applyRealtimeFineTune(5, 0)).toBe(0) // clamped
  })

  it('keeps the LLM score dominant: a strong answer stays high even with weak delivery', () => {
    // response=85, base=30(緊張気味) -> 微調整は-4止まりで85付近を保つ
    expect(applyRealtimeFineTune(85, 30)).toBe(81)
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
  it('makes the LLM response score the primary value once it arrives', () => {
    const result = calculateDominance({ ...baseInput, response: 100 })

    // base is 50 (uniform) -> fine-tune is 0, so the LLM score passes through
    expect(result.value).toBe(100)
    expect(result.breakdown.response).toBe(100)
  })

  it('falls back to the realtime base value when response is missing', () => {
    const result = calculateDominance(baseInput)

    expect(result.value).toBe(50)
    expect(result.breakdown.response).toBe(50)
  })

  it('carries the timestamp through unchanged', () => {
    const result = calculateDominance({ ...baseInput, timestamp: 42, response: 50 })
    expect(result.timestamp).toBe(42)
  })
})
