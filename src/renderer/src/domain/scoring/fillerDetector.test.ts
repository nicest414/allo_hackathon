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

  it('detects Deepgram表記ゆれ（ええと/うーん/んー/あー）', () => {
    const result = detectFillers([
      { timestamp: 0, text: 'ええと、うーん、んー、あー', isFinal: true }
    ])

    expect(result.fillerCount).toBe(4)
  })

  it('連続する長音を畳んで「えーー」を「えー」として検出する', () => {
    const result = detectFillers([{ timestamp: 0, text: 'えーー、そうですね', isFinal: true }])

    expect(result.matchedFillers).toContain('えー')
  })

  it('windowMs 指定時は直近のセグメントのみ集計する（古いフィラーは減衰）', () => {
    const now = 100_000
    const segments = [
      { timestamp: now - 20_000, text: 'えっと えっと えっと', isFinal: true as const }, // 窓外
      { timestamp: now - 1_000, text: 'なんか', isFinal: true as const } // 窓内
    ]

    const windowed = detectFillers(segments, undefined, { windowMs: 10_000, now: () => now })
    expect(windowed.fillerCount).toBe(1) // 窓内の「なんか」だけ

    const all = detectFillers(segments)
    expect(all.fillerCount).toBe(4) // 全件なら4
  })

  it('windowMs 内に新しいセグメントが無ければ score は 0 に戻る（揺れ動く）', () => {
    const now = 100_000
    const segments = [
      { timestamp: now - 30_000, text: 'えっと えっと', isFinal: true as const }
    ]

    const result = detectFillers(segments, undefined, { windowMs: 10_000, now: () => now })
    expect(result.score).toBe(0)
  })

  it('フィラー率で正規化するため、同じ出現回数でも長く話すほどスコアが下がる', () => {
    const shortAnswer = detectFillers([{ timestamp: 0, text: 'えっと、強みです', isFinal: true }])
    const longAnswer = detectFillers([
      {
        timestamp: 0,
        text:
          'えっと、私の強みは学生時代から続けている長期インターンで得た課題解決力です。' +
          '具体的には毎週の定例会で改善案を提案し続けました。',
        isFinal: true
      }
    ])

    expect(shortAnswer.fillerCount).toBe(1)
    expect(longAnswer.fillerCount).toBe(1)
    expect(longAnswer.score).toBeLessThan(shortAnswer.score)
  })
})
