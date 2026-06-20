import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceAnalysisResult, VoiceScore } from '../../../shared/types/analysis'
import type { RealtimeVoiceAnalyzer } from '../analysis/voice/voiceAnalyzer'
import { createVoiceAnalysisLoop } from './voiceAnalysisLoop'

function fakeResult(value: number): VoiceAnalysisResult {
  return {
    timestamp: 0,
    pitchVariation: 0,
    speechRate: value,
    pauseRatio: 0
  } as VoiceAnalysisResult
}

function createFakeAnalyzer(): RealtimeVoiceAnalyzer & { started: boolean; disposed: boolean } {
  return {
    started: false,
    disposed: false,
    start() {
      this.started = true
    },
    stop() {},
    getLatest() {
      return fakeResult(6)
    },
    async analyze() {
      return fakeResult(6)
    },
    async dispose() {
      this.disposed = true
    }
  }
}

describe('voiceAnalysisLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start で analyzer を開始し、interval ごとに reportVoice する', async () => {
    const analyzer = createFakeAnalyzer()
    const reported: VoiceScore[] = []

    const loop = createVoiceAnalysisLoop({
      createAnalyzer: async () => ({ ok: true, stream: analyzer }),
      reportVoice: (score) => reported.push(score),
      calculateScore: () => ({ value: 42 })
    })

    const result = await loop.start({ intervalMs: 500 })

    expect(result.ok).toBe(true)
    expect(analyzer.started).toBe(true)
    expect(loop.getState().running).toBe(true)

    vi.advanceTimersByTime(1500)
    expect(reported.length).toBeGreaterThanOrEqual(3)
    expect(reported[0]).toEqual({ value: 42 })
  })

  it('マイク取得失敗時は error を返し running にならない', async () => {
    const loop = createVoiceAnalysisLoop({
      createAnalyzer: async () => ({
        ok: false,
        error: { code: 'permission-denied', name: 'NotAllowedError', message: 'denied' }
      }),
      reportVoice: () => undefined
    })

    const result = await loop.start()
    expect(result.ok).toBe(false)
    expect(loop.getState().running).toBe(false)
  })

  it('stop で interval解除・dispose し、reportVoice が止まる', async () => {
    const analyzer = createFakeAnalyzer()
    const reported: VoiceScore[] = []
    const loop = createVoiceAnalysisLoop({
      createAnalyzer: async () => ({ ok: true, stream: analyzer }),
      reportVoice: (score) => reported.push(score),
      calculateScore: () => ({ value: 1 })
    })

    await loop.start({ intervalMs: 500 })
    await loop.stop()

    expect(analyzer.disposed).toBe(true)
    expect(loop.getState().running).toBe(false)

    const countAfterStop = reported.length
    vi.advanceTimersByTime(2000)
    expect(reported.length).toBe(countAfterStop)
  })
})
