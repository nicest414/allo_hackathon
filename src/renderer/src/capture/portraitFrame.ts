import type { CaptureResult } from './types'
import { getCandidateCameraStream } from './candidateCamera'
import { getInterviewerScreenStream } from './interviewerScreen'
import type { FaceLandmarker, NormalizedFaceLandmark } from '../analysis/face/faceLandmarker'

export interface PortraitFrameOptions {
  width?: number
  height?: number
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
  timeoutMs?: number
  landmarker?: FaceLandmarker
  faceCropPaddingRatio?: number
  faceDetectionTimeoutMs?: number
}

const defaultPortraitFrameOptions = {
  width: 256,
  height: 256,
  mimeType: 'image/png',
  timeoutMs: 3000,
  faceDetectionTimeoutMs: 1500
} satisfies Required<
  Pick<PortraitFrameOptions, 'width' | 'height' | 'mimeType' | 'timeoutMs' | 'faceDetectionTimeoutMs'>
>

export async function captureCandidatePortraitImage(
  options: PortraitFrameOptions = {}
): Promise<CaptureResult<string>> {
  const streamResult = await getCandidateCameraStream({
    width: options.width ?? defaultPortraitFrameOptions.width,
    height: options.height ?? defaultPortraitFrameOptions.height,
    frameRate: 10
  })

  if (!streamResult.ok) {
    return streamResult
  }

  try {
    const imageUrl = await capturePortraitFrame(streamResult.stream, options)
    return { ok: true, stream: imageUrl }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'unknown',
        message: error instanceof Error ? error.message : '顔画像の取得に失敗しました',
        name: error instanceof Error ? error.name : undefined
      }
    }
  } finally {
    stopMediaStream(streamResult.stream)
  }
}

export interface InterviewerPortraitFrameOptions extends PortraitFrameOptions {
  sourceId: string
}

const interviewerScreenCaptureResolution = { width: 1280, height: 720 }

export async function captureInterviewerPortraitImage(
  options: InterviewerPortraitFrameOptions
): Promise<CaptureResult<string>> {
  const streamResult = await getInterviewerScreenStream({
    sourceId: options.sourceId,
    width: interviewerScreenCaptureResolution.width,
    height: interviewerScreenCaptureResolution.height,
    frameRate: 10
  })

  if (!streamResult.ok) {
    return streamResult
  }

  try {
    const imageUrl = await capturePortraitFrame(streamResult.stream, options)
    return { ok: true, stream: imageUrl }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'unknown',
        message: error instanceof Error ? error.message : '顔画像の取得に失敗しました',
        name: error instanceof Error ? error.name : undefined
      }
    }
  } finally {
    stopMediaStream(streamResult.stream)
  }
}

export async function capturePortraitFrame(
  stream: MediaStream,
  options: PortraitFrameOptions = {}
): Promise<string> {
  const width = options.width ?? defaultPortraitFrameOptions.width
  const height = options.height ?? defaultPortraitFrameOptions.height
  const mimeType = options.mimeType ?? defaultPortraitFrameOptions.mimeType
  const timeoutMs = options.timeoutMs ?? defaultPortraitFrameOptions.timeoutMs

  assertPositiveFiniteDimension(width, 'width')
  assertPositiveFiniteDimension(height, 'height')

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream

  try {
    await waitForVideoFrame(video, timeoutMs)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('顔画像の描画コンテキストを作成できませんでした')
    }

    await drawPortraitFrame(context, video, width, height, options)
    return canvas.toDataURL(mimeType, options.quality)
  } finally {
    video.pause()
    video.srcObject = null
  }
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('顔画像の取得がタイムアウトしました'))
    }, timeoutMs)

    const onReady = (): void => {
      cleanup()
      resolve()
    }

    const onError = (): void => {
      cleanup()
      reject(new Error('カメラ映像を読み込めませんでした'))
    }

    const cleanup = (): void => {
      window.clearTimeout(timeoutId)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('canplay', onReady)
      video.removeEventListener('error', onError)
    }

    video.addEventListener('loadeddata', onReady, { once: true })
    video.addEventListener('canplay', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })

    void video.play().catch(onError)
  })
}

