import type { LlmJudgeResponseRequest } from '../../../shared/types/ipc'

/**
 * 面接官の質問と就活生の回答を「ターン」として管理し、沈黙検知で自動判定を発火する
 * pure TS ロジック（Reactに非依存・テスト可能）。
 *
 * - setQuestion(): 新しい質問が来たら回答蓄積をリセット（新ターン開始）
 * - addAnswer():  回答セグメントを蓄積し、沈黙タイマーを張り直す
 * - 沈黙(silenceMs)継続で maybeEmit() → 条件を満たせば onTurn(質問,回答) を1回発火
 *
 * トークン浪費を防ぐため、空入力・極短回答(minAnswerLength未満)は発火しない。
 * 同一ペアの重複判定防止(dedup)は呼び出し先の responseJudger 側で担う。
 */

export interface ResponseTurnTrackerOptions {
  /** 沈黙→判定発火のコールバック。 */
  onTurn: (request: LlmJudgeResponseRequest) => void
  /** 回答の最後のセグメントからこの時間(ms)沈黙したら発火。既定2500。 */
  silenceMs?: number
  /** これ未満の文字数の回答は発火しない（「はい」等の無駄打ち防止）。既定4。 */
  minAnswerLength?: number
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export interface ResponseTurnTracker {
  setQuestion: (text: string) => void
  addAnswer: (text: string) => void
  reset: () => void
  dispose: () => void
}

const DEFAULT_SILENCE_MS = 2500
const DEFAULT_MIN_ANSWER_LENGTH = 4

export function createResponseTurnTracker(
  options: ResponseTurnTrackerOptions
): ResponseTurnTracker {
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS
  const minAnswerLength = options.minAnswerLength ?? DEFAULT_MIN_ANSWER_LENGTH
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))

  let question = ''
  let answerSegments: string[] = []
  let silenceTimer: ReturnType<typeof setTimeout> | undefined

  function clearSilenceTimer(): void {
    if (silenceTimer !== undefined) {
      clearTimer(silenceTimer)
      silenceTimer = undefined
    }
  }

  function maybeEmit(): void {
    silenceTimer = undefined
    const answer = answerSegments.join(' ').trim()

    if (question.trim() === '' || answer.length < minAnswerLength) {
      return
    }

    options.onTurn({ question, answer })
  }

  return {
    setQuestion(text: string): void {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }
      // 新しい質問＝新ターン。前ターンの回答蓄積をリセットする。
      question = trimmed
      answerSegments = []
      clearSilenceTimer()
    },

    addAnswer(text: string): void {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }
      answerSegments.push(trimmed)
      clearSilenceTimer()
      silenceTimer = setTimer(maybeEmit, silenceMs)
    },

    reset(): void {
      clearSilenceTimer()
      question = ''
      answerSegments = []
    },

    dispose(): void {
      clearSilenceTimer()
    }
  }
}
