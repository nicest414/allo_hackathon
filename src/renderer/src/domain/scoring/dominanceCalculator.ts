import type {
  DominanceScore,
  DominanceScoreBreakdown,
  FaceScore,
  FillerDetectionResult,
  VoiceScore
} from '../../../../shared/types/analysis'

export interface DominanceCalculatorInput {
  timestamp: number
  candidateFace: FaceScore
  interviewerFace: FaceScore
  voice: VoiceScore
  filler: FillerDetectionResult
  response: number
}

export const DOMINANCE_WEIGHTS = {
  candidateFace: 0.3,
  interviewerFace: 0.15,
  voice: 0.2,
  filler: 0.15,
  response: 0.2
} as const

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

/**
 * voice/fillerは値が大きいほど「焦り・フィラーが多い」ことを表すスコアなので、
 * 優勢度のbreakdownに積む際は100から引いて反転させる。重みは暫定値で、
 * 後から実データに合わせて調整できるよう定数として外出ししている。
 */
export function calculateDominance(input: DominanceCalculatorInput): DominanceScore {
  const breakdown: DominanceScoreBreakdown = {
    candidateFace: clamp(input.candidateFace.value),
    interviewerFace: clamp(input.interviewerFace.value),
    voice: clamp(100 - input.voice.value),
    filler: clamp(100 - input.filler.score),
    response: clamp(input.response)
  }

  const value = clamp(
    breakdown.candidateFace * DOMINANCE_WEIGHTS.candidateFace +
      breakdown.interviewerFace * DOMINANCE_WEIGHTS.interviewerFace +
      breakdown.voice * DOMINANCE_WEIGHTS.voice +
      breakdown.filler * DOMINANCE_WEIGHTS.filler +
      breakdown.response * DOMINANCE_WEIGHTS.response
  )

  return {
    timestamp: input.timestamp,
    value,
    breakdown
  }
}
