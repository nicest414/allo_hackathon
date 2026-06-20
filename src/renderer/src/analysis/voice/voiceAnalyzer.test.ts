import { describe, expect, it } from 'vitest'
import { analyzeVoiceFeatures, analyzeVoiceSamples, createVoiceAnalyzer } from './voiceAnalyzer'

describe('voiceAnalyzer', () => {
  it('returns a fully paused result for empty input', () => {
    const result = analyzeVoiceSamples({
      samples: [],
      sampleRate: 48000,
      timestamp: 123
    })

    expect(result).toEqual({
      timestamp: 123,
      pitchVariation: 0,
      speechRate: 0,
      pauseRatio: 1
    })
  })

  it('estimates pause ratio from audible samples without faking Meyda features', () => {
    const result = analyzeVoiceSamples({
      samples: sineWave(440, 48000, 0.2),
      sampleRate: 48000,
      timestamp: 456
    })

    expect(result.timestamp).toBe(456)
    expect(result.pauseRatio).toBe(0)
    expect(result.pitchVariation).toBe(0)
    expect(result.speechRate).toBe(0)
  })

  it('maps extracted Meyda-like features to VoiceAnalysisResult', () => {
    const result = analyzeVoiceFeatures({
      features: {
        pitchVariation: 0.8,
        speechRate: 5.5,
        pauseRatio: 0.25
      },
      timestamp: 654
    })

    expect(result).toEqual({
      timestamp: 654,
      pitchVariation: 0.8,
      speechRate: 5.5,
      pauseRatio: 0.25
    })
  })

  it('exposes an async analyzer interface for a future Meyda wrapper', async () => {
    const analyzer = createVoiceAnalyzer({ now: () => 789 })
    const result = await analyzer.analyze({
      features: {
        pitchVariation: 2,
        speechRate: -1,
        pauseRatio: -1
      }
    })

    expect(result.timestamp).toBe(789)
    expect(result.pitchVariation).toBe(1)
    expect(result.speechRate).toBe(0)
    expect(result.pauseRatio).toBe(0)
  })
})

function sineWave(frequency: number, sampleRate: number, seconds: number): Float32Array {
  const sampleCount = Math.floor(sampleRate * seconds)
  const samples = new Float32Array(sampleCount)

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.2
  }

  return samples
}
