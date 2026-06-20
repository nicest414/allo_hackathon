import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaceLandmarker as MediaPipeFaceLandmarker } from '@mediapipe/tasks-vision'
import { createCandidateFaceAnalyzer, toFaceAnalysisResult } from './candidateFaceAnalyzer'
import { createInterviewerFaceAnalyzer } from './interviewerFaceAnalyzer'
import {
  DEFAULT_FACE_LANDMARKER_MODEL_URL,
  createFaceLandmarker,
  createStubFaceLandmarker,
  type NormalizedFaceLandmark
} from './faceLandmarker'

vi.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: {
    createFromOptions: vi.fn()
  }
}))

const createMediaPipeFromOptions = vi.mocked(MediaPipeFaceLandmarker.createFromOptions)

beforeEach(() => {
  createMediaPipeFromOptions.mockReset()
})

describe('face analyzers', () => {
  it('returns unknown when the landmarker has no face result', () => {
    const result = toFaceAnalysisResult('candidate', null, 123)

    expect(result).toEqual({
      subject: 'candidate',
      timestamp: 123,
      tensionLevel: 0,
      smileLevel: 0,
      expression: 'unknown'
    })
  })

  it('preserves the landmarker timestamp when a face result has no landmarks', () => {
    const result = toFaceAnalysisResult(
      'candidate',
      {
        timestamp: 456,
        landmarks: []
      },
      123
    )

    expect(result).toEqual({
      subject: 'candidate',
      timestamp: 456,
      tensionLevel: 0,
      smileLevel: 0,
      expression: 'unknown'
    })
  })

  it('maps candidate landmarks to FaceAnalysisResult', async () => {
    const analyzer = createCandidateFaceAnalyzer({
      landmarker: createStubFaceLandmarker(smilingLandmarks()),
      now: () => 456
    })

    const result = await analyzer.analyze({} as ImageData)

    expect(result.subject).toBe('candidate')
    expect(result.timestamp).toBe(456)
    expect(result.expression).toBe('smile')
    expect(result.smileLevel).toBeGreaterThan(60)
  })

  it('preserves interviewer subject for screen-frame analysis', async () => {
    const analyzer = createInterviewerFaceAnalyzer({
      landmarker: createStubFaceLandmarker(smilingLandmarks()),
      now: () => 789
    })

    const result = await analyzer.analyze({} as ImageData)

    expect(result.subject).toBe('interviewer')
  })

  it('forwards landmarker cleanup through the analyzer boundary', async () => {
    const close = vi.fn()
    const analyzer = createCandidateFaceAnalyzer({
      landmarker: createFaceLandmarker({
        detect: () => [],
        close
      })
    })

    await analyzer.close?.()

    expect(close).toHaveBeenCalledOnce()
  })
})

describe('MediaPipe face landmarker wrapper', () => {
  it('lazily creates a MediaPipe FaceLandmarker and maps the first detected face', async () => {
    const detectForVideo = vi.fn(() => ({
      faceLandmarks: [[{ x: 0.1, y: 0.2, z: -0.3, visibility: 0.9 }]],
      faceBlendshapes: [],
      facialTransformationMatrixes: []
    }))
    createMediaPipeFromOptions.mockResolvedValue({
      detectForVideo,
      close: vi.fn()
    } as unknown as Awaited<ReturnType<typeof MediaPipeFaceLandmarker.createFromOptions>>)
    const input = {} as ImageData

    const landmarker = createFaceLandmarker({
      now: () => 123,
      wasmFileset: {
        wasmLoaderPath: '/test/vision.js',
        wasmBinaryPath: '/test/vision.wasm'
      }
    })

    const result = await landmarker.detect(input)

    expect(createMediaPipeFromOptions).toHaveBeenCalledOnce()
    expect(createMediaPipeFromOptions).toHaveBeenCalledWith(
      {
        wasmLoaderPath: '/test/vision.js',
        wasmBinaryPath: '/test/vision.wasm'
      },
      {
        runningMode: 'VIDEO',
        numFaces: 1,
        baseOptions: {
          modelAssetPath: DEFAULT_FACE_LANDMARKER_MODEL_URL
        }
      }
    )
    expect(detectForVideo).toHaveBeenCalledWith(input, 123)
    expect(result).toEqual({
      timestamp: 123,
      landmarks: [{ x: 0.1, y: 0.2, z: -0.3, visibility: 0.9 }]
    })
  })

  it('returns null when MediaPipe detects no face landmarks', async () => {
    createMediaPipeFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({
        faceLandmarks: [],
        faceBlendshapes: [],
        facialTransformationMatrixes: []
      })),
      close: vi.fn()
    } as unknown as Awaited<ReturnType<typeof MediaPipeFaceLandmarker.createFromOptions>>)

    const landmarker = createFaceLandmarker({
      wasmFileset: {
        wasmLoaderPath: '/test/vision.js',
        wasmBinaryPath: '/test/vision.wasm'
      }
    })

    await expect(landmarker.detect({} as ImageData, 456)).resolves.toBeNull()
  })

  it('returns null when MediaPipe frame detection fails', async () => {
    createMediaPipeFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => {
        throw new Error('frame detection failed')
      }),
      close: vi.fn()
    } as unknown as Awaited<ReturnType<typeof MediaPipeFaceLandmarker.createFromOptions>>)

    const landmarker = createFaceLandmarker({
      wasmFileset: {
        wasmLoaderPath: '/test/vision.js',
        wasmBinaryPath: '/test/vision.wasm'
      }
    })

    await expect(landmarker.detect({} as ImageData, 456)).resolves.toBeNull()
  })

  it('closes the initialized MediaPipe detector', async () => {
    const close = vi.fn()
    createMediaPipeFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({
        faceLandmarks: [[{ x: 0, y: 0 }]],
        faceBlendshapes: [],
        facialTransformationMatrixes: []
      })),
      close
    } as unknown as Awaited<ReturnType<typeof MediaPipeFaceLandmarker.createFromOptions>>)

    const landmarker = createFaceLandmarker({
      wasmFileset: {
        wasmLoaderPath: '/test/vision.js',
        wasmBinaryPath: '/test/vision.wasm'
      }
    })

    await landmarker.detect({} as ImageData, 1)
    await landmarker.close?.()

    expect(close).toHaveBeenCalledOnce()
  })
})

function smilingLandmarks(): NormalizedFaceLandmark[] {
  const landmarks = Array.from({ length: 301 }, () => ({ x: 0, y: 0 }))
  landmarks[13] = { x: 0.5, y: 0.48 }
  landmarks[14] = { x: 0.5, y: 0.52 }
  landmarks[33] = { x: 0.3, y: 0.35 }
  landmarks[61] = { x: 0.35, y: 0.5 }
  landmarks[70] = { x: 0.3, y: 0.25 }
  landmarks[263] = { x: 0.7, y: 0.35 }
  landmarks[291] = { x: 0.65, y: 0.5 }
  landmarks[300] = { x: 0.7, y: 0.25 }

  return landmarks
}
