import {
  FaceLandmarker as MediaPipeFaceLandmarker,
  type FaceLandmarkerOptions as MediaPipeFaceLandmarkerTaskOptions,
  type ImageSource,
  type NormalizedLandmark as MediaPipeNormalizedLandmark
} from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url'

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

type MediaPipeWasmFileset = Parameters<typeof MediaPipeFaceLandmarker.createFromOptions>[0]
type MediaPipeDetector = Awaited<ReturnType<typeof MediaPipeFaceLandmarker.createFromOptions>>

export type MediaPipeFaceLandmarkerDetector = (
  input: FaceLandmarkerInput,
  timestamp: number
) => Promise<NormalizedFaceLandmark[] | null> | NormalizedFaceLandmark[] | null

export interface MediaPipeFaceLandmarkerOptions {
  detect?: MediaPipeFaceLandmarkerDetector
  close?: () => void | Promise<void>
  now?: () => number
  modelAssetPath?: string
  taskOptions?: Omit<MediaPipeFaceLandmarkerTaskOptions, 'baseOptions'>
  wasmFileset?: MediaPipeWasmFileset
}

export const DEFAULT_FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export function createFaceLandmarker(
  options: MediaPipeFaceLandmarkerOptions = {}
): FaceLandmarker {
  let detectorPromise: Promise<MediaPipeDetector> | null = null

  const getDetector = (): Promise<MediaPipeDetector> => {
    detectorPromise ??= MediaPipeFaceLandmarker.createFromOptions(
      options.wasmFileset ?? createDefaultWasmFileset(),
      {
        ...options.taskOptions,
        runningMode: options.taskOptions?.runningMode ?? 'VIDEO',
        numFaces: options.taskOptions?.numFaces ?? 1,
        baseOptions: {
          modelAssetPath: options.modelAssetPath ?? DEFAULT_FACE_LANDMARKER_MODEL_URL
        }
      }
    )

    return detectorPromise
  }

  return {
    async detect(input, timestamp = options.now?.() ?? Date.now()) {
      const landmarks =
        options.detect === undefined
          ? await detectWithMediaPipe(await getDetector(), input, timestamp)
          : ((await options.detect(input, timestamp)) ?? null)

      if (landmarks === null) {
        return null
      }

      return { timestamp, landmarks }
    },
    async close() {
      await options.close?.()

      const detector = await detectorPromise
      detector?.close()
    }
  }
}

export function createStubFaceLandmarker(
  landmarks: NormalizedFaceLandmark[] = []
): FaceLandmarker {
  return createFaceLandmarker({
    detect: () => landmarks
  })
}

function createDefaultWasmFileset(): MediaPipeWasmFileset {
  return {
    wasmLoaderPath,
    wasmBinaryPath
  }
}

function detectWithMediaPipe(
  detector: MediaPipeDetector,
  input: FaceLandmarkerInput,
  timestamp: number
): NormalizedFaceLandmark[] | null {
  let result: ReturnType<MediaPipeDetector['detectForVideo']>

  try {
    result = detector.detectForVideo(input as ImageSource, timestamp)
  } catch {
    return null
  }

  const landmarks = result.faceLandmarks[0]

  if (!landmarks || landmarks.length === 0) {
    return null
  }

  return landmarks.map(toNormalizedFaceLandmark)
}

function toNormalizedFaceLandmark(
  landmark: MediaPipeNormalizedLandmark
): NormalizedFaceLandmark {
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility
  }
}
