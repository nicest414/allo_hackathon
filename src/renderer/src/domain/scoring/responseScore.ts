import type { ResponseJudgment } from '../../../../shared/types/analysis'

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

const DEFAULT_RESPONSE_SCORE = 50

/**
 * LLM判定(ResponseJudgment)のscoreをそのまま優勢度への寄与として使う。
 * 判定がまだ届いていない場合は中立値(50)を暫定的に返す。
 */
export function calculateResponseScore(judgment: ResponseJudgment | undefined): number {
  if (judgment === undefined || Number.isNaN(judgment.score)) {
    return DEFAULT_RESPONSE_SCORE
  }

  return clamp(judgment.score)
}
