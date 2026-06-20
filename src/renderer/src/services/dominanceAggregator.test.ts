import { describe, expect, it } from 'vitest'
import { type DominanceScoreUpdate, createDominanceAggregator } from './dominanceAggregator'

describe('createDominanceAggregator', () => {
  function setup() {
    const flushes: DominanceScoreUpdate[] = []
    const scheduled: Array<{ cb: () => void; ms: number }> = []
    let clock = 1000

    const aggregator = createDominanceAggregator({
      onFlush: (update) => flushes.push(update),
      minIntervalMs: 100,
      now: () => clock,
      schedule: (cb, ms) => {
        scheduled.push({ cb, ms })
        return scheduled.length - 1
      },
      cancel: () => {}
    })

    return {
      aggregator,
      flushes,
      scheduled,
      setClock: (value: number) => {
        clock = value
      }
    }
  }

  it('型付き分析結果をStoreが扱う数値スコアへ変換して即時反映する（leading）', () => {
    const { aggregator, flushes } = setup()

    aggregator.reportCandidateFace({ subject: 'candidate', value: 80 })

    expect(flushes).toEqual([{ candidateFace: 80 }])
  })

  it('voice/fillerは生スコアをそのまま渡す（反転はStore側）', () => {
    const { aggregator, flushes } = setup()

    aggregator.reportVoice({ value: 70 })

    expect(flushes).toEqual([{ voice: 70 }])
  })

  it('最小間隔内の連続reportは1回にまとめて末尾で反映する（trailing）', () => {
    const { aggregator, flushes, scheduled, setClock } = setup()

    aggregator.reportCandidateFace({ subject: 'candidate', value: 80 }) // leading flush @1000
    setClock(1050)
    aggregator.reportVoice({ value: 70 }) // 50ms後 → scheduleのみ
    aggregator.reportResponse(90) // 同じ保留にマージ

    expect(flushes).toHaveLength(1)
    expect(scheduled).toHaveLength(1)

    setClock(1100)
    scheduled[0].cb() // trailing flush

    expect(flushes).toHaveLength(2)
    expect(flushes[1]).toEqual({ voice: 70, response: 90 })
  })

  it('保留が無ければflushは何もしない', () => {
    const { aggregator, flushes } = setup()

    aggregator.flush()

    expect(flushes).toHaveLength(0)
  })

  it('resetで保留と間隔を初期化する', () => {
    const { aggregator, flushes, setClock } = setup()

    aggregator.reportResponse(40) // flush @1000
    setClock(1050)
    aggregator.reportResponse(90) // scheduleされ保留
    aggregator.reset() // 保留破棄・間隔リセット

    aggregator.reportResponse(60) // resetでlastFlushが戻るので即時flush

    expect(flushes).toEqual([{ response: 40 }, { response: 60 }])
  })
})
