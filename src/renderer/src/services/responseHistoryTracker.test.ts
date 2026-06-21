import { describe, expect, it } from 'vitest'
import { createResponseHistoryTracker } from './responseHistoryTracker'

describe('responseHistoryTracker', () => {
  it('質問が変わるとき、直前の質問×回答ペアを履歴に積む', () => {
    const tracker = createResponseHistoryTracker()
    tracker.recordTurn({ question: 'Q1', answer: 'A1' })
    expect(tracker.getHistory()).toEqual([])

    tracker.onQuestionChange('Q2')
    expect(tracker.getHistory()).toEqual([{ question: 'Q1', answer: 'A1' }])
  })

  it('同一質問への再設定では積まない（重複防止）', () => {
    const tracker = createResponseHistoryTracker()
    tracker.recordTurn({ question: 'Q1', answer: 'A1' })
    tracker.onQuestionChange('Q1')
    expect(tracker.getHistory()).toEqual([])
  })

  it('judge呼び出しが一度も無いまま質問が変わっても何も積まない', () => {
    const tracker = createResponseHistoryTracker()
    tracker.onQuestionChange('Q1')
    expect(tracker.getHistory()).toEqual([])
  })

  it('同じ質問内で複数回recordTurnされても、積まれるのは最後の1件のみ', () => {
    const tracker = createResponseHistoryTracker()
    tracker.recordTurn({ question: 'Q1', answer: 'A1途中' })
    tracker.recordTurn({ question: 'Q1', answer: 'A1途中 続き' })
    tracker.onQuestionChange('Q2')
    expect(tracker.getHistory()).toEqual([{ question: 'Q1', answer: 'A1途中 続き' }])
  })

  it('maxTurnsを超えたら古いものから捨てる', () => {
    const tracker = createResponseHistoryTracker(2)
    tracker.recordTurn({ question: 'Q1', answer: 'A1' })
    tracker.onQuestionChange('Q2')
    tracker.recordTurn({ question: 'Q2', answer: 'A2' })
    tracker.onQuestionChange('Q3')
    tracker.recordTurn({ question: 'Q3', answer: 'A3' })
    tracker.onQuestionChange('Q4')

    expect(tracker.getHistory()).toEqual([
      { question: 'Q2', answer: 'A2' },
      { question: 'Q3', answer: 'A3' }
    ])
  })

  it('resetで履歴と保留中ターンを破棄する', () => {
    const tracker = createResponseHistoryTracker()
    tracker.recordTurn({ question: 'Q1', answer: 'A1' })
    tracker.onQuestionChange('Q2')
    tracker.reset()
    expect(tracker.getHistory()).toEqual([])

    tracker.onQuestionChange('Q3')
    expect(tracker.getHistory()).toEqual([])
  })
})
