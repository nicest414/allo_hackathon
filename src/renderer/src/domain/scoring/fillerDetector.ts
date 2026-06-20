import type { FillerDetectionResult, TranscriptSegment } from '../../../../shared/types/analysis'

export const DEFAULT_FILLER_WORDS = [
  'あのー',
  'あの',
  'えーと',
  'えっと',
  'えー',
  'まあ',
  'なんか',
  'そのー'
] as const

const SCORE_PER_FILLER = 15

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

function countOccurrences(text: string, word: string): number {
  if (word.length === 0) {
    return 0
  }

  return text.split(word).length - 1
}

/**
 * isFinalな文字起こしのみを対象にフィラー語の出現回数を数える暫定実装。
 * 長い語から先に判定し一致した部分を取り除くことで、「あのー」を「あの」として
 * 二重に数えてしまうような語の重複カウントを避ける。
 * scoreは「フィラーの多さ」を表すスコアで、優勢度への寄与はdominanceCalculator側で反転する。
 */
export function detectFillers(
  segments: TranscriptSegment[],
  fillerWords: readonly string[] = DEFAULT_FILLER_WORDS
): FillerDetectionResult {
  const text = segments
    .filter((segment) => segment.isFinal)
    .map((segment) => segment.text)
    .join(' ')

  const sortedFillers = [...fillerWords].sort((a, b) => b.length - a.length)

  const matchedFillers: string[] = []
  let fillerCount = 0
  let remaining = text

  for (const filler of sortedFillers) {
    const occurrences = countOccurrences(remaining, filler)
    if (occurrences > 0) {
      matchedFillers.push(filler)
      fillerCount += occurrences
      remaining = remaining.split(filler).join('')
    }
  }

  return {
    matchedFillers,
    fillerCount,
    score: clamp(fillerCount * SCORE_PER_FILLER)
  }
}
