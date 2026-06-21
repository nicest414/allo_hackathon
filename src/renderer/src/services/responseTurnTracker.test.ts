import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmJudgeResponseRequest } from '../../../shared/types/ipc'
import { createResponseTurnTracker, isBackchannelUtterance } from './responseTurnTracker'

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

  it('次の質問が来たタイミングで、前ターンの回答を即時発火する', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('志望動機は？')
    tracker.addAnswer('御社の理念に共感した')
    tracker.addAnswer('からです')

    expect(turns).toHaveLength(0) // 次の質問が来るまでは発火しない

    tracker.setQuestion('次の質問です')

    expect(turns).toEqual([
      { question: '志望動機は？', answer: '御社の理念に共感した からです' }
    ])
  })

  it('次の質問が来ないまま沈黙が続いた場合は、フォールバックタイマーで発火する', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('志望動機は？')
    tracker.addAnswer('御社の理念に共感したからです')

    expect(turns).toHaveLength(0)
    vi.advanceTimersByTime(2500)

    expect(turns).toEqual([
      { question: '志望動機は？', answer: '御社の理念に共感したからです' }
    ])
  })

  it('相槌（はい・聞こえております等）はターン境界にせず、蓄積中の回答を消さない', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('聞こえていますか？')
    tracker.addAnswer('はい、聞こえております')
    tracker.setQuestion('はい') // 面接官の相槌。本物の質問として扱わない
    tracker.setQuestion('聞こえております。') // これも相槌
    tracker.addAnswer('続きを話します')
    tracker.setQuestion('では次の質問です')

    expect(turns).toEqual([
      { question: '聞こえていますか？', answer: 'はい、聞こえております 続きを話します' }
    ])
  })

  it('連続発話中はフォールバックタイマーが張り直され、沈黙まで発火しない', () => {
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

  it('回答未着手のまま短時間で続けて質問が届いた場合は、STTの確定区切りでの分裂とみなして連結する', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Webの技術について')
    vi.advanceTimersByTime(1000)
    tracker.setQuestion('何でも話してください') // 回答が始まっていないので分裂とみなし連結する
    tracker.addAnswer('Reactを使っています')
    vi.advanceTimersByTime(2500)

    expect(turns).toEqual([
      { question: 'Webの技術について 何でも話してください', answer: 'Reactを使っています' }
    ])
  })

  it('回答未着手でも質問の間隔が questionMergeGapMs を超えていれば、別の新しい質問として扱う', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q1')
    vi.advanceTimersByTime(3500) // questionMergeGapMs(既定3000)を超える
    tracker.setQuestion('Q2') // Q1には回答が無いため発火しないが、Q1は捨てられQ2に切り替わる
    tracker.addAnswer('Q2への回答')
    vi.advanceTimersByTime(2500)

    expect(turns).toEqual([{ question: 'Q2', answer: 'Q2への回答' }])
  })

  it('回答が始まった後に届く質問は、間隔が短くても新しい質問として扱う（前ターンを発火する）', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q1')
    tracker.addAnswer('Q1への回答')
    tracker.setQuestion('Q2') // 回答が既に始まっているので連結せず新ターンへ切り替える
    tracker.addAnswer('Q2への回答')
    vi.advanceTimersByTime(2500)

    expect(turns).toEqual([
      { question: 'Q1', answer: 'Q1への回答' },
      { question: 'Q2', answer: 'Q2への回答' }
    ])
  })

  it('新しい質問が来たら、前ターンを発火してから回答蓄積をリセットする', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q1')
    tracker.addAnswer('Q1への回答')
    tracker.setQuestion('Q2') // Q1のターンを即時発火してから切り替え
    tracker.addAnswer('Q2への回答')
    vi.advanceTimersByTime(2500) // Q2はフォールバックタイマーで発火

    expect(turns).toEqual([
      { question: 'Q1', answer: 'Q1への回答' },
      { question: 'Q2', answer: 'Q2への回答' }
    ])
  })

  it('reset でタイマーと状態を破棄する（確定発火しない）', () => {
    const { tracker, turns } = setup()
    tracker.setQuestion('Q')
    tracker.addAnswer('回答テキスト')
    tracker.reset()
    vi.advanceTimersByTime(2500)
    expect(turns).toHaveLength(0)
  })

  describe('isBackchannelUtterance', () => {
    it('定型句は相槌と判定する', () => {
      expect(isBackchannelUtterance('はい')).toBe(true)
      expect(isBackchannelUtterance('聞こえております。')).toBe(true)
      expect(isBackchannelUtterance('なるほどですね')).toBe(true)
    })

    it('相槌に前方一致するだけの実質的な質問/指示は相槌と判定しない', () => {
      expect(isBackchannelUtterance('はい。お願いいたします。')).toBe(false)
      expect(isBackchannelUtterance('自由にお話ししていただけませんか。')).toBe(false)
    })
  })
})
