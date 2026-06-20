import type { VoiceAnalysisResult } from '../../../../shared/types/analysis'
import type { MeydaAudioFeature, MeydaFeaturesObject } from 'meyda'

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

export interface RealtimeVoiceAnalyzer {
  start(): void
  stop(): void
  getLatest(): VoiceAnalysisResult
  analyze(input?: VoiceAnalyzerInput): Promise<VoiceAnalysisResult>
  dispose(): Promise<void>
}

export interface MeydaAnalyzerLike {
  start(features?: MeydaAudioFeature | ReadonlyArray<MeydaAudioFeature>): void
  stop(): void
}

export interface MeydaLike {
  createMeydaAnalyzer(options: {
    audioContext: AudioContext
    source: AudioNode
    bufferSize: number
    hopSize?: number
    sampleRate?: number
    startImmediately?: boolean
    featureExtractors: ReadonlyArray<MeydaAudioFeature>
    callback: (features: Partial<MeydaFeaturesObject>) => void
  }): MeydaAnalyzerLike
}

export interface MeydaVoiceAnalyzerOptions extends VoiceAnalyzerOptions {
  stream: MediaStream
  audioContext?: AudioContext
  meyda?: MeydaLike
  bufferSize?: number
  hopSize?: number
  rollingWindowMs?: number
  pitchMinHz?: number
  pitchMaxHz?: number
  speechEnergyThreshold?: number
}

const DEFAULT_PAUSE_RMS_THRESHOLD = 0.015
const DEFAULT_PAUSE_WINDOW_MS = 100
const DEFAULT_BUFFER_SIZE = 1024
const DEFAULT_ROLLING_WINDOW_MS = 5000
const DEFAULT_PITCH_MIN_HZ = 80
const DEFAULT_PITCH_MAX_HZ = 500
const DEFAULT_SPEECH_ENERGY_THRESHOLD = 0.025
const FALLBACK_FRAME_DURATION_SECONDS = DEFAULT_BUFFER_SIZE / 48000
const MEYDA_FEATURES: ReadonlyArray<MeydaAudioFeature> = [
  'rms',
  'zcr',
  'spectralCentroid',
  'buffer'
]

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

