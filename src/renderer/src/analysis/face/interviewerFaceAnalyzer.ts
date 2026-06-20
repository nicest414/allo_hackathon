import type { FaceAnalyzer, FaceAnalyzerOptions } from './candidateFaceAnalyzer'
import { createFaceAnalyzer } from './candidateFaceAnalyzer'

export function createInterviewerFaceAnalyzer(options: FaceAnalyzerOptions): FaceAnalyzer {
  return createFaceAnalyzer('interviewer', options)
}
