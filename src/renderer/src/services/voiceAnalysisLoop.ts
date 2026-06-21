import type { CaptureErrorInfo } from '../../../shared/types/capture'
import type { VoiceScore } from '../../../shared/types/analysis'
import type { RealtimeVoiceAnalyzer } from '../analysis/voice/voiceAnalyzer'
import {
  createCandidateMicVoiceAnalyzer,
  type CandidateMicVoiceAnalyzerOptions
} from '../capture/candidateMic'
import { calculateVoiceScore } from '../domain/scoring/voiceScore'
import { createAsyncOperationQueue } from './asyncOperationQueue'
import { dominanceOrchestrator } from './dominanceOrchestrator'

export interface VoiceAnalysisLoopStartOptions extends CandidateMicVoiceAnalyzerOptions {
  /** スコア更新の間隔(ms)。 */
  intervalMs?: number
}

export type VoiceAnalysisLoopStartResult =
  | { ok: true }
  | { ok: false; error: CaptureErrorInfo }

export interface VoiceAnalysisLoopState {
  running: boolean
}

export interface VoiceAnalysisLoop {
  start(options?: VoiceAnalysisLoopStartOptions): Promise<VoiceAnalysisLoopStartResult>
  stop(): Promise<void>
  getState(): VoiceAnalysisLoopState
}

interface VoiceAnalysisLoopDependencies {
  createAnalyzer?: typeof createCandidateMicVoiceAnalyzer
  calculateScore?: typeof calculateVoiceScore
  reportVoice?: (score: VoiceScore) => void
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  clearTimer?: (handle: ReturnType<typeof setInterval>) => void
  onError?: (error: unknown) => void
}

const DEFAULT_INTERVAL_MS = 500

/**
 * 就活生マイクの声特徴量(Meyda)を一定間隔でスコア化し、優勢度オーケストレーターへ
 * reportVoice する producer ループ。faceAnalysisLoop と同じ構造。
 * STTパイプラインとは別のマイクストリームを使うため互いに干渉しない。
 */
export function createVoiceAnalysisLoop(
  dependencies: VoiceAnalysisLoopDependencies = {}
): VoiceAnalysisLoop {
  const createAnalyzer = dependencies.createAnalyzer ?? createCandidateMicVoiceAnalyzer
  const calculateScore = dependencies.calculateScore ?? calculateVoiceScore
  const reportVoice = dependencies.reportVoice ?? dominanceOrchestrator.reportVoice
  const setTimer = dependencies.setTimer ?? ((callback, ms) => setInterval(callback, ms))
  const clearTimer = dependencies.clearTimer ?? ((handle) => clearInterval(handle))

  let analyzer: RealtimeVoiceAnalyzer | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const operationQueue = createAsyncOperationQueue()

  async function startNow(options: VoiceAnalysisLoopStartOptions): Promise<VoiceAnalysisLoopStartResult> {
    await stopNow()

    const result = await createAnalyzer(options)
    if (!result.ok) {
      return result
    }

    analyzer = result.stream
    analyzer.start()
    timer = setTimer(() => {
      void tick()
    }, options.intervalMs ?? DEFAULT_INTERVAL_MS)

    return { ok: true }
  }

  function tick(): void {
    if (!analyzer) {
      return
    }
    try {
      reportVoice(calculateScore(analyzer.getLatest()))
    } catch (error) {
      dependencies.onError?.(error)
    }
  }

  async function stopNow(): Promise<void> {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }

    const active = analyzer
    analyzer = undefined
    if (active) {
      active.stop()
      await active.dispose()
    }
  }

  return {
    start: (options = {}) => operationQueue.enqueue(() => startNow(options)),
    stop: () => operationQueue.enqueue(stopNow),
    getState: () => ({ running: analyzer !== undefined })
  }
}

export const voiceAnalysisLoop = createVoiceAnalysisLoop()
