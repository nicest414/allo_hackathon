import { describe, expect, it } from 'vitest'
import {
  VoiceFeatureAccumulator,
  analyzeVoiceFeatures,
  analyzeVoiceSamples,
  createMeydaVoiceAnalyzer,
  createVoiceAnalyzer,
  type MeydaLike
} from './voiceAnalyzer'
import type { MeydaFeaturesObject } from 'meyda'

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

  it('aggregates Meyda feature callbacks into normalized voice analysis', () => {
    let now = 1000
    const accumulator = new VoiceFeatureAccumulator({
      now: () => now,
      sampleRate: 48000,
      pauseRmsThreshold: 0.015,
      rollingWindowMs: 5000,
      pitchMinHz: 80,
      pitchMaxHz: 500,
      speechEnergyThreshold: 0.025
    })

    const lowPitchBuffer = sineWave(180, 48000, 0.04)
    const highPitchBuffer = sineWave(240, 48000, 0.04)

    accumulator.push({
      rms: 0.04,
      zcr: countZeroCrossings(lowPitchBuffer),
      buffer: Array.from(lowPitchBuffer)
    })
    now += 1000
    accumulator.push({
      rms: 0.001,
      zcr: 0,
      buffer: Array.from(silence(480))
    })
    now += 1000
    const result = accumulator.push({
      rms: 0.04,
      zcr: countZeroCrossings(highPitchBuffer),
      buffer: Array.from(highPitchBuffer)
    })

    expect(result.pauseRatio).toBeCloseTo(1 / 3)
    expect(result.speechRate).toBeGreaterThan(5)
    expect(result.speechRate).toBeLessThan(7)
    expect(result.pitchVariation).toBeGreaterThan(0)
    expect(result.pitchVariation).toBeLessThanOrEqual(1)
  })

  it('connects a MediaStream to a mockable Meyda analyzer', async () => {
    let callback: (features: Partial<MeydaFeaturesObject>) => void = () => undefined
    let started = false
    let stopped = false

    const source = { disconnect: () => undefined } as AudioNode
    const audioContext = {
      sampleRate: 48000,
      state: 'running',
      createMediaStreamSource: () => source,
      close: async () => undefined,
      resume: async () => undefined
    } as unknown as AudioContext
    const meyda: MeydaLike = {
      createMeydaAnalyzer(options) {
        callback = options.callback
        return {
          start() {
            started = true
          },
          stop() {
            stopped = true
          }
        }
      }
    }

    const analyzer = await createMeydaVoiceAnalyzer({
      stream: {} as MediaStream,
      audioContext,
      meyda,
      now: () => 321
    })

    analyzer.start()
    callback({ rms: 0.001, zcr: 0, buffer: Array.from(silence(1024)) })

    expect(started).toBe(true)
    expect(analyzer.getLatest()).toEqual({
      timestamp: 321,
      pitchVariation: 0,
      speechRate: 0,
      pauseRatio: 1
    })

    await analyzer.dispose()
    expect(stopped).toBe(true)
  })

  it('releases created audio resources when Meyda initialization fails', async () => {
    let disconnected = false
    let closed = false
    const source = {
      disconnect() {
        disconnected = true
      }
    } as MediaStreamAudioSourceNode
    const audioContext = {
      sampleRate: 48000,
      state: 'running',
      createMediaStreamSource: () => source,
      close: async () => {
        closed = true
      },
      resume: async () => undefined
    } as unknown as AudioContext
    const meyda: MeydaLike = {
      createMeydaAnalyzer() {
        throw new Error('meyda failed')
      }
    }

    const analyzer = await createMeydaVoiceAnalyzer({
      stream: {} as MediaStream,
      audioContext,
      meyda,
      now: () => 999
    })

    expect(disconnected).toBe(true)
    expect(closed).toBe(false)
    expect(analyzer.getLatest()).toEqual({
      timestamp: 999,
      pitchVariation: 0,
      speechRate: 0,
      pauseRatio: 1
    })
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

function silence(sampleCount: number): Float32Array {
  return new Float32Array(sampleCount)
}

function countZeroCrossings(samples: Float32Array): number {
  let crossings = 0

  for (let index = 1; index < samples.length; index += 1) {
    if (
      (samples[index - 1] >= 0 && samples[index] < 0) ||
      (samples[index - 1] < 0 && samples[index] >= 0)
    ) {
      crossings += 1
    }
  }

  return crossings
}