export async function createMeydaVoiceAnalyzer(
  options: MeydaVoiceAnalyzerOptions
): Promise<RealtimeVoiceAnalyzer> {
  let audioContext: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  const shouldOwnAudioContext = !options.audioContext

  try {
    const activeAudioContext = options.audioContext ?? createAudioContext()
    audioContext = activeAudioContext
    const meyda = options.meyda ?? (await import('meyda')).default
    const activeSource = activeAudioContext.createMediaStreamSource(options.stream)
    source = activeSource
    const accumulator = new VoiceFeatureAccumulator({
      now: options.now,
      sampleRate: activeAudioContext.sampleRate,
      pauseRmsThreshold: options.pauseRmsThreshold ?? DEFAULT_PAUSE_RMS_THRESHOLD,
      rollingWindowMs: options.rollingWindowMs ?? DEFAULT_ROLLING_WINDOW_MS,
      pitchMinHz: options.pitchMinHz ?? DEFAULT_PITCH_MIN_HZ,
      pitchMaxHz: options.pitchMaxHz ?? DEFAULT_PITCH_MAX_HZ,
      speechEnergyThreshold: options.speechEnergyThreshold ?? DEFAULT_SPEECH_ENERGY_THRESHOLD
    })

    const analyzer = meyda.createMeydaAnalyzer({
      audioContext: activeAudioContext,
      source: activeSource,
      bufferSize: options.bufferSize ?? DEFAULT_BUFFER_SIZE,
      hopSize: options.hopSize,
      sampleRate: activeAudioContext.sampleRate,
      startImmediately: false,
      featureExtractors: MEYDA_FEATURES,
      callback: (features) => accumulator.push(features)
    })

    return {
      start() {
        resumeAudioContext(activeAudioContext)
        analyzer.start(MEYDA_FEATURES)
      },
      stop() {
        analyzer.stop()
      },
      getLatest() {
        return accumulator.getResult()
      },
      async analyze(input) {
        return input ? createVoiceAnalyzer(options).analyze(input) : accumulator.getResult()
      },
      async dispose() {
        analyzer.stop()
        activeSource.disconnect()
        if (!options.audioContext && activeAudioContext.state !== 'closed') {
          await activeAudioContext.close()
        }
      }
    }
  } catch {
    source?.disconnect()
    if (shouldOwnAudioContext && audioContext && audioContext.state !== 'closed') {
      await audioContext.close()
    }

    return createFallbackRealtimeVoiceAnalyzer(options)
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

interface VoiceFeatureAccumulatorOptions {
  now?: () => number
  sampleRate: number
  pauseRmsThreshold: number
  rollingWindowMs: number
  pitchMinHz: number
  pitchMaxHz: number
  speechEnergyThreshold: number
}

interface VoiceFrame {
  timestamp: number
  rms: number
  zcr: number
  durationSeconds: number
  pitchHz: number | null
  voiced: boolean
  speechRate: number
}

export class VoiceFeatureAccumulator {
  private readonly options: VoiceFeatureAccumulatorOptions
  private readonly frames: VoiceFrame[] = []

  constructor(options: VoiceFeatureAccumulatorOptions) {
    this.options = options
  }

  push(features: Partial<MeydaFeaturesObject>): VoiceAnalysisResult {
    const timestamp = this.options.now?.() ?? Date.now()
    const rms = sanitizeFinite(features.rms, 0)
    const zcr = sanitizeFinite(features.zcr, 0)
    const voiced = rms >= this.options.pauseRmsThreshold
    const durationSeconds = estimateFrameDurationSeconds(features.buffer, this.options.sampleRate)
    const pitchHz = voiced ? estimatePitchHz(features.buffer, this.options) : null
    const speechRate =
      voiced && rms >= this.options.speechEnergyThreshold
        ? estimateFrameSpeechRate(zcr, durationSeconds)
        : 0

    this.frames.push({ timestamp, rms, zcr, durationSeconds, pitchHz, voiced, speechRate })
    this.trim(timestamp)

    return this.getResult(timestamp)
  }

  getResult(timestamp = this.options.now?.() ?? Date.now()): VoiceAnalysisResult {
    this.trim(timestamp)

    if (this.frames.length === 0) {
      return {
        timestamp,
        pitchVariation: 0,
        speechRate: 0,
        pauseRatio: 1
      }
    }

    const silentFrames = this.frames.filter((frame) => !frame.voiced).length
    const pitchValues = this.frames
      .map((frame) => frame.pitchHz)
      .filter((pitchHz): pitchHz is number => pitchHz !== null)
    const firstTimestamp = this.frames[0].timestamp
    const elapsedSeconds = Math.max((timestamp - firstTimestamp) / 1000, 1)
    const voicedFrames = this.frames.filter((frame) => frame.voiced)

    return {
      timestamp,
      pitchVariation: normalizePitchVariation(pitchValues),
      speechRate: estimateSpeechRate(voicedFrames, elapsedSeconds),
      pauseRatio: clamp01(silentFrames / this.frames.length)
    }
  }

  private trim(timestamp: number): void {
    const minTimestamp = timestamp - this.options.rollingWindowMs

    while (this.frames.length > 0 && this.frames[0].timestamp < minTimestamp) {
      this.frames.shift()
    }
  }
}

function estimateFrameDurationSeconds(
  buffer: Partial<MeydaFeaturesObject>['buffer'],
  sampleRate: number
): number {
  return buffer && buffer.length > 0 ? buffer.length / sampleRate : FALLBACK_FRAME_DURATION_SECONDS
}

function estimateFrameSpeechRate(zcr: number, durationSeconds: number): number {
  if (durationSeconds <= 0 || zcr <= 0) {
    return 0
  }

  const zeroCrossingsPerSecond = zcr / durationSeconds
  return Math.min(9, Math.max(3, 3 + (zeroCrossingsPerSecond / 900) * 6))
}

function estimateSpeechRate(voicedFrames: VoiceFrame[], elapsedSeconds: number): number {
  if (voicedFrames.length === 0) {
    return 0
  }

  const voicedSeconds = voicedFrames.reduce((sum, frame) => sum + frame.durationSeconds, 0)
  const weightedSpeechUnits = voicedFrames.reduce(
    (sum, frame) => sum + frame.speechRate * frame.durationSeconds,
    0
  )

  return voicedSeconds > 0 ? weightedSpeechUnits / voicedSeconds : voicedFrames.length / elapsedSeconds
}

function createFallbackRealtimeVoiceAnalyzer(options: VoiceAnalyzerOptions): RealtimeVoiceAnalyzer {
  const getResult = (): VoiceAnalysisResult => ({
    timestamp: options.now?.() ?? Date.now(),
    pitchVariation: 0,
    speechRate: 0,
    pauseRatio: 1
  })

  return {
    start() {},
    stop() {},
    getLatest() {
      return getResult()
    },
    async analyze(input) {
      return input ? createVoiceAnalyzer(options).analyze(input) : getResult()
    },
    async dispose() {}
  }
}

function createAudioContext(): AudioContext {
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextCtor) {
    throw new Error('AudioContext is not available')
  }

  return new AudioContextCtor()
}

function resumeAudioContext(audioContext: AudioContext): void {
  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }
}

function estimatePitchHz(
  buffer: Partial<MeydaFeaturesObject>['buffer'],
  options: VoiceFeatureAccumulatorOptions
): number | null {
  if (!buffer || buffer.length < 2) {
    return null
  }

  const samples = Array.from(buffer)
  const minLag = Math.max(1, Math.floor(options.sampleRate / options.pitchMaxHz))
  const maxLag = Math.min(samples.length - 1, Math.floor(options.sampleRate / options.pitchMinHz))
  let bestLag = 0
  let bestCorrelation = 0

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0

    for (let index = 0; index < samples.length - lag; index += 1) {
      correlation += samples[index] * samples[index + lag]
    }

    correlation /= samples.length - lag
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }

  if (bestLag === 0 || bestCorrelation <= 0) {
    return null
  }

  return options.sampleRate / bestLag
}

function normalizePitchVariation(pitchValues: number[]): number {
  if (pitchValues.length < 2) {
    return 0
  }

  const mean = pitchValues.reduce((sum, value) => sum + value, 0) / pitchValues.length
  if (mean <= 0) {
    return 0
  }

  const variance =
    pitchValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pitchValues.length
  const coefficientOfVariation = Math.sqrt(variance) / mean

  return clamp01(coefficientOfVariation / 0.25)
}

function sanitizeFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
