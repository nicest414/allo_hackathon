import { create } from 'zustand'

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
  dominance: number
  scores: DominanceScores
  portraitImageUrls: PortraitImageUrls
  setDominance: (dominance: number) => void
  setScores: (scores: Partial<DominanceScores>) => void
  setCandidatePortraitImageUrl: (url: string) => void
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
  dominance: initialDominance,
  scores: initialScores,
  portraitImageUrls: {},
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
  setCandidatePortraitImageUrl: (url) =>
    set((state) => ({
      portraitImageUrls: {
        ...state.portraitImageUrls,
        candidate: url
      }
    })),
  reset: () => set({ dominance: initialDominance, scores: initialScores })
}))
