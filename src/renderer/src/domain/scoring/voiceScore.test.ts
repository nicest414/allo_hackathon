import { describe, expect, it } from 'vitest'
import { calculateVoiceScore } from './voiceScore'

describe('calculateVoiceScore', () => {
  it('returns 0 when there are no pauses, pitch is fully varied, and rate is ideal', () => {
    const result = calculateVoiceScore({
      timestamp: 0,
      pitchVariation: 1,
      speechRate: 6,
      pauseRatio: 0
    })

    expect(result.value).toBe(0)
  })

  it('returns 100 when fully paused and monotone with an extreme speech rate', () => {
    const result = calculateVoiceScore({
      timestamp: 0,
      pitchVariation: 0,
      speechRate: 100,
      pauseRatio: 1
    })

    expect(result.value).toBe(100)
  })

  it('clamps an out-of-range speech rate deviation to 100', () => {
    const result = calculateVoiceScore({
      timestamp: 0,
      pitchVariation: 1,
      speechRate: -50,
      pauseRatio: 0
    })

    expect(result.value).toBeLessThanOrEqual(100)
    expect(result.value).toBeGreaterThanOrEqual(0)
  })
})
