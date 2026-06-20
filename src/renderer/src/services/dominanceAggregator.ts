import type {
  DominanceScoreBreakdown,
  FaceScore,
  FillerDetectionResult,
  VoiceScore
} from '../../../shared/types/analysis'
import { calculateBaseDominance, calculateDominance } from '../domain/scoring/dominanceCalculator'

/**
 * 各分析結果の最新値を集約し、優勢度を再計算するオーケストレーション（pure / Reactに非依存）。
 *
 * - 欠損している入力は中立扱いにする（顔/声/フィラーは中立値50、返答は補正なし）。
 * - 分析ごとに更新周期が異なるため、最新値だけを保持し、throttleで再計算頻度を抑える。
 */

export interface DominanceSignals {
  candidateFace?: FaceScore
  interviewerFace?: FaceScore
  voice?: VoiceScore
  filler?: FillerDetectionResult
  response?: number
}

export interface ComposedDominance {
  timestamp: number
  /** リアルタイム4項目のみの基礎優勢度 */
  baseDominance: number
  /** LLM補正を適用した最終優勢度 */
  dominance: number
  breakdown: DominanceScoreBreakdown
}

const NEUTRAL_FACE_VALUE = 50
const NEUTRAL_VOICE: VoiceScore = { value: 50 }
const NEUTRAL_FILLER: FillerDetectionResult = { matchedFillers: [], fillerCount: 0, score: 50 }
const DEFAULT_MIN_INTERVAL_MS = 100

/**
 * 欠損入力を中立で埋めて優勢度を算出する。基礎優勢度と補正後優勢度の両方を返す。
 */
export function composeDominance(
  signals: DominanceSignals,
  timestamp: number = Date.now()
): ComposedDominance {
  const filled = {
    timestamp,
    candidateFace: signals.candidateFace ?? { subject: 'candidate' as const, value: NEUTRAL_FACE_VALUE },
    interviewerFace:
      signals.interviewerFace ?? { subject: 'interviewer' as const, value: NEUTRAL_FACE_VALUE },
    voice: signals.voice ?? NEUTRAL_VOICE,
    filler: signals.filler ?? NEUTRAL_FILLER,
    response: signals.response
  }

  const base = calculateBaseDominance(filled)
  const full = calculateDominance(filled)

  return {
    timestamp,
    baseDominance: base.value,
    dominance: full.value,
    breakdown: full.breakdown
  }
}

export interface DominanceAggregatorOptions {
  /** 再計算結果の通知先（Store更新など）。 */
  onChange: (result: ComposedDominance) => void
  /** 連続更新時の最小再計算間隔(ms)。 */
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

  let signals: DominanceSignals = {}
  let lastEmitAt = Number.NEGATIVE_INFINITY
  let timer: unknown

  function emit(): void {
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    lastEmitAt = now()
    options.onChange(composeDominance(signals, lastEmitAt))
  }

  // leading + trailing throttle: 間隔が空いていれば即時、空いていなければ末尾で1回だけ反映
  function requestEmit(): void {
    const elapsed = now() - lastEmitAt

    if (elapsed >= minIntervalMs) {
      emit()
    } else if (timer === undefined) {
      timer = schedule(emit, minIntervalMs - elapsed)
    }
  }

  function update(partial: DominanceSignals): void {
    signals = { ...signals, ...partial }
    requestEmit()
  }

  return {
    reportCandidateFace: (score) => update({ candidateFace: score }),
    reportInterviewerFace: (score) => update({ interviewerFace: score }),
    reportVoice: (score) => update({ voice: score }),
    reportFiller: (result) => update({ filler: result }),
    reportResponse: (score) => update({ response: score }),
    flush: () => emit(),
    reset: () => {
      signals = {}
      if (timer !== undefined) {
        cancel(timer)
        timer = undefined
      }
      lastEmitAt = Number.NEGATIVE_INFINITY
    }
  }
}
