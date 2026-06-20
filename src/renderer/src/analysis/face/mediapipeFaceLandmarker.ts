import {
  FaceLandmarker as MediaPipeFaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerOptions,
  type ImageSource,
  type NormalizedLandmark
} from '@mediapipe/tasks-vision'
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  NormalizedFaceLandmark
} from './faceLandmarker'

// CSP(script-src 'self')のためCDNから読み込めない。electron.vite.config.tsがビルド/dev起動時に
// node_modulesからsrc/renderer/public/mediapipe/wasmへコピーした同一オリジンのファイルを使う。
// BASE_URLはdevで'/'、本番ビルドでは'./'(electron-viteがfile://読み込み用に強制)になる。
const defaultWasmBaseUrl = `${import.meta.env.BASE_URL}mediapipe/wasm`
const defaultModelAssetPath =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export interface CreateMediaPipeFaceLandmarkerOptions {
  wasmBaseUrl?: string
  modelAssetPath?: string
  minFaceDetectionConfidence?: number
  minFacePresenceConfidence?: number
}

export async function createMediaPipeFaceLandmarker(
  options: CreateMediaPipeFaceLandmarkerOptions = {}
): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(options.wasmBaseUrl ?? defaultWasmBaseUrl)
  const landmarker = await MediaPipeFaceLandmarker.createFromOptions(
    vision,
    toMediaPipeFaceLandmarkerOptions(options)
  )

  return {
    async detect(input, timestamp = Date.now()) {
      const result = landmarker.detect(input as ImageSource)
      return toFaceLandmarkerResult(result, timestamp)
    },
    close: () => landmarker.close()
  }
}

function toMediaPipeFaceLandmarkerOptions(
  options: CreateMediaPipeFaceLandmarkerOptions
): FaceLandmarkerOptions {
  return {
    baseOptions: {
      modelAssetPath: options.modelAssetPath ?? defaultModelAssetPath,
      delegate: 'CPU'
    },
    runningMode: 'IMAGE',
    numFaces: 1,
    minFaceDetectionConfidence: options.minFaceDetectionConfidence ?? 0.5,
    minFacePresenceConfidence: options.minFacePresenceConfidence ?? 0.5
  }
}

function toFaceLandmarkerResult(
  result: ReturnType<MediaPipeFaceLandmarker['detect']>,
  timestamp: number
): FaceLandmarkerResult | null {
  const landmarks = result.faceLandmarks[0]?.map(toNormalizedFaceLandmark) ?? null

  if (landmarks === null) {
    return null
  }

  return {
    timestamp,
    landmarks
  }
}

function toNormalizedFaceLandmark(landmark: NormalizedLandmark): NormalizedFaceLandmark {
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility
  }
}
