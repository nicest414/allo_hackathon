import type { LlmJudgeResponseRequest, LlmJudgeResponseResult } from '../../../shared/types/ipc'
import { judgeResponse as defaultJudge } from './llmJudgeService'

/**
 * LLM返答判定の呼び出し制御（pure TS / Reactに非依存）。
 *
 * 発話単位で judgeResponse() を呼ぶ際、以下を制御して過剰リクエストを防ぐ:
 * - in-flightロック: 判定中の重複呼び出しを弾く
 * - 最小間隔throttle: 直近の呼び出しから一定時間内は弾く
 * - 空入力スキップ: 質問/返答が空なら呼ばない
 *
 * 失敗時は中立スコア(50)と理由を返し、UI/Storeを止めない。
 * スコアの重み付けや補正は責務外（#33）。ここは「呼ぶかどうか」だけを担う。
 */

const NEUTRAL_SCORE = 50
const DEFAULT_MIN_INTERVAL_MS = 1500

export type ResponseJudgeOutcome =
  | { status: 'ok'; result: LlmJudgeResponseResult }
  | { status: 'error'; result: LlmJudgeResponseResult }
  | { status: 'skipped'; reason: 'busy' | 'throttled' | 'empty' | 'duplicate' }

export interface ResponseJudgerOptions {
  /** 実呼び出し関数（テストで差し替え可能）。既定はIPC窓口。 */
  judge?: (request: LlmJudgeResponseRequest) => Promise<LlmJudgeResponseResult>
  /** 直近の呼び出しからこの時間(ms)内の再呼び出しを弾く。 */
  minIntervalMs?: number
  /** 現在時刻取得（テスト用）。 */
  now?: () => number
}

export interface ResponseJudger {
  judge: (request: LlmJudgeResponseRequest) => Promise<ResponseJudgeOutcome>
}

export function createResponseJudger(options: ResponseJudgerOptions = {}): ResponseJudger {
  const judgeFn = options.judge ?? defaultJudge
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = options.now ?? Date.now

  let inFlight = false
  let lastCallAt = Number.NEGATIVE_INFINITY
  let lastJudged: LlmJudgeResponseRequest | undefined

  return {
    async judge(request) {
      if (!request.question.trim() || !request.answer.trim()) {
        return { status: 'skipped', reason: 'empty' }
      }

      if (inFlight) {
        return { status: 'skipped', reason: 'busy' }
      }

      if (now() - lastCallAt < minIntervalMs) {
        return { status: 'skipped', reason: 'throttled' }
      }

      // 直近に判定したのと同一の質問×回答は再判定しない（トークン浪費防止）。
      if (
        lastJudged &&
        lastJudged.question === request.question &&
        lastJudged.answer === request.answer
      ) {
        return { status: 'skipped', reason: 'duplicate' }
      }

      inFlight = true

      try {
        const result = await judgeFn(request)
        lastJudged = { question: request.question, answer: request.answer }
        return { status: 'ok', result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          status: 'error',
          result: { score: NEUTRAL_SCORE, reason: `判定に失敗しました: ${message}` }
        }
      } finally {
        lastCallAt = now()
        inFlight = false
      }
    }
  }
}
