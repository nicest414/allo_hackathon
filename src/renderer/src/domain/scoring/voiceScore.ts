import type { VoiceAnalysisResult, VoiceScore } from '../../../../shared/types/analysis'

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

const IDEAL_SPEECH_RATE = 6
const SPEECH_RATE_TOLERANCE = 4

const WEIGHTS = {
  pauseRatio: 0.4,
  pitchVariation: 0.3,
  speechRate: 0.3
}

/**
 * pauseRatio/pitchVariationは0-1の正規化値、speechRateは1秒あたりの発話量を想定した暫定スコア。
 * 値が大きいほど「声から感じる焦り度」が高いことを表す（=優勢度への寄与はdominanceCalculator側で反転する）。
 */
export function calculateVoiceScore(result: VoiceAnalysisResult): VoiceScore {
  const pauseNervousness = clamp(result.pauseRatio * 100)
  const pitchNervousness = clamp(100 - result.pitchVariation * 100)
  const rateDeviation = Math.abs(result.speechRate - IDEAL_SPEECH_RATE) / SPEECH_RATE_TOLERANCE
  const rateNervousness = clamp(rateDeviation * 100)

  const value = clamp(
    pauseNervousness * WEIGHTS.pauseRatio +
      pitchNervousness * WEIGHTS.pitchVariation +
      rateNervousness * WEIGHTS.speechRate
  )

  return { value }
}
