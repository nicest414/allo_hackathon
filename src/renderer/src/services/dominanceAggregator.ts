import type { FaceScore, FillerDetectionResult, VoiceScore } from '../../../shared/types/analysis'
import type { DominanceScores } from '../store/useDominanceStore'

/**
 * 各分析結果の最新値を集約し、優勢度Storeへ流すオーケストレーション（pure / Reactに非依存）。
 *
 * 優勢度の再計算（基礎優勢度・LLM補正・返答スコアのEMA）はStore側(setScores)が担う。
 * このアグリゲーターは「型付き分析結果 → Storeが扱う数値スコア」への変換と、
 * 分析ごとに異なる更新周期をまとめる throttle（再計算頻度の制御）だけを担当する。
 *
 * 注: voice/fillerは値が大きいほど焦り・フィラーが多い「生スコア」をそのまま渡す
 * （優勢度への反転はStore→dominanceCalculator側で行う）。
 */

export type DominanceScoreUpdate = Partial<DominanceScores>

const DEFAULT_MIN_INTERVAL_MS = 100

export interface DominanceAggregatorOptions {
  /** まとめた更新の反映先（通常は Store の setScores）。 */
  onFlush: (update: DominanceScoreUpdate) => void
  /** 連続更新時の最小反映間隔(ms)。 */
  minIntervalMs?: number
  /** 現在時刻取得（テスト用）。 */
  now?: () => number
  /** 遅延実行スケジューラ（テスト用に差し替え可能）。 */
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

export interface DominanceAggregator {
  reportCandidateFace: (score: FaceScore) => void
  reportInterviewerFace: (score: FaceScore) => void
  reportVoice: (score: VoiceScore) => void
  reportFiller: (result: FillerDetectionResult) => void
  reportResponse: (score: number) => void
  /** 保留中の更新を即時反映する。 */
  flush: () => void
  /** 集約状態を初期化する。 */
  reset: () => void
}

export function createDominanceAggregator(options: DominanceAggregatorOptions): DominanceAggregator {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((cb, ms) => setTimeout(cb, ms))
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let pending: DominanceScoreUpdate = {}
  let lastFlushAt = Number.NEGATIVE_INFINITY
  let timer: unknown

  function flush(): void {
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }

    if (Object.keys(pending).length === 0) {
      return
    }

    const update = pending
    pending = {}
    lastFlushAt = now()
    options.onFlush(update)
  }

  // leading + trailing throttle: 間隔が空いていれば即時、空いていなければ末尾で1回だけまとめて反映
  function requestFlush(): void {
    const elapsed = now() - lastFlushAt

    if (elapsed >= minIntervalMs) {
      flush()
    } else if (timer === undefined) {
      timer = schedule(flush, minIntervalMs - elapsed)
    }
  }

  function merge(partial: DominanceScoreUpdate): void {
    pending = { ...pending, ...partial }
    requestFlush()
  }

  return {
    reportCandidateFace: (score) => merge({ candidateFace: score.value }),
    reportInterviewerFace: (score) => merge({ interviewerFace: score.value }),
    reportVoice: (score) => merge({ voice: score.value }),
    reportFiller: (result) => merge({ filler: result.score }),
    reportResponse: (score) => merge({ response: score }),
    flush,
    reset: () => {
      pending = {}
      if (timer !== undefined) {
        cancel(timer)
        timer = undefined
      }
      lastFlushAt = Number.NEGATIVE_INFINITY
    }
  }
}
