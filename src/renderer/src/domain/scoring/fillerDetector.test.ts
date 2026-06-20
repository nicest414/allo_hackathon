import { describe, expect, it } from 'vitest'
import { detectFillers } from './fillerDetector'

describe('detectFillers', () => {
  it('returns a score of 0 when there are no segments', () => {
    const result = detectFillers([])

    expect(result).toEqual({ matchedFillers: [], fillerCount: 0, score: 0 })
  })

  it('ignores non-final segments', () => {
    const result = detectFillers([
      { timestamp: 0, text: 'えーと', isFinal: false },
      { timestamp: 1, text: '本日はよろしくお願いします', isFinal: true }
    ])

    expect(result.fillerCount).toBe(0)
  })

  it('counts multiple occurrences of the same filler word across segments', () => {
    const result = detectFillers([
      { timestamp: 0, text: 'えっと、自己紹介します', isFinal: true },
      { timestamp: 1, text: 'えっと、強みは行動力です', isFinal: true }
    ])

    expect(result.fillerCount).toBe(2)
    expect(result.matchedFillers).toContain('えっと')
  })

  it('does not double-count a longer filler word as a shorter substring filler', () => {
    const result = detectFillers([{ timestamp: 0, text: 'あのー、それでは', isFinal: true }])

    expect(result.fillerCount).toBe(1)
    expect(result.matchedFillers).toEqual(['あのー'])
  })

  it('scales the score with the filler count and clamps at 100', () => {
    const manyFillers = Array.from({ length: 10 }, (_, index) => ({
      timestamp: index,
      text: 'なんか',
      isFinal: true as const
    }))

    const result = detectFillers(manyFillers)

    expect(result.fillerCount).toBe(10)
    expect(result.score).toBe(100)
  })

  it('supports a custom filler word list', () => {
    const result = detectFillers(
      [{ timestamp: 0, text: 'つまり、本質的には', isFinal: true }],
      ['つまり']
    )

    expect(result.matchedFillers).toEqual(['つまり'])
    expect(result.fillerCount).toBe(1)
  })
})
