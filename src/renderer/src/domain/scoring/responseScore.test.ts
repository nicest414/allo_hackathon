import { describe, expect, it } from 'vitest'
import { calculateResponseScore } from './responseScore'

describe('calculateResponseScore', () => {
  it('returns the judgment score unchanged when within range', () => {
    expect(
      calculateResponseScore({ question: 'q', answer: 'a', score: 80, reason: 'good' })
    ).toBe(80)
  })

  it('clamps scores above 100', () => {
    expect(
      calculateResponseScore({ question: 'q', answer: 'a', score: 150, reason: 'bad input' })
    ).toBe(100)
  })

  it('clamps scores below 0', () => {
    expect(
      calculateResponseScore({ question: 'q', answer: 'a', score: -20, reason: 'bad input' })
    ).toBe(0)
  })

  it('returns a neutral default when no judgment is available yet', () => {
    expect(calculateResponseScore(undefined)).toBe(50)
  })

  it('returns a neutral default when the score is NaN', () => {
    expect(
      calculateResponseScore({ question: 'q', answer: 'a', score: Number.NaN, reason: 'n/a' })
    ).toBe(50)
  })
})