async function drawPortraitFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  options: PortraitFrameOptions
): Promise<void> {
  if (options.landmarker !== undefined) {
    const cropBox = await waitForFaceCropBox(video, options).catch((error: unknown) => {
      console.warn('Failed to detect face crop box', error)
      return null
    })

    if (cropBox !== null) {
      context.drawImage(
        video,
        cropBox.x,
        cropBox.y,
        cropBox.width,
        cropBox.height,
        0,
        0,
        width,
        height
      )
      return
    }
  }

  drawCoverFrame(context, video, width, height)
}

async function waitForFaceCropBox(
  video: HTMLVideoElement,
  options: PortraitFrameOptions
): Promise<FaceCropBox | null> {
  const landmarker = options.landmarker

  if (landmarker === undefined) {
    return null
  }

  const startedAt = Date.now()
  const timeoutMs =
    options.faceDetectionTimeoutMs ?? defaultPortraitFrameOptions.faceDetectionTimeoutMs

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await landmarker.detect(video)
    const cropBox = calculateFaceCropBox(
      result?.landmarks ?? [],
      video.videoWidth,
      video.videoHeight,
      options.faceCropPaddingRatio
    )

    if (cropBox !== null) {
      return cropBox
    }

    await waitForNextFrame()
  }

  return null
}

export interface FaceCropBox {
  x: number
  y: number
  width: number
  height: number
}

export function calculateFaceCropBox(
  landmarks: NormalizedFaceLandmark[],
  sourceWidth: number,
  sourceHeight: number,
  paddingRatio = 0.35
): FaceCropBox | null {
  if (landmarks.length === 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return null
  }

  const bounds = landmarks.reduce(
    (acc, landmark) => ({
      minX: Math.min(acc.minX, landmark.x),
      minY: Math.min(acc.minY, landmark.y),
      maxX: Math.max(acc.maxX, landmark.x),
      maxY: Math.max(acc.maxY, landmark.y)
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    }
  )

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    return null
  }

  const minX = clamp01(bounds.minX)
  const minY = clamp01(bounds.minY)
  const maxX = clamp01(bounds.maxX)
  const maxY = clamp01(bounds.maxY)
  const faceWidth = (maxX - minX) * sourceWidth
  const faceHeight = (maxY - minY) * sourceHeight

  if (faceWidth <= 0 || faceHeight <= 0) {
    return null
  }

  const centerX = ((minX + maxX) / 2) * sourceWidth
  const centerY = ((minY + maxY) / 2) * sourceHeight
  const paddedSize = Math.max(faceWidth, faceHeight) * (1 + Math.max(0, paddingRatio) * 2)
  const size = Math.min(paddedSize, sourceWidth, sourceHeight)
  const x = clamp(centerX - size / 2, 0, sourceWidth - size)
  const y = clamp(centerY - size / 2, 0, sourceHeight - size)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(size),
    height: Math.round(size)
  }
}

function drawCoverFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number
): void {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('カメラ映像のサイズを取得できませんでした')
  }

  const targetAspect = width / height
  const sourceAspect = sourceWidth / sourceHeight

  const cropWidth = sourceAspect > targetAspect ? sourceHeight * targetAspect : sourceWidth
  const cropHeight = sourceAspect > targetAspect ? sourceHeight : sourceWidth / targetAspect
  const cropX = (sourceWidth - cropWidth) / 2
  const cropY = (sourceHeight - cropHeight) / 2

  context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height)
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

function assertPositiveFiniteDimension(value: number, name: 'width' | 'height'): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`顔画像の${name}には正の有限値を指定してください`)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}
