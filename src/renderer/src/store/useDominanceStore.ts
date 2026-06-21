import { create } from 'zustand'
import {
  accumulateResponseScore,
  calculateBaseDominance,
  calculateDominance
} from '../domain/scoring/dominanceCalculator'
import type { NormalizedRect } from '../capture/portraitFrame'

export interface DominanceScores {
  candidateFace: number
  interviewerFace: number
  voice: number
  filler: number
  talkRatio: number
  response: number
}

export interface PortraitImageUrls {
  candidate?: string
  interviewer?: string
}

export interface LogEntry {
  id: string
  timestamp: string
  message: string
  type: 'info' | 'warn' | 'success' | 'error'
}

interface DominanceState {
  /** リアルタイム4項目だけで算出した基礎優勢度（LLM補正前） */
  baseDominance: number
  /** LLM補正を適用した最終的な優勢度（UI表示用） */
  dominance: number
  scores: DominanceScores
  portraitImageUrls: PortraitImageUrls
  /**
   * 面接官の顔の自動検出に失敗したときユーザーが手動指定した範囲。面接をまたいで保持し
   * (resetでも消さない)、次回以降は自動検出が失敗してもダイアログを出さず自動適用する。
   */
  interviewerManualFaceRect?: NormalizedRect
  mockMode: boolean
  activeCutin: 'dominance' | 'deficit' | null
  logs: LogEntry[]
  addLog: (message: string, type?: LogEntry['type']) => void
  clearLogs: () => void
  setMockMode: (enabled: boolean) => void
  setDominance: (dominance: number) => void
  setScores: (scores: Partial<DominanceScores>, force?: boolean) => void
  setCandidatePortraitImageUrl: (url: string) => void
  setInterviewerPortraitImageUrl: (url: string) => void
  setInterviewerManualFaceRect: (rect: NormalizedRect | undefined) => void
  triggerCutin: (type: 'dominance' | 'deficit') => void
  clearCutin: () => void
  reset: () => void
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

const initialDominance = 50

const initialScores: DominanceScores = {
  candidateFace: 50,
  interviewerFace: 50,
  voice: 50,
  filler: 50,
  talkRatio: 50,
  response: 50
}

function calculateDominanceState(
  scores: DominanceScores,
  accumulatedResponseScore: number | undefined
): Pick<DominanceState, 'baseDominance' | 'dominance'> {
  const input = {
    timestamp: Date.now(),
    candidateFace: { subject: 'candidate', value: scores.candidateFace } as const,
    interviewerFace: { subject: 'interviewer', value: scores.interviewerFace } as const,
    voice: { value: scores.voice },
    filler: { matchedFillers: [], fillerCount: 0, score: scores.filler },
    talkRatio: { candidateChars: 0, interviewerChars: 0, value: scores.talkRatio },
    // scores.responseはLLM未到達でも中立50で初期化されているため、ここでは「LLM判定が
    // 実際に届いたか」を示すaccumulatedResponseScore(未到達ならundefined)を渡す。
    response: accumulatedResponseScore
  }
  const base = calculateBaseDominance(input)
  const corrected = calculateDominance(input)

  return { baseDominance: base.value, dominance: corrected.value }
}

interface DominanceInternalState extends DominanceState {
  accumulatedResponseScore?: number
}

export const useDominanceStore = create<DominanceInternalState>((set) => ({
  baseDominance: initialDominance,
  dominance: initialDominance,
  scores: initialScores,
  portraitImageUrls: {},
  mockMode: false,
  activeCutin: null,
  logs: [],
  addLog: (message, type = 'info') =>
    set((state) => {
      const now = new Date()
      const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
      const newEntry: LogEntry = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp,
        message,
        type
      }
      return { logs: [newEntry, ...state.logs].slice(0, 50) }
    }),
  clearLogs: () => set({ logs: [] }),
  setMockMode: (mockMode) => {
    set({ mockMode })
    useDominanceStore.getState().addLog(`Mock Mode: ${mockMode ? 'ENABLED (Sensors Ignored)' : 'DISABLED'}`, 'info')
  },
  setDominance: (dominance) => set({ dominance: clamp(dominance) }),
  setScores: (partialScores, force = false) =>
    set((state) => {
      if (state.mockMode && !force) {
        return {}
      }

      const next = { ...state.scores }
      let accumulatedResponseScore = state.accumulatedResponseScore
      const store = useDominanceStore.getState()

      for (const key of Object.keys(partialScores) as Array<keyof DominanceScores>) {
        const value = partialScores[key]
        if (value !== undefined) {
          const clampedValue = key === 'response'
            ? accumulateResponseScore(accumulatedResponseScore, value)
            : clamp(value)
          
          if (next[key] !== clampedValue) {
            const logType = key === 'filler' ? 'warn' : key === 'response' ? 'success' : 'info'
            store.addLog(`[Score Update] ${key}: ${clampedValue} (was ${next[key]})`, logType)
          }

          next[key] = clampedValue

          if (key === 'response') {
            accumulatedResponseScore = next.response
          }
        }
      }

      const calculated = calculateDominanceState(next, accumulatedResponseScore)
      
      if (state.dominance !== calculated.dominance) {
        store.addLog(`[Overall Dominance] ${calculated.dominance} (was ${state.dominance})`, 'info')
      }

      return { scores: next, accumulatedResponseScore, ...calculated }
    }),
  setCandidatePortraitImageUrl: (url) =>
    set((state) => ({
      portraitImageUrls: {
        ...state.portraitImageUrls,
        candidate: url
      }
    })),
  setInterviewerPortraitImageUrl: (url) =>
    set((state) => ({
      portraitImageUrls: {
        ...state.portraitImageUrls,
        interviewer: url
      }
    })),
  setInterviewerManualFaceRect: (rect) => set({ interviewerManualFaceRect: rect }),
  triggerCutin: (type) => {
    set({ activeCutin: type })
    const store = useDominanceStore.getState()
    const logType = type === 'dominance' ? 'success' : 'error'
    const msg = type === 'dominance' 
      ? '🔥 限界突破！優勢カットイン発動 (異議あり！)' 
      : '⚠️ 危機的状況！劣勢カットイン発動'
    store.addLog(msg, logType)
  },
  clearCutin: () => set({ activeCutin: null }),
  reset: () => {
    set({
      accumulatedResponseScore: undefined,
      baseDominance: initialDominance,
      dominance: initialDominance,
      scores: initialScores,
      mockMode: false,
      activeCutin: null,
      logs: []
    })
    useDominanceStore.getState().addLog('System State Reset.', 'info')
  }
}))
