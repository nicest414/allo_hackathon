import type { CaptureErrorInfo } from '../../../shared/types/capture'
import type { FaceScore } from '../../../shared/types/analysis'
import {
  createCandidateFaceAnalyzer,
  type FaceAnalyzer
} from '../analysis/face/candidateFaceAnalyzer'
import { createFaceLandmarker } from '../analysis/face/faceLandmarker'
import { createInterviewerFaceAnalyzer } from '../analysis/face/interviewerFaceAnalyzer'
import {
  getCandidateCameraStream,
  type CandidateCameraOptions
} from '../capture/candidateCamera'
import {
  getInterviewerScreenStream,
  type InterviewerScreenOptions
} from '../capture/interviewerScreen'
import { calculateFaceScore } from '../domain/scoring/faceScore'
import { dominanceOrchestrator } from './dominanceOrchestrator'

type FaceLoopSubject = 'candidate' | 'interviewer'

export interface FaceAnalysisLoopStartOptions {
  fps?: number
}

export interface CandidateFaceAnalysisLoopOptions
  extends CandidateCameraOptions,
    FaceAnalysisLoopStartOptions {}

export interface InterviewerFaceAnalysisLoopOptions
  extends InterviewerScreenOptions,
    FaceAnalysisLoopStartOptions {}

export type FaceAnalysisLoopStartResult =
  | { ok: true }
  | { ok: false; error: CaptureErrorInfo }

export interface FaceAnalysisLoopState {
  candidate: boolean
  interviewer: boolean
}

export interface FaceAnalysisLoop {
  startCandidate(options?: CandidateFaceAnalysisLoopOptions): Promise<FaceAnalysisLoopStartResult>
  startInterviewer(options: InterviewerFaceAnalysisLoopOptions): Promise<FaceAnalysisLoopStartResult>
  stopCandidate(): Promise<void>
  stopInterviewer(): Promise<void>
  stopAll(): Promise<void>
  getState(): FaceAnalysisLoopState
}

interface FaceAnalysisLoopDependencies {
  captureCandidateCamera?: typeof getCandidateCameraStream
  captureInterviewerScreen?: typeof getInterviewerScreenStream
  createCandidateAnalyzer?: () => FaceAnalyzer
  createInterviewerAnalyzer?: () => FaceAnalyzer
  calculateScore?: typeof calculateFaceScore
  reportCandidateFace?: (score: FaceScore) => void
  reportInterviewerFace?: (score: FaceScore) => void
  createVideoElement?: () => HTMLVideoElement
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  onError?: (subject: FaceLoopSubject, error: unknown) => void
}

interface FaceLoopSession {
  subject: FaceLoopSubject
  stream: MediaStream
  analyzer: FaceAnalyzer
  video: HTMLVideoElement
  fps: number
  stopped: boolean
  frameHandle?: number
  timerHandle?: ReturnType<typeof setTimeout>
}

const DEFAULT_FPS = 6
const NEUTRAL_FACE_SCORE = 50
const HAVE_CURRENT_DATA = 2

