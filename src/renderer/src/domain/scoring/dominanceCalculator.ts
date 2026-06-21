import type {
  DominanceScore,
  DominanceScoreBreakdown,
  FaceScore,
  FillerDetectionResult,
  TalkRatioScore,
  VoiceScore
} from '../../../../shared/types/analysis'

/**
 * 優勢度は二段階で求める:
 *   1) リアルタイム5項目（候補者顔/面接官顔/声/フィラー/発話時間比）から「基礎値」を粗く算出
 *   2) LLM返答判定が届いたら、それ以降は LLM 判定スコアを優勢度の本体として採用し、
 *      基礎値はそこからの微調整（fine-tune）としてのみ働く
 *
 * 「LLM未到達の間はリアルタイム5項目で動く／LLM到達後はLLMが主役」という二段階の
 * 主役交代をdelta方式で表現する。LLM到達後は (基礎値 - 中立50) に小さい影響度を掛けて
 * LLM判定スコアへ加減算するため、表情/声/フィラー等の解釈が弱い実況シグナルが
 * 内容評価を覆してしまわないようにしつつ、揺れ動きは残す。
 */

export interface BaseDominanceInput {
  timestamp: number
  candidateFace: FaceScore
  interviewerFace: FaceScore
  voice: VoiceScore
  filler: FillerDetectionResult
  talkRatio: TalkRatioScore
}

/**
 * リアルタイム5項目の重み（合計1）。実データに合わせて調整できるよう定数化。
 * interviewerFaceは「面接官が穏やか＝就活生優勢」という仮定が弱く外れやすいため低めに、
 * talkRatioは表情解釈より客観的な発話量シグナルのため高めに振っている。
 */
export const BASE_DOMINANCE_WEIGHTS = {
  candidateFace: 0.3,
  interviewerFace: 0.1,
  voice: 0.2,
  filler: 0.15,
  talkRatio: 0.25
} as const

/** 返答内容スコアの中立値。LLM未到達時の暫定値、およびリアルタイム基礎値の微調整の基準点。 */
export const NEUTRAL_RESPONSE_SCORE = 50

/**
 * LLM到達後にリアルタイム基礎値が優勢度を微調整する影響度。
 * 基礎値が0/100のとき最大 ±(50 * influence) の調整になる。LLMを主役にするため小さめの
 * 0.2(=最大±10)とし、表情/声等の弱い実況シグナルがLLMの内容評価を覆さないようにする。
 */
export const REALTIME_FINE_TUNE_INFLUENCE = 0.2

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
 * 第1段階: リアルタイム5項目から基礎優勢度を算出する。
 * voice/fillerは値が大きいほど「焦り・フィラーが多い」ので100から引いて反転させる。
 * talkRatioは値が大きいほど「就活生が話している量が多い」ので反転させずそのまま使う。
 */
export function calculateBaseDominance(input: BaseDominanceInput): BaseDominance {
  const breakdown: BaseDominanceBreakdown = {
    candidateFace: clamp(input.candidateFace.value),
    interviewerFace: clamp(input.interviewerFace.value),
    voice: clamp(100 - input.voice.value),
    filler: clamp(100 - input.filler.score),
    talkRatio: clamp(input.talkRatio.value)
  }

  const value = clamp(
    breakdown.candidateFace * BASE_DOMINANCE_WEIGHTS.candidateFace +
      breakdown.interviewerFace * BASE_DOMINANCE_WEIGHTS.interviewerFace +
      breakdown.voice * BASE_DOMINANCE_WEIGHTS.voice +
      breakdown.filler * BASE_DOMINANCE_WEIGHTS.filler +
      breakdown.talkRatio * BASE_DOMINANCE_WEIGHTS.talkRatio
  )

  return { timestamp: input.timestamp, value, breakdown }
}

/**
 * リアルタイム基礎値による微調整量(delta)を求める。基礎値が中立(50)からどれだけ
 * 離れているかに影響度を掛けるだけで、responseScoreの値そのものには依存しない。
 */
export function calculateRealtimeFineTune(baseValue: number): number {
  return (clamp(baseValue) - NEUTRAL_RESPONSE_SCORE) * REALTIME_FINE_TUNE_INFLUENCE
}

/**
 * 第2段階: LLM判定スコアを優勢度の本体とし、リアルタイム基礎値で微調整する。
 */
export function applyRealtimeFineTune(responseScore: number, baseValue: number): number {
  return clamp(clamp(responseScore) + calculateRealtimeFineTune(baseValue))
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
  /** LLM返答判定スコア(0-100)。未到達ならundefinedでリアルタイム基礎値のみを使う。 */
  response?: number
}

/**
 * 基礎値の算出 → LLM判定の主役交代までをまとめて行う便宜関数。
 * LLM未到達(response未定義/NaN)の間は基礎値そのものを優勢度として返す。
 * 到達後はLLM判定スコアを優勢度の本体とし、基礎値で微調整する。
 * breakdownには参考値としてresponse(未到達時は中立50)も含める。
 */
export function calculateDominance(input: DominanceCalculatorInput): DominanceScore {
  const base = calculateBaseDominance(input)
  const hasResponse = input.response !== undefined && !Number.isNaN(input.response)
  const value = hasResponse
    ? applyRealtimeFineTune(input.response as number, base.value)
    : base.value

  const breakdown: DominanceScoreBreakdown = {
    ...base.breakdown,
    response: hasResponse ? clamp(input.response as number) : NEUTRAL_RESPONSE_SCORE
  }

  return { timestamp: input.timestamp, value, breakdown }
}
