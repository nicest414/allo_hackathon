import type { VoiceAnalysisResult } from '../../../../shared/types/analysis'

export interface VoiceAnalyzerFeatures {
  pitchVariation: number
  speechRate: number
  pauseRatio: number
}

export interface VoiceSamplesInput {
  samples: Float32Array | number[]
  sampleRate: number
  timestamp?: number
}

export interface VoiceFeaturesInput {
  features: VoiceAnalyzerFeatures
  timestamp?: number
}

export type VoiceAnalyzerInput = VoiceSamplesInput | VoiceFeaturesInput

export interface VoiceAnalyzerOptions {
  pauseRmsThreshold?: number
  pauseWindowMs?: number
  now?: () => number
}

export interface VoiceAnalyzer {
  analyze(input: VoiceAnalyzerInput): Promise<VoiceAnalysisResult>
}

const DEFAULT_PAUSE_RMS_THRESHOLD = 0.015
const DEFAULT_PAUSE_WINDOW_MS = 100

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export function createVoiceAnalyzer(options: VoiceAnalyzerOptions = {}): VoiceAnalyzer {
  return {
    async analyze(input) {
      return isFeaturesInput(input)
        ? analyzeVoiceFeatures(input, options)
        : analyzeVoiceSamples(input, options)
    }
  }
}

export function analyzeVoiceSamples(
  input: VoiceSamplesInput,
  options: VoiceAnalyzerOptions = {}
): VoiceAnalysisResult {
  const samples = Array.from(input.samples)
  const timestamp = input.timestamp ?? options.now?.() ?? Date.now()

  if (samples.length === 0 || input.sampleRate <= 0) {
    return {
      timestamp,
      pitchVariation: 0,
      speechRate: 0,
      pauseRatio: 1
    }
  }

  const pauseRatio = estimatePauseRatio(
    samples,
    input.sampleRate,
    options.pauseRmsThreshold ?? DEFAULT_PAUSE_RMS_THRESHOLD,
    options.pauseWindowMs ?? DEFAULT_PAUSE_WINDOW_MS
  )

  return {
    timestamp,
    pitchVariation: 0,
    speechRate: 0,
    pauseRatio
  }
}

export function analyzeVoiceFeatures(
  input: VoiceFeaturesInput,
  options: VoiceAnalyzerOptions = {}
): VoiceAnalysisResult {
  return {
    timestamp: input.timestamp ?? options.now?.() ?? Date.now(),
    pitchVariation: clamp01(input.features.pitchVariation),
    speechRate: Math.max(0, input.features.speechRate),
    pauseRatio: clamp01(input.features.pauseRatio)
  }
}

function isFeaturesInput(input: VoiceAnalyzerInput): input is VoiceFeaturesInput {
  return 'features' in input
}

function estimatePauseRatio(
  samples: number[],
  sampleRate: number,
  rmsThreshold: number,
  windowMs: number
): number {
  const windowSize = Math.max(1, Math.floor((sampleRate * windowMs) / 1000))
  let silentWindows = 0
  let totalWindows = 0

  for (let index = 0; index < samples.length; index += windowSize) {
    const window = samples.slice(index, index + windowSize)
    const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length)

    totalWindows += 1
    if (rms < rmsThreshold) {
      silentWindows += 1
    }
  }

  return totalWindows === 0 ? 1 : silentWindows / totalWindows
}
