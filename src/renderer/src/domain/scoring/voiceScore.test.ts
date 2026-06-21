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

  it('returns the neutral value when there is no speech at all (e.g. listening to the interviewer)', () => {
    // pitchVariation=0, speechRate=0はvoiceAnalyzerが「無音」を表すときの組み合わせ。
    // 焦って黙っているのではなく単に話していないだけなので、最大値(100)にしてはいけない。
    const result = calculateVoiceScore({
      timestamp: 0,
      pitchVariation: 0,
      speechRate: 0,
      pauseRatio: 1
    })

    expect(result.value).toBe(50)
  })
})
