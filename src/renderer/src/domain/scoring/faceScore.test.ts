import { describe, expect, it } from 'vitest'
import { calculateFaceScore } from './faceScore'

describe('calculateFaceScore', () => {
  it('returns 100 for a fully composed, fully smiling face', () => {
    const result = calculateFaceScore({
      subject: 'candidate',
      timestamp: 0,
      tensionLevel: 0,
      smileLevel: 100,
      expression: 'smile'
    })

    expect(result).toEqual({ subject: 'candidate', value: 100 })
  })

  it('returns 0 for a fully tense, expressionless face', () => {
    const result = calculateFaceScore({
      subject: 'interviewer',
      timestamp: 0,
      tensionLevel: 100,
      smileLevel: 0,
      expression: 'tense'
    })

    expect(result.value).toBe(0)
  })

  it('clamps the result so the expression bonus cannot push it past 100', () => {
    const result = calculateFaceScore({
      subject: 'candidate',
      timestamp: 0,
      tensionLevel: 0,
      smileLevel: 95,
      expression: 'smile'
    })

    expect(result.value).toBe(100)
  })

  it('preserves the subject from the input', () => {
    const result = calculateFaceScore({
      subject: 'interviewer',
      timestamp: 123,
      tensionLevel: 50,
      smileLevel: 50,
      expression: 'neutral'
    })

    expect(result.subject).toBe('interviewer')
  })
})
