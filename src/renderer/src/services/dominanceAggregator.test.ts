import { describe, expect, it } from 'vitest'
import {
  type ComposedDominance,
  composeDominance,
  createDominanceAggregator
} from './dominanceAggregator'

describe('composeDominance', () => {
  it('全入力が欠損なら基礎50・補正なしの中立になる', () => {
    const result = composeDominance({}, 1)

    expect(result.baseDominance).toBe(50)
    expect(result.dominance).toBe(50)
    expect(result.breakdown).toEqual({
      candidateFace: 50,
      interviewerFace: 50,
      voice: 50,
      filler: 50,
      response: 50
    })
  })

  it('返答スコアは基礎優勢度への補正として効く', () => {
    expect(composeDominance({ response: 100 }, 1).dominance).toBe(70) // 50 + (100-50)*0.4
    expect(composeDominance({ response: 0 }, 1).dominance).toBe(30)
    expect(composeDominance({ response: 100 }, 1).baseDominance).toBe(50) // 基礎は4項目のみ
  })

  it('リアルタイム項目の欠損は中立、与えた項目だけ反映する', () => {
    const result = composeDominance({ candidateFace: { subject: 'candidate', value: 100 } }, 1)
    // candidateFace重み0.4 → 100*0.4 + 50*0.6 = 70
    expect(result.baseDominance).toBeCloseTo(70)
  })
})

describe('createDominanceAggregator', () => {
  function setup() {
    const changes: ComposedDominance[] = []
    const scheduled: Array<{ cb: () => void; ms: number }> = []
    let clock = 1000

    const aggregator = createDominanceAggregator({
      onChange: (result) => changes.push(result),
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
      changes,
      scheduled,
      setClock: (value: number) => {
        clock = value
      }
    }
  }

  it('間隔が空いていれば即時に再計算を通知する（leading）', () => {
    const { aggregator, changes } = setup()

    aggregator.reportResponse(100)

    expect(changes).toHaveLength(1)
    expect(changes[0].dominance).toBe(70)
  })

  it('最小間隔内の連続reportは末尾で1回だけ反映する（trailing）', () => {
    const { aggregator, changes, scheduled, setClock } = setup()

    aggregator.reportResponse(100) // leading emit @1000
    setClock(1050)
    aggregator.reportResponse(0) // 50ms後 → 即時emitせずschedule
    aggregator.reportResponse(100) // さらに更新しても二重scheduleしない

    expect(changes).toHaveLength(1)
    expect(scheduled).toHaveLength(1)

    setClock(1100)
    scheduled[0].cb() // trailing flush

    expect(changes).toHaveLength(2)
    expect(changes[1].dominance).toBe(70) // 最後にreportした値が反映される
  })

  it('resetで集約状態と間隔を初期化する', () => {
    const { aggregator, changes, setClock } = setup()

    aggregator.reportResponse(0) // emit @1000
    setClock(1050)
    aggregator.reset()
    aggregator.reportResponse(100) // resetでlastEmitが戻るので即時emit

    expect(changes).toHaveLength(2)
    expect(changes[1].dominance).toBe(70)
  })
})
