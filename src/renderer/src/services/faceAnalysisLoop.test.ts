import { describe, expect, it, vi } from 'vitest'
import type { FaceAnalyzer } from '../analysis/face/candidateFaceAnalyzer'
import type { FaceAnalysisResult, FaceScore } from '../../../shared/types/analysis'
import { createFaceAnalysisLoop } from './faceAnalysisLoop'

describe('createFaceAnalysisLoop', () => {
  it('captures candidate camera frames, analyzes them at the configured fps, and reports scores', async () => {
    const track = { stop: vi.fn() }
    const video = createVideo()
    const analyzer = createAnalyzer({
      subject: 'candidate',
      tensionLevel: 20,
      smileLevel: 80,
      expression: 'smile'
    })
    const reported: FaceScore[] = []
    const timers: Array<{ callback: () => void; ms: number }> = []
    const frames: FrameRequestCallback[] = []

    const loop = createFaceAnalysisLoop({
      captureCandidateCamera: async () => ({
        ok: true,
        stream: { getTracks: () => [track] } as unknown as MediaStream
      }),
      createCandidateAnalyzer: () => analyzer,
      calculateScore: (result) => ({ subject: result.subject, value: 88 }),
      reportCandidateFace: (score) => reported.push(score),
      createVideoElement: () => video,
      setTimer: (callback, ms) => {
        timers.push({ callback, ms })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: vi.fn(),
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn()
    })

    await expect(loop.startCandidate({ fps: 5 })).resolves.toEqual({ ok: true })
    expect(timers[0].ms).toBe(200)

    timers[0].callback()
    frames[0](100)
    await Promise.resolve()

    expect(analyzer.analyze).toHaveBeenCalledWith(video)
    expect(reported).toEqual([{ subject: 'candidate', value: 88 }])
    expect(loop.getState()).toEqual({ candidate: true, interviewer: false })

    await loop.stopCandidate()

    expect(track.stop).toHaveBeenCalledOnce()
    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
    expect(video.remove).toHaveBeenCalledOnce()
    expect(analyzer.close).toHaveBeenCalledOnce()
  })

  it('reports neutral candidate face score when camera capture fails', async () => {
    const reported: FaceScore[] = []
    const loop = createFaceAnalysisLoop({
      captureCandidateCamera: async () => ({
        ok: false,
        error: {
          code: 'permission-denied',
          name: 'NotAllowedError',
          message: 'denied'
        }
      }),
      reportCandidateFace: (score) => reported.push(score)
    })

    await expect(loop.startCandidate()).resolves.toEqual({
      ok: false,
      error: {
        code: 'permission-denied',
        name: 'NotAllowedError',
        message: 'denied'
      }
    })

    expect(reported).toEqual([{ subject: 'candidate', value: 50 }])
    expect(loop.getState()).toEqual({ candidate: false, interviewer: false })
  })

  it('requires interviewer screen source selection before starting', async () => {
    const reported: FaceScore[] = []
    const captureInterviewerScreen = vi.fn()
    const loop = createFaceAnalysisLoop({
      captureInterviewerScreen,
      reportInterviewerFace: (score) => reported.push(score)
    })

    const result = await loop.startInterviewer({ sourceId: '' })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown',
        name: 'ScreenSourceNotSelected',
        message: '面接官画面の共有元が選択されていません'
      }
    })
    expect(captureInterviewerScreen).not.toHaveBeenCalled()
    expect(reported).toEqual([{ subject: 'interviewer', value: 50 }])
  })

  it('stops both active loops and cancels scheduled work', async () => {
    const clearTimer = vi.fn()
    const cancelFrame = vi.fn()
    const candidateTrack = { stop: vi.fn() }
    const interviewerTrack = { stop: vi.fn() }

    const loop = createFaceAnalysisLoop({
      captureCandidateCamera: async () => ({
        ok: true,
        stream: { getTracks: () => [candidateTrack] } as unknown as MediaStream
      }),
      captureInterviewerScreen: async () => ({
        ok: true,
        stream: { getTracks: () => [interviewerTrack] } as unknown as MediaStream
      }),
      createCandidateAnalyzer: () => createAnalyzer({ subject: 'candidate' }),
      createInterviewerAnalyzer: () => createAnalyzer({ subject: 'interviewer' }),
      createVideoElement: () => createVideo(),
      setTimer: () => 123 as unknown as ReturnType<typeof setTimeout>,
      clearTimer,
      requestFrame: () => 456,
      cancelFrame
    })

    await loop.startCandidate()
    await loop.startInterviewer({ sourceId: 'screen:1' })
    await loop.stopAll()

    expect(candidateTrack.stop).toHaveBeenCalledOnce()
    expect(interviewerTrack.stop).toHaveBeenCalledOnce()
    expect(clearTimer).toHaveBeenCalledTimes(2)
    expect(cancelFrame).not.toHaveBeenCalled()
    expect(loop.getState()).toEqual({ candidate: false, interviewer: false })
  })
})

function createAnalyzer(
  partial: Partial<FaceAnalysisResult> = {}
): FaceAnalyzer & {
  analyze: ReturnType<typeof vi.fn<FaceAnalyzer['analyze']>>
  close: ReturnType<typeof vi.fn<NonNullable<FaceAnalyzer['close']>>>
} {
  return {
    analyze: vi.fn(async () => ({
      subject: partial.subject ?? 'candidate',
      timestamp: partial.timestamp ?? 123,
      tensionLevel: partial.tensionLevel ?? 0,
      smileLevel: partial.smileLevel ?? 0,
      expression: partial.expression ?? 'unknown'
    })),
    close: vi.fn(() => undefined)
  }
}

function createVideo(): HTMLVideoElement & {
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  return {
    readyState: 2,
    srcObject: null,
    muted: false,
    playsInline: false,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    remove: vi.fn()
  } as unknown as HTMLVideoElement & {
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }
}
