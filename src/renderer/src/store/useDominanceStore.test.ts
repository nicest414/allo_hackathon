import { beforeEach, describe, expect, it } from 'vitest'
import { useDominanceStore } from './useDominanceStore'

describe('useDominanceStore', () => {
  beforeEach(() => {
    useDominanceStore.getState().reset()
  })

  it('recalculates base and corrected dominance when realtime scores change', () => {
    useDominanceStore.getState().setScores({
      candidateFace: 100,
      interviewerFace: 100,
      voice: 0,
      filler: 0,
      talkRatio: 100
    })

    const state = useDominanceStore.getState()
    expect(state.baseDominance).toBe(100)
    expect(state.dominance).toBe(100)
  })

  it('makes the LLM response score the primary displayed dominance once it arrives', () => {
    useDominanceStore.getState().setScores({ response: 100 })

    const state = useDominanceStore.getState()
    expect(state.baseDominance).toBe(50)
    // base(50)は中立なので微調整は0、LLMスコアがそのまま優勢度になる
    expect(state.dominance).toBe(100)
    expect(state.scores.response).toBe(100)
  })

  it('accumulates repeated response scores with EMA before applying the fine-tune', () => {
    const store = useDominanceStore.getState()
    store.setScores({ response: 100 })
    store.setScores({ response: 0 })

    const state = useDominanceStore.getState()
    expect(state.scores.response).toBe(40)
    expect(state.dominance).toBe(40)
  })

  it('keeps portrait image URLs when dominance scores reset', () => {
    const store = useDominanceStore.getState()
    store.setCandidatePortraitImageUrl('portrait.png')
    store.setInterviewerPortraitImageUrl('interviewer.png')
    store.reset()

    expect(useDominanceStore.getState().portraitImageUrls.candidate).toBe('portrait.png')
    expect(useDominanceStore.getState().portraitImageUrls.interviewer).toBe('interviewer.png')
  })

  it('stores the interviewer portrait image URL independently from the candidate one', () => {
    const store = useDominanceStore.getState()
    store.setCandidatePortraitImageUrl('candidate.png')
    store.setInterviewerPortraitImageUrl('interviewer.png')

    const { portraitImageUrls } = useDominanceStore.getState()
    expect(portraitImageUrls.candidate).toBe('candidate.png')
    expect(portraitImageUrls.interviewer).toBe('interviewer.png')
  })

  it('keeps the manually specified interviewer face rect across interviews (reset)', () => {
    const store = useDominanceStore.getState()
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.3 }
    store.setInterviewerManualFaceRect(rect)
    store.reset()

    expect(useDominanceStore.getState().interviewerManualFaceRect).toEqual(rect)
  })

  it('clears the manually specified interviewer face rect when set to undefined', () => {
    const store = useDominanceStore.getState()
    store.setInterviewerManualFaceRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.3 })
    store.setInterviewerManualFaceRect(undefined)

    expect(useDominanceStore.getState().interviewerManualFaceRect).toBeUndefined()
  })
})
