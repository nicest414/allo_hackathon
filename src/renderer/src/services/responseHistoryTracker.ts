import type { LlmJudgeHistoryTurn } from '../../../shared/types/ipc'

/**
 * LLM判定に渡す「これまでの質疑」履歴を管理する pure TS ロジック（Reactに非依存・テスト可能）。
 *
 * - recordTurn(): そのターンで観測した最新の質問×回答ペアを保留しておく（judge呼び出しの度に上書き）。
 *   1ターン内で複数回呼ばれても（沈黙のたびに再判定が走るケース）、保留されるのは最後の1件のみ。
 * - onQuestionChange(): 質問が切り替わるタイミングで呼ぶ。保留中のペアがあれば履歴に積んでクリアする。
 *   同じ質問への再設定（テキスト同一）では積まない（重複防止）。
 * - 履歴は直近 maxTurns 件のみ保持し、古いものは自然に落ちる。
 */

export const DEFAULT_MAX_HISTORY_TURNS = 3

export interface ResponseHistoryTracker {
  recordTurn: (turn: LlmJudgeHistoryTurn) => void
  onQuestionChange: (nextQuestion: string) => void
  getHistory: () => LlmJudgeHistoryTurn[]
  reset: () => void
}

export function createResponseHistoryTracker(
  maxTurns: number = DEFAULT_MAX_HISTORY_TURNS
): ResponseHistoryTracker {
  let history: LlmJudgeHistoryTurn[] = []
  let pendingTurn: LlmJudgeHistoryTurn | null = null

  return {
    recordTurn(turn: LlmJudgeHistoryTurn): void {
      pendingTurn = turn
    },

    onQuestionChange(nextQuestion: string): void {
      const trimmedNext = nextQuestion.trim()

      if (pendingTurn !== null && pendingTurn.question !== trimmedNext) {
        history = [...history, pendingTurn].slice(-maxTurns)
      }

      pendingTurn = null
    },

    getHistory(): LlmJudgeHistoryTurn[] {
      return history
    },

    reset(): void {
      history = []
      pendingTurn = null
    }
  }
}
