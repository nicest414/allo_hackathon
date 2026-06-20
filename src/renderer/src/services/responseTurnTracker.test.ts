import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmJudgeResponseRequest } from '../../../shared/types/ipc'
import { createResponseTurnTracker } from './responseTurnTracker'

describe('responseTurnTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(silenceMs = 2500, minAnswerLength = 4) {
    const turns: LlmJudgeResponseRequest[] = []
    const tracker = createResponseTurnTracker({
      onTurn: (request) => turns.push(request),
      silenceMs,
      minAnswerLength
    })
    return { tracker, turns }
  }

  it('質問の後、回答→沈黙で1回だけ発火する', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('志望動機は？')
    tracker.addAnswer('御社の理念に共感したからです')

    expect(turns).toHaveLength(0) // 沈黙前は発火しない
    vi.advanceTimersByTime(2500)

    expect(turns).toEqual([
      { question: '志望動機は？', answer: '御社の理念に共感したからです' }
    ])
  })

  it('連続発話中はタイマーが張り直され、沈黙まで発火しない', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q')
    tracker.addAnswer('まず結論として')
    vi.advanceTimersByTime(2000)
    tracker.addAnswer('課題解決力が強みです') // タイマー張り直し
    vi.advanceTimersByTime(2000)
    expect(turns).toHaveLength(0)

    vi.advanceTimersByTime(500)
    expect(turns).toHaveLength(1)
    expect(turns[0].answer).toBe('まず結論として 課題解決力が強みです')
  })

  it('追加発話が無ければ（タイマー再アームが無ければ）再発火しない', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q')
    tracker.addAnswer('回答テキスト')
    vi.advanceTimersByTime(2500)
    expect(turns).toHaveLength(1)

    // 新たな addAnswer が無いので、時間が進んでも再発火しない
    vi.advanceTimersByTime(5000)
    expect(turns).toHaveLength(1)
  })

  it('minAnswerLength 未満の極短回答は発火しない', () => {
    const { tracker, turns } = setup(2500, 4)
    tracker.setQuestion('Q')
    tracker.addAnswer('はい')
    vi.advanceTimersByTime(2500)
    expect(turns).toHaveLength(0)
  })

  it('質問が無ければ発火しない', () => {
    const { tracker, turns } = setup()
    tracker.addAnswer('質問前に話した内容')
    vi.advanceTimersByTime(2500)
    expect(turns).toHaveLength(0)
  })

  it('新しい質問が来たら回答蓄積をリセットする', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q1')
    tracker.addAnswer('Q1への回答')
    tracker.setQuestion('Q2') // リセット
    tracker.addAnswer('Q2への回答')
    vi.advanceTimersByTime(2500)

    expect(turns).toEqual([{ question: 'Q2', answer: 'Q2への回答' }])
  })

  it('reset でタイマーと状態を破棄する', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q')
    tracker.addAnswer('回答テキスト')
    tracker.reset()
    vi.advanceTimersByTime(2500)
    expect(turns).toHaveLength(0)
  })
})
