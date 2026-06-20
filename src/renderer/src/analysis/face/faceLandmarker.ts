export interface NormalizedFaceLandmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface FaceLandmarkerResult {
  timestamp: number
  landmarks: NormalizedFaceLandmark[]
}

export type FaceLandmarkerInput = CanvasImageSource | ImageData

export interface FaceLandmarker {
  detect(input: FaceLandmarkerInput, timestamp?: number): Promise<FaceLandmarkerResult | null>
  close?(): void | Promise<void>
}

export type MediaPipeFaceLandmarkerDetector = (
  input: FaceLandmarkerInput,
  timestamp: number
) => Promise<NormalizedFaceLandmark[] | null> | NormalizedFaceLandmark[] | null

export interface MediaPipeFaceLandmarkerOptions {
  detect?: MediaPipeFaceLandmarkerDetector
  close?: () => void | Promise<void>
  now?: () => number
}

export function createFaceLandmarker(
  options: MediaPipeFaceLandmarkerOptions = {}
): FaceLandmarker {
  return {
    async detect(input, timestamp = options.now?.() ?? Date.now()) {
      const landmarks = (await options.detect?.(input, timestamp)) ?? null

      if (landmarks === null) {
        return null
      }

      return { timestamp, landmarks }
    },
    close: options.close
  }
}

export function createStubFaceLandmarker(
  landmarks: NormalizedFaceLandmark[] = []
): FaceLandmarker {
  return createFaceLandmarker({
    detect: () => landmarks
  })
}
