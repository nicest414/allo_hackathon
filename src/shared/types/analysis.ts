export type AnalysisSubject = 'candidate' | 'interviewer'

// ===== 顔分析（就活生・面接官 両方） =====

export type FaceExpressionLabel = 'neutral' | 'smile' | 'tense' | 'surprised' | 'unknown'

/** 顔の領域を映像サイズに対する0-1の正規化座標で表す枠（ライブ顔クロップ表示用）。 */
export interface NormalizedFaceBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FaceAnalysisResult {
  subject: AnalysisSubject
  timestamp: number
  tensionLevel: number // 0-100 焦り度
  smileLevel: number // 0-100 笑顔度
  expression: FaceExpressionLabel
  /** 検出した顔の正規化枠（0-1）。顔未検出時は undefined。リアルタイム顔クロップ表示に使う。 */
  faceBox?: NormalizedFaceBox
}

export interface FaceScore {
  subject: AnalysisSubject
  value: number // 0-100
}

// ===== 声分析（就活生のみ） =====

export interface VoiceAnalysisResult {
  timestamp: number
  pitchVariation: number
  speechRate: number
  pauseRatio: number
}

export interface VoiceScore {
  value: number // 0-100 声の焦りスコア
}

// ===== STT（就活生のみ） =====

export interface TranscriptSegment {
  timestamp: number
  text: string
  isFinal: boolean
}

export interface FillerDetectionResult {
  matchedFillers: string[]
  fillerCount: number
  score: number // 0-100
}

// ===== LLM判定（質問への返答内容） =====

export interface ResponseJudgment {
  question: string
  answer: string
  score: number // 0-100
  reason: string
}

// ===== 優勢度（各スコアの合成結果） =====

export interface DominanceScoreBreakdown {
  candidateFace: number
  interviewerFace: number
  voice: number
  filler: number
  response: number
}

export interface DominanceScore {
  timestamp: number
  value: number // 0-100
  breakdown: DominanceScoreBreakdown
}
