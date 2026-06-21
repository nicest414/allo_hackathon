import type { FillerDetectionResult, TranscriptSegment } from '../../../../shared/types/analysis'

/**
 * フィラー語リスト。Deepgram(ja)の実出力に合わせ、同じ間投詞の表記ゆれ
 * （えっと/ええと/えーと/えと、あー、うーん/んー 等）も拾えるようにしている。
 * 単独で一般語に紛れやすい超短語（ま・と・こう等）は誤検出を避けるため入れない。
 */
export const DEFAULT_FILLER_WORDS = [
  'あのー',
  'あの',
  'えーと',
  'えっと',
  'ええと',
  'えと',
  'えー',
  'あー',
  'うーん',
  'んー',
  'まあ',
  'まぁ',
  'なんか',
  'そのー',
  'やっぱり',
  'やっぱ',
  'なんていうか'
] as const

const SCORE_PER_FILLER = 15

/** windowMs 指定時、この時間内のfinalセグメントだけをフィラー集計の対象にする。 */
export const DEFAULT_FILLER_WINDOW_MS = 10_000

/**
 * フィラー率の正規化基準となる文字数（短文1文相当）。
 * 絶対回数だけで採点すると「よく話す人ほど不利」になるため、これより長く話した分は
 * 文字数に応じてフィラー回数を割り引く（同じ1回でも長時間話した中の1回は軽く扱う）。
 */
export const FILLER_RATE_BASELINE_CHARS = 30

export interface DetectFillersOptions {
  /** 直近この時間(ms)内のfinalセグメントのみ集計する。未指定なら全件（後方互換）。 */
  windowMs?: number
  /** 現在時刻取得（テスト用）。 */
  now?: () => number
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

/** 連続する長音を1つに畳む（「えーー」→「えー」）など軽い正規化を行う。 */
function normalize(text: string): string {
  return text.replace(/ー{2,}/g, 'ー')
}

function countOccurrences(text: string, word: string): number {
  if (word.length === 0) {
    return 0
  }

  return text.split(word).length - 1
}

/**
 * finalな文字起こしを対象にフィラー語の出現回数を数える。
 * 長い語から先に判定し一致部分を取り除くことで「あのー」を「あの」として二重計上しない。
 *
 * windowMs を指定すると直近その時間内のセグメントだけを対象にするため、フィラーを
 * 言わなくなれば時間経過でスコアが下がる（=優勢度ゲージが揺れ動く）。未指定なら全件集計。
 * scoreは「フィラーの多さ」で、優勢度への寄与はdominanceCalculator側で反転する。
 */
export function detectFillers(
  segments: TranscriptSegment[],
  fillerWords: readonly string[] = DEFAULT_FILLER_WORDS,
  options: DetectFillersOptions = {}
): FillerDetectionResult {
  const now = options.now ?? Date.now
  const cutoff = options.windowMs !== undefined ? now() - options.windowMs : Number.NEGATIVE_INFINITY

  const text = segments
    .filter((segment) => segment.isFinal && segment.timestamp >= cutoff)
    .map((segment) => normalize(segment.text))
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

  const totalChars = text.length
  const normalizedFillerCount =
    totalChars > FILLER_RATE_BASELINE_CHARS
      ? fillerCount * (FILLER_RATE_BASELINE_CHARS / totalChars)
      : fillerCount

  return {
    matchedFillers,
    fillerCount,
    score: clamp(normalizedFillerCount * SCORE_PER_FILLER)
  }
}
