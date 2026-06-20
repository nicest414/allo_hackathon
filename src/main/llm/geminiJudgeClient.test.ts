import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetMainEnvForTest } from '../env'
import { judgeResponse, parseJudgmentResult } from './geminiJudgeClient'

describe('parseJudgmentResult', () => {
  it('有効なJSONをscore/reasonに変換する', () => {
    const result = parseJudgmentResult('{"score": 73, "reason": "具体的で良い"}')
    expect(result).toEqual({ score: 73, reason: '具体的で良い' })
  })

  it('範囲外・小数のscoreを0〜100の整数に丸める', () => {
    expect(parseJudgmentResult('{"score": 140, "reason": "x"}').score).toBe(100)
    expect(parseJudgmentResult('{"score": -5, "reason": "x"}').score).toBe(0)
    expect(parseJudgmentResult('{"score": 61.7, "reason": "x"}').score).toBe(62)
  })

  it('JSONとして不正な応答はエラーにする', () => {
    expect(() => parseJudgmentResult('not json')).toThrow()
  })
})

describe('judgeResponse', () => {
  const originalKey = process.env.GEMINI_API_KEY

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY
    resetMainEnvForTest()
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY
    } else {
      process.env.GEMINI_API_KEY = originalKey
    }
    resetMainEnvForTest()
  })

  it('APIキー未設定時はスタブ結果を返す（実APIを呼ばない）', async () => {
    const result = await judgeResponse({ question: 'q', answer: 'a' })
    expect(result.score).toBe(50)
    expect(result.reason).toContain('GEMINI_API_KEY')
  })
})
