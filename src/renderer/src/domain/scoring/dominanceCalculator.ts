import type {
  DominanceScore,
  DominanceScoreBreakdown,
  FaceScore,
  FillerDetectionResult,
  VoiceScore
} from '../../../../shared/types/analysis'

/**
 * 優勢度は二段階で求める:
 *   1) リアルタイム4項目（候補者顔/面接官顔/声/フィラー）から「基礎優勢度」を粗く算出
 *   2) LLM返答判定が届いたら、その結果で基礎優勢度を「補正」する
 *
 * 補正は重み付け再合成ではなく delta 方式を採用した。返答内容スコアの中立(50)からの
 * 差分に影響度を掛けて基礎優勢度へ加算する。これにより、LLM未到達の間も4項目だけで
 * 優劣が動き、LLMは「上振れ/下振れさせる補正」として効く（並列加重平均では二段階に
 * ならず、LLM未到達時の中立50埋めが常時平均へ混ざってしまうため）。
 */

export interface BaseDominanceInput {
  timestamp: number
  candidateFace: FaceScore
  interviewerFace: FaceScore
  voice: VoiceScore
  filler: FillerDetectionResult
}

/** リアルタイム4項目の重み（合計1）。実データに合わせて調整できるよう定数化。 */
export const BASE_DOMINANCE_WEIGHTS = {
  candidateFace: 0.4,
  interviewerFace: 0.2,
  voice: 0.25,
  filler: 0.15
} as const

/** 返答内容スコアの中立値。これより上なら加点、下なら減点の補正になる。 */
export const NEUTRAL_RESPONSE_SCORE = 50

/**
 * LLM補正の影響度。responseScoreが0/100のとき最大 ±(50 * influence) の補正になる。
 * 大きすぎるとリアルタイム4項目の意味が薄れ、小さすぎると補正にならないため暫定0.4(=最大±20)。
 */
export const RESPONSE_CORRECTION_INFLUENCE = 0.4

/** 質問内で複数回判定が届く場合のEMA係数（直近を重視し古い判定を減衰させる）。 */
export const RESPONSE_SCORE_SMOOTHING = 0.6

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

export type BaseDominanceBreakdown = Omit<DominanceScoreBreakdown, 'response'>

export interface BaseDominance {
  timestamp: number
  value: number
  breakdown: BaseDominanceBreakdown
}

/**
 * 第1段階: リアルタイム4項目から基礎優勢度を算出する。
 * voice/fillerは値が大きいほど「焦り・フィラーが多い」ので100から引いて反転させる。
 */
export function calculateBaseDominance(input: BaseDominanceInput): BaseDominance {
  const breakdown: BaseDominanceBreakdown = {
    candidateFace: clamp(input.candidateFace.value),
    interviewerFace: clamp(input.interviewerFace.value),
    voice: clamp(100 - input.voice.value),
    filler: clamp(100 - input.filler.score)
  }

  const value = clamp(
    breakdown.candidateFace * BASE_DOMINANCE_WEIGHTS.candidateFace +
      breakdown.interviewerFace * BASE_DOMINANCE_WEIGHTS.interviewerFace +
      breakdown.voice * BASE_DOMINANCE_WEIGHTS.voice +
      breakdown.filler * BASE_DOMINANCE_WEIGHTS.filler
  )

  return { timestamp: input.timestamp, value, breakdown }
}

/**
 * 返答内容スコアから補正量(delta)を求める。未到達(undefined/NaN)なら0（補正なし）。
 */
export function calculateResponseCorrection(responseScore: number | undefined): number {
  if (responseScore === undefined || Number.isNaN(responseScore)) {
    return 0
  }

  return (clamp(responseScore) - NEUTRAL_RESPONSE_SCORE) * RESPONSE_CORRECTION_INFLUENCE
}

/**
 * 第2段階: 基礎優勢度へLLM補正を適用する。
 */
export function applyResponseCorrection(
  baseValue: number,
  responseScore: number | undefined
): number {
  return clamp(baseValue + calculateResponseCorrection(responseScore))
}

/**
 * 質問内で判定が複数回届く場合の蓄積。直近を重視するEMAで、古い判定は自然に減衰する。
 * previousが無ければ最新値をそのまま採用する。
 */
export function accumulateResponseScore(
  previous: number | undefined,
  latest: number,
  alpha: number = RESPONSE_SCORE_SMOOTHING
): number {
  const clampedLatest = clamp(latest)

  if (previous === undefined || Number.isNaN(previous)) {
    return clampedLatest
  }

  return clamp(alpha * clampedLatest + (1 - alpha) * clamp(previous))
}

export interface DominanceCalculatorInput extends BaseDominanceInput {
  /** LLM返答判定スコア(0-100)。未到達ならundefinedで補正なし。 */
  response?: number
}

/**
 * 基礎優勢度の算出 → LLM補正の適用までをまとめて行う便宜関数。
 * breakdownには参考値としてresponse(未到達時は中立50)も含める。
 */
export function calculateDominance(input: DominanceCalculatorInput): DominanceScore {
  const base = calculateBaseDominance(input)
  const value = applyResponseCorrection(base.value, input.response)

  const breakdown: DominanceScoreBreakdown = {
    ...base.breakdown,
    response: input.response === undefined ? NEUTRAL_RESPONSE_SCORE : clamp(input.response)
  }

  return { timestamp: input.timestamp, value, breakdown }
}