export function createFaceAnalysisLoop(
  dependencies: FaceAnalysisLoopDependencies = {}
): FaceAnalysisLoop {
  const captureCandidateCamera =
    dependencies.captureCandidateCamera ?? getCandidateCameraStream
  const captureInterviewerScreen =
    dependencies.captureInterviewerScreen ?? getInterviewerScreenStream
  const createCandidateAnalyzer =
    dependencies.createCandidateAnalyzer ??
    (() => createCandidateFaceAnalyzer({ landmarker: createFaceLandmarker() }))
  const createInterviewerAnalyzer =
    dependencies.createInterviewerAnalyzer ??
    (() => createInterviewerFaceAnalyzer({ landmarker: createFaceLandmarker() }))
  const scoreFace = dependencies.calculateScore ?? calculateFaceScore
  const reportCandidateFace =
    dependencies.reportCandidateFace ?? dominanceOrchestrator.reportCandidateFace
  const reportInterviewerFace =
    dependencies.reportInterviewerFace ?? dominanceOrchestrator.reportInterviewerFace
  const createVideoElement =
    dependencies.createVideoElement ??
    (() => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      return video
    })
  const requestFrame =
    dependencies.requestFrame ?? ((callback) => window.requestAnimationFrame(callback))
  const cancelFrame = dependencies.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle))
  const setTimer = dependencies.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle))

  const sessions: Partial<Record<FaceLoopSubject, FaceLoopSession>> = {}

  async function startCandidate(
    options: CandidateFaceAnalysisLoopOptions = {}
  ): Promise<FaceAnalysisLoopStartResult> {
    await stop('candidate')

    const capture = await captureCandidateCamera(options)
    if (!capture.ok) {
      reportNeutralFace('candidate')
      return capture
    }

    sessions.candidate = await createSession(
      'candidate',
      capture.stream,
      createCandidateAnalyzer(),
      options.fps
    )
    scheduleNextFrame(sessions.candidate)

    return { ok: true }
  }

  async function startInterviewer(
    options: InterviewerFaceAnalysisLoopOptions
  ): Promise<FaceAnalysisLoopStartResult> {
    await stop('interviewer')

    if (!options.sourceId) {
      reportNeutralFace('interviewer')
      return {
        ok: false,
        error: {
          code: 'unknown',
          name: 'ScreenSourceNotSelected',
          message: '面接官画面の共有元が選択されていません'
        }
      }
    }

    const capture = await captureInterviewerScreen(options)
    if (!capture.ok) {
      reportNeutralFace('interviewer')
      return capture
    }

    sessions.interviewer = await createSession(
      'interviewer',
      capture.stream,
      createInterviewerAnalyzer(),
      options.fps
    )
    scheduleNextFrame(sessions.interviewer)

    return { ok: true }
  }

  async function createSession(
    subject: FaceLoopSubject,
    stream: MediaStream,
    analyzer: FaceAnalyzer,
    fps = DEFAULT_FPS
  ): Promise<FaceLoopSession> {
    const video = createVideoElement()
    video.srcObject = stream
    await video.play().catch((error: unknown) => {
      dependencies.onError?.(subject, error)
    })

    return {
      subject,
      stream,
      analyzer,
      video,
      fps: normalizeFps(fps),
      stopped: false
    }
  }

  function scheduleNextFrame(session: FaceLoopSession | undefined): void {
    if (!session || session.stopped) {
      return
    }

    session.timerHandle = setTimer(() => {
      session.timerHandle = undefined
      session.frameHandle = requestFrame(() => {
        session.frameHandle = undefined
        void analyzeFrame(session)
      })
    }, 1000 / session.fps)
  }

  async function analyzeFrame(session: FaceLoopSession): Promise<void> {
    if (session.stopped) {
      return
    }

    try {
      if (session.video.readyState >= HAVE_CURRENT_DATA) {
        const result = await session.analyzer.analyze(session.video)
        reportFaceScore(scoreFace(result))
      }
    } catch (error) {
      reportNeutralFace(session.subject)
      dependencies.onError?.(session.subject, error)
    } finally {
      scheduleNextFrame(session)
    }
  }

  function reportFaceScore(score: FaceScore): void {
    if (score.subject === 'candidate') {
      reportCandidateFace(score)
    } else {
      reportInterviewerFace(score)
    }
  }

  function reportNeutralFace(subject: FaceLoopSubject): void {
    reportFaceScore({ subject, value: NEUTRAL_FACE_SCORE })
  }

  async function stop(subject: FaceLoopSubject): Promise<void> {
    const session = sessions[subject]
    if (!session) {
      return
    }

    delete sessions[subject]
    session.stopped = true

    if (session.timerHandle !== undefined) {
      clearTimer(session.timerHandle)
      session.timerHandle = undefined
    }

    if (session.frameHandle !== undefined) {
      cancelFrame(session.frameHandle)
      session.frameHandle = undefined
    }

    session.stream.getTracks().forEach((track) => track.stop())
    session.video.pause()
    session.video.srcObject = null
    session.video.remove()
    await session.analyzer.close?.()
  }

  return {
    startCandidate,
    startInterviewer,
    stopCandidate: () => stop('candidate'),
    stopInterviewer: () => stop('interviewer'),
    stopAll: async () => {
      await Promise.all([stop('candidate'), stop('interviewer')])
    },
    getState: () => ({
      candidate: sessions.candidate !== undefined,
      interviewer: sessions.interviewer !== undefined
    })
  }
}

function normalizeFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    return DEFAULT_FPS
  }

  return Math.min(30, Math.max(1, fps))
}

export const faceAnalysisLoop = createFaceAnalysisLoop()
