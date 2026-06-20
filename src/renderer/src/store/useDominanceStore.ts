import { create } from 'zustand'

export interface DominanceScores {
  candidateFace: number
  interviewerFace: number
  voice: number
  filler: number
  response: number
}

interface DominanceState {
  /** リアルタイム4項目だけで算出した基礎優勢度（LLM補正前） */
  baseDominance: number
  /** LLM補正を適用した最終的な優勢度（UI表示用） */
  dominance: number
  scores: DominanceScores
  setBaseDominance: (baseDominance: number) => void
  setDominance: (dominance: number) => void
  setScores: (scores: Partial<DominanceScores>) => void
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

export const useDominanceStore = create<DominanceState>((set) => ({
  baseDominance: initialDominance,
  dominance: initialDominance,
  scores: initialScores,
  setBaseDominance: (baseDominance) => set({ baseDominance: clamp(baseDominance) }),
  setDominance: (dominance) => set({ dominance: clamp(dominance) }),
  setScores: (partialScores) =>
    set((state) => {
      const next = { ...state.scores }
      for (const key of Object.keys(partialScores) as Array<keyof DominanceScores>) {
        const value = partialScores[key]
        if (value !== undefined) {
          next[key] = clamp(value)
        }
      }
      return { scores: next }
    }),
  reset: () =>
    set({ baseDominance: initialDominance, dominance: initialDominance, scores: initialScores })
}))
