import type {
  FaceAnalysisResult,
  FaceExpressionLabel,
  FaceScore
} from '../../../../shared/types/analysis'
import { clampScore } from './scoreUtils'

const EXPRESSION_BONUS: Record<FaceExpressionLabel, number> = {
  neutral: 0,
  smile: 10,
  tense: -10,
  surprised: -5,
  unknown: 0
}

/**
 * 「落ち着き(tensionLevelの逆)」と「笑顔度」を半々で合成した暫定スコア。
 * candidate/interviewerどちらの表情にも同じ式を使う。面接官側は
 * 「面接官が穏やかで好意的＝就活生が優勢」という暫定の仮定に基づく。
 */
export function calculateFaceScore(result: FaceAnalysisResult): FaceScore {
  const composure = 100 - result.tensionLevel
  const base = composure * 0.5 + result.smileLevel * 0.5
  const value = clampScore(base + EXPRESSION_BONUS[result.expression])

  return {
    subject: result.subject,
    value
  }
}
