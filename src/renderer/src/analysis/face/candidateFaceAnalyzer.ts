import type { AnalysisSubject, FaceAnalysisResult } from '../../../../shared/types/analysis'
import type { FaceLandmarker, FaceLandmarkerInput, FaceLandmarkerResult } from './faceLandmarker'

export interface FaceAnalyzerOptions {
  landmarker: FaceLandmarker
  now?: () => number
}

export interface FaceAnalyzer {
  analyze(input: FaceLandmarkerInput): Promise<FaceAnalysisResult>
  close?(): void | Promise<void>
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

export function createCandidateFaceAnalyzer(options: FaceAnalyzerOptions): FaceAnalyzer {
  return createFaceAnalyzer('candidate', options)
}

export function createFaceAnalyzer(
  subject: AnalysisSubject,
  options: FaceAnalyzerOptions
): FaceAnalyzer {
  return {
    async analyze(input) {
      const timestamp = options.now?.() ?? Date.now()
      const result = await options.landmarker.detect(input, timestamp)

      return toFaceAnalysisResult(subject, result, timestamp)
    },
    close: options.landmarker.close?.bind(options.landmarker)
  }
}

export function toFaceAnalysisResult(
  subject: AnalysisSubject,
  result: FaceLandmarkerResult | null,
  fallbackTimestamp = Date.now()
): FaceAnalysisResult {
  if (result === null) {
    return {
      subject,
      timestamp: fallbackTimestamp,
      tensionLevel: 0,
      smileLevel: 0,
      expression: 'unknown'
    }
  }

  if (result.landmarks.length === 0) {
    return {
      subject,
      timestamp: result.timestamp,
      tensionLevel: 0,
      smileLevel: 0,
      expression: 'unknown'
    }
  }

  const smileLevel = estimateSmileLevel(result.landmarks)
  const tensionLevel = estimateTensionLevel(result.landmarks, smileLevel)
  const expression =
    smileLevel >= 65 ? 'smile' : tensionLevel >= 65 ? 'tense' : 'neutral'

  return {
    subject,
    timestamp: result.timestamp,
    tensionLevel,
    smileLevel,
    expression
  }
}

function estimateSmileLevel(landmarks: FaceLandmarkerResult['landmarks']): number {
  const leftMouth = landmarks[61]
  const rightMouth = landmarks[291]
  const upperLip = landmarks[13]
  const lowerLip = landmarks[14]

  if (!leftMouth || !rightMouth || !upperLip || !lowerLip) {
    return 0
  }

  const mouthWidth = distance(leftMouth, rightMouth)
  const mouthOpen = distance(upperLip, lowerLip)

  if (mouthWidth === 0) {
    return 0
  }

  return clamp((mouthWidth / Math.max(mouthOpen, 0.01) - 2) * 25)
}

function estimateTensionLevel(
  landmarks: FaceLandmarkerResult['landmarks'],
  smileLevel: number
): number {
  const leftBrow = landmarks[70]
  const rightBrow = landmarks[300]
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]

  if (!leftBrow || !rightBrow || !leftEye || !rightEye) {
    return clamp(40 - smileLevel * 0.25)
  }

  const browHeight = ((leftEye.y - leftBrow.y) + (rightEye.y - rightBrow.y)) / 2
  return clamp(70 - browHeight * 250 - smileLevel * 0.25)
}

function distance(
  a: FaceLandmarkerResult['landmarks'][number],
  b: FaceLandmarkerResult['landmarks'][number]
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}
