import type { LlmJudgeResponseRequest, LlmJudgeResponseResult } from '../../../shared/types/ipc'

/**
 * LLM判定のrenderer側窓口（薄いIPCラッパー）。
 * ロジックは持たず、preloadで公開された `window.allo.llm` を呼ぶだけ。
 * 結果は `responseScore.ts` でスコア化しやすい `score`/`reason` 形式で返る。
 */
export function judgeResponse(
  request: LlmJudgeResponseRequest
): Promise<LlmJudgeResponseResult> {
  return window.allo.llm.judgeResponse(request)
}
