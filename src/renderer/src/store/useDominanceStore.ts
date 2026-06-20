import { create } from 'zustand'
import {
  accumulateResponseScore,
  calculateBaseDominance,
  calculateDominance
} from '../domain/scoring/dominanceCalculator'

export interface DominanceScores {
  candidateFace: number
  interviewerFace: number
  voice: number
  filler: number
  response: number
}

export interface PortraitImageUrls {
  candidate?: string
}

interface DominanceState {
  /** リアルタイム4項目だけで算出した基礎優勢度（LLM補正前） */
  baseDominance: number
  /** LLM補正を適用した最終的な優勢度（UI表示用） */
  dominance: number
  scores: DominanceScores
  portraitImageUrls: PortraitImageUrls
  mockMode: boolean
  activeCutin: 'dominance' | 'deficit' | null
  setMockMode: (enabled: boolean) => void
  setDominance: (dominance: number) => void
  setScores: (scores: Partial<DominanceScores>, force?: boolean) => void
  setCandidatePortraitImageUrl: (url: string) => void
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
  response: 50
}

function calculateDominanceState(
  scores: DominanceScores
): Pick<DominanceState, 'baseDominance' | 'dominance'> {
  const input = {
    timestamp: Date.now(),
    candidateFace: { subject: 'candidate', value: scores.candidateFace } as const,
    interviewerFace: { subject: 'interviewer', value: scores.interviewerFace } as const,
    voice: { value: scores.voice },
    filler: { matchedFillers: [], fillerCount: 0, score: scores.filler },
    response: scores.response
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
  setMockMode: (mockMode) => set({ mockMode }),
  setDominance: (dominance) => set({ dominance: clamp(dominance) }),
  setScores: (partialScores, force = false) =>
    set((state) => {
      // mockMode中はforceフラグがない更新（＝通常センサー等からの自動流入）を無視する
      if (state.mockMode && !force) {
        return {}
      }

      const next = { ...state.scores }
      let accumulatedResponseScore = state.accumulatedResponseScore

      for (const key of Object.keys(partialScores) as Array<keyof DominanceScores>) {
        const value = partialScores[key]
        if (value !== undefined) {
          next[key] =
            key === 'response'
              ? accumulateResponseScore(accumulatedResponseScore, value)
              : clamp(value)

          if (key === 'response') {
            accumulatedResponseScore = next.response
          }
        }
      }

      return { scores: next, accumulatedResponseScore, ...calculateDominanceState(next) }
    }),
  setCandidatePortraitImageUrl: (url) =>
    set((state) => ({
      portraitImageUrls: {
        ...state.portraitImageUrls,
        candidate: url
      }
    })),
  triggerCutin: (type) => set({ activeCutin: type }),
  clearCutin: () => set({ activeCutin: null }),
  reset: () =>
    set({
      accumulatedResponseScore: undefined,
      baseDominance: initialDominance,
      dominance: initialDominance,
      scores: initialScores,
      mockMode: false,
      activeCutin: null
    })
}))
