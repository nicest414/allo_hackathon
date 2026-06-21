import { describe, expect, it } from 'vitest'
import { calculateTalkRatio } from './talkRatioScore'

describe('calculateTalkRatio', () => {
  it('returns a neutral value when neither side has spoken', () => {
    const result = calculateTalkRatio([], [])

    expect(result).toEqual({ candidateChars: 0, interviewerChars: 0, value: 50 })
  })

  it('returns 100 when only the candidate has spoken', () => {
    const result = calculateTalkRatio(
      [{ timestamp: 0, text: '自己紹介します', isFinal: true }],
      []
    )

    expect(result.value).toBe(100)
  })

  it('returns 0 when only the interviewer has spoken', () => {
    const result = calculateTalkRatio(
      [],
      [{ timestamp: 0, text: '志望動機を教えてください', isFinal: true }]
    )

    expect(result.value).toBe(0)
  })

  it('splits evenly when both sides speak the same amount', () => {
    const result = calculateTalkRatio(
      [{ timestamp: 0, text: 'あいうえお', isFinal: true }],
      [{ timestamp: 0, text: 'かきくけこ', isFinal: true }]
    )

    expect(result.value).toBe(50)
  })

  it('weights toward the side speaking more', () => {
    const result = calculateTalkRatio(
      [{ timestamp: 0, text: 'あいうえおあいうえお', isFinal: true }],
      [{ timestamp: 0, text: 'かきくけこ', isFinal: true }]
    )

    expect(result.candidateChars).toBe(10)
    expect(result.interviewerChars).toBe(5)
    expect(result.value).toBeCloseTo((10 / 15) * 100)
  })

  it('ignores non-final segments', () => {
    const result = calculateTalkRatio(
      [{ timestamp: 0, text: '途中の発話', isFinal: false }],
      [{ timestamp: 0, text: '確定した質問です', isFinal: true }]
    )

    expect(result.candidateChars).toBe(0)
    expect(result.value).toBe(0)
  })

  it('excludes segments outside windowMs (古い発話は減衰する)', () => {
    const now = 100_000
    const result = calculateTalkRatio(
      [{ timestamp: now - 20_000, text: '窓外の発話です', isFinal: true }],
      [{ timestamp: now - 1_000, text: '窓内の質問', isFinal: true }],
      { windowMs: 10_000, now: () => now }
    )

    expect(result.candidateChars).toBe(0)
    expect(result.value).toBe(0)
  })
})
