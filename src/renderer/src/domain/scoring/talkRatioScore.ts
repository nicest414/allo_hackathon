import type { TalkRatioScore, TranscriptSegment } from '../../../../shared/types/analysis'

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

/** windowMs 指定時、この時間内のfinalセグメントだけを発話量比の集計対象にする。 */
export const DEFAULT_TALK_RATIO_WINDOW_MS = 10_000

export interface CalculateTalkRatioOptions {
  /** 直近この時間(ms)内のfinalセグメントのみ集計する。未指定なら全件。 */
  windowMs?: number
  /** 現在時刻取得（テスト用）。 */
  now?: () => number
}

function sumChars(segments: TranscriptSegment[], cutoff: number): number {
  return segments
    .filter((segment) => segment.isFinal && segment.timestamp >= cutoff)
    .reduce((total, segment) => total + segment.text.length, 0)
}

/**
 * 直近windowMs内の発話文字数比から「話している量で場を支配している度合い」を算出する。
 * 表情解釈（暫定の仮定が多い）より客観的な優劣シグナルとして、顔/声/フィラーの補助に使う。
 * どちらも発話が無ければ五分（50）を返す。
 */
export function calculateTalkRatio(
  candidateSegments: TranscriptSegment[],
  interviewerSegments: TranscriptSegment[],
  options: CalculateTalkRatioOptions = {}
): TalkRatioScore {
  const now = options.now ?? Date.now
  const cutoff =
    options.windowMs !== undefined ? now() - options.windowMs : Number.NEGATIVE_INFINITY

  const candidateChars = sumChars(candidateSegments, cutoff)
  const interviewerChars = sumChars(interviewerSegments, cutoff)
  const total = candidateChars + interviewerChars

  const value = total === 0 ? 50 : clamp((candidateChars / total) * 100)

  return { candidateChars, interviewerChars, value }
}
