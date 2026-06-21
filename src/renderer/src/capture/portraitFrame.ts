import type { CaptureResult } from './types'
import { getCandidateCameraStream } from './candidateCamera'
import { getInterviewerScreenStream } from './interviewerScreen'
import type { FaceLandmarker, NormalizedFaceLandmark } from '../analysis/face/faceLandmarker'

export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PortraitManualCropRequired {
  kind: 'manual-required'
  rawFrameDataUrl: string
  sourceWidth: number
  sourceHeight: number
}

export interface PortraitFrameOptions {
  width?: number
  height?: number
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
  timeoutMs?: number
  landmarker?: FaceLandmarker
  faceCropPaddingRatio?: number
  faceDetectionTimeoutMs?: number
  /** 撮影前にカメラの自動露出(AE)が収束するのを待つ時間(ms)。デフォルトは待たない(0)。 */
  warmupMs?: number
  /** 自動検出が失敗したときに優先的に使う、ユーザーが過去に手動指定した顔の範囲。 */
  manualRect?: NormalizedRect
  /**
   * 自動検出・manualRectのいずれも使えないとき、顔を無視した中央クロップに黙ってフォールバックする
   * 代わりに生フレームを返して呼び出し元に手動指定を促すかどうか。デフォルトはfalse(従来通りのフォールバック)。
   */
  allowManualFallback?: boolean
}

const defaultPortraitFrameOptions = {
  width: 256,
  height: 256,
  mimeType: 'image/png',
  timeoutMs: 3000,
  faceDetectionTimeoutMs: 1500,
  warmupMs: 0
} satisfies Required<
  Pick<
    PortraitFrameOptions,
    'width' | 'height' | 'mimeType' | 'timeoutMs' | 'faceDetectionTimeoutMs' | 'warmupMs'
  >
>

/**
 * カメラ起動直後は自動露出(AE)が収束していないため、画角に天井照明等の強い光源が
 * 入っていると顔側が暗く落ちる(逆光)。就活生カメラはこの撮影のためだけに新規で
 * getUserMedia するので、AEが安定するまで少し待ってから1枚を撮る。
 * 画面共有(面接官側)には露出という概念が無いため適用しない。
 */
const candidateCameraWarmupMs = 800

/**
 * カメラ取得解像度。最終的な顔写真サイズ(デフォルト256x256)とは独立させる。
 * ここをoptions.width/heightと同じ256x256にすると、MediaPipeが256x256の粗い映像から
 * 顔ランドマークを検出することになり、面接官側(1280x720の画面共有)と比べて検出精度が落ちる。
 */
const candidateCameraCaptureResolution = { width: 1280, height: 720 }

export async function captureCandidatePortraitImage(
  options: PortraitFrameOptions = {}
): Promise<CaptureResult<string>> {
  const streamResult = await getCandidateCameraStream({
    width: candidateCameraCaptureResolution.width,
    height: candidateCameraCaptureResolution.height,
    frameRate: 10
  })

  if (!streamResult.ok) {
    return streamResult
  }

  try {
    const result = await capturePortraitFrame(streamResult.stream, {
      ...options,
      warmupMs: options.warmupMs ?? candidateCameraWarmupMs
    })

    // candidate側はmanualRect/allowManualFallbackを渡さないため、ここに到達するのは常にstring。
    if (typeof result !== 'string') {
      throw new Error('候補者の顔画像取得で予期しない状態になりました')
    }

    return { ok: true, stream: result }
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
): Promise<CaptureResult<string | PortraitManualCropRequired>> {
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
    const result = await capturePortraitFrame(streamResult.stream, options)
    return { ok: true, stream: result }
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
): Promise<string | PortraitManualCropRequired> {
  const width = options.width ?? defaultPortraitFrameOptions.width
  const height = options.height ?? defaultPortraitFrameOptions.height
  const mimeType = options.mimeType ?? defaultPortraitFrameOptions.mimeType
  const timeoutMs = options.timeoutMs ?? defaultPortraitFrameOptions.timeoutMs
  const warmupMs = options.warmupMs ?? defaultPortraitFrameOptions.warmupMs

  assertPositiveFiniteDimension(width, 'width')
  assertPositiveFiniteDimension(height, 'height')

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream

  try {
    await waitForVideoFrame(video, timeoutMs)

    if (warmupMs > 0) {
      await delay(warmupMs)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('顔画像の描画コンテキストを作成できませんでした')
    }

    const drawResult = await drawPortraitFrame(context, video, width, height, options)
    if (drawResult.kind === 'manual-required') {
      return drawResult
    }
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
): Promise<{ kind: 'auto' } | PortraitManualCropRequired> {
  if (options.landmarker !== undefined) {
    // 1. 自動検出を最優先する。レイアウトが多少動いても自動検出が効けばそちらが正確なため、
    //    記憶済みのmanualRectより常に優先する。
    const cropBox = await waitForFaceCropBox(video, options).catch((error: unknown) => {
      console.warn('Failed to detect face crop box', error)
      return null
    })

    if (cropBox !== null) {
      drawCropBox(context, video, cropBox, width, height)
      return { kind: 'auto' }
    }

    // 2. 自動検出が失敗した場合、記憶済みのmanualRectがあればダイアログを出さずそれを適用する。
    if (options.manualRect !== undefined) {
      const manualCropBox = calculateManualFaceCropBox(
        options.manualRect,
        video.videoWidth,
        video.videoHeight
      )

      if (manualCropBox !== null) {
        drawCropBox(context, video, manualCropBox, width, height)
        return { kind: 'auto' }
      }
    }

    // 3. 自動検出もmanualRectも使えない場合のみ、手動指定を呼び出し元に促す。
    if (options.allowManualFallback === true) {
      return {
        kind: 'manual-required',
        rawFrameDataUrl: captureRawVideoFrameDataUrl(video),
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight
      }
    }
  }

  drawCoverFrame(context, video, width, height)
  return { kind: 'auto' }
}

function drawCropBox(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  cropBox: FaceCropBox,
  width: number,
  height: number
): void {
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
  // 逆転裁判風の煽り立ち絵として使うため、証明写真程度の余白(0.35)ではインパクトが弱い。
  // 顔の輪郭ぎりぎりまで詰める強めのズームをデフォルトにする。
  paddingRatio = 0.08
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

  const centerX = (minX + maxX) / 2 * sourceWidth
  const centerY = (minY + maxY) / 2 * sourceHeight

  return squareCropBoxFromCenter(
    { x: centerX, y: centerY },
    Math.max(faceWidth, faceHeight),
    sourceWidth,
    sourceHeight,
    paddingRatio
  )
}

/**
 * 中心+サイズを、ソースフレーム内に収まる正方形のクロップ範囲に変換する。
 * landmarkベースの自動検出・ユーザー手動指定の矩形の両方から共通で使う。
 */
export function squareCropBoxFromCenter(
  center: { x: number; y: number },
  size: number,
  sourceWidth: number,
  sourceHeight: number,
  paddingRatio = 0
): FaceCropBox {
  const paddedSize = size * (1 + Math.max(0, paddingRatio) * 2)
  const clampedSize = Math.min(paddedSize, sourceWidth, sourceHeight)
  const x = clamp(center.x - clampedSize / 2, 0, sourceWidth - clampedSize)
  const y = clamp(center.y - clampedSize / 2, 0, sourceHeight - clampedSize)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(clampedSize),
    height: Math.round(clampedSize)
  }
}

/**
 * ユーザーがドラッグで指定した正規化矩形(0〜1、左上原点)から、ソースフレーム内のクロップ範囲を計算する。
 * 自動検出に失敗したときのフォールバックとして使う。
 */
export function calculateManualFaceCropBox(
  rect: NormalizedRect,
  sourceWidth: number,
  sourceHeight: number,
  paddingRatio = 0
): FaceCropBox | null {
  if (rect.width <= 0 || rect.height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return null
  }

  const centerX = (clamp01(rect.x) + clamp01(rect.x + rect.width)) / 2 * sourceWidth
  const centerY = (clamp01(rect.y) + clamp01(rect.y + rect.height)) / 2 * sourceHeight
  const size = Math.max(rect.width * sourceWidth, rect.height * sourceHeight)

  return squareCropBoxFromCenter({ x: centerX, y: centerY }, size, sourceWidth, sourceHeight, paddingRatio)
}

/** リサイズせず、video要素の現在のフレームをソース解像度のままdataURL化する。手動範囲指定UIへの表示用。 */
export function captureRawVideoFrameDataUrl(
  video: HTMLVideoElement,
  mimeType: 'image/png' | 'image/jpeg' = 'image/png'
): string {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('顔画像の描画コンテキストを作成できませんでした')
  }

  context.drawImage(video, 0, 0)
  return canvas.toDataURL(mimeType)
}

export interface ManualPortraitCropOptions {
  width?: number
  height?: number
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
}

/**
 * 手動指定した範囲(rect)を、生フレームのdataURLから最終的な顔写真(デフォルト256x256)に焼き直す。
 * ユーザーが今ドラッグ確定した直後・記憶済みのrectを新しい生フレームに再適用する場合の両方で使う。
 */
export async function captureManualPortraitImage(
  rawFrameDataUrl: string,
  rect: NormalizedRect,
  options: ManualPortraitCropOptions = {}
): Promise<string> {
  const width = options.width ?? defaultPortraitFrameOptions.width
  const height = options.height ?? defaultPortraitFrameOptions.height
  const mimeType = options.mimeType ?? defaultPortraitFrameOptions.mimeType

  const image = await loadImage(rawFrameDataUrl)
  const cropBox = calculateManualFaceCropBox(rect, image.naturalWidth, image.naturalHeight)

  if (cropBox === null) {
    throw new Error('指定された範囲から顔画像を切り出せませんでした')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('顔画像の描画コンテキストを作成できませんでした')
  }

  context.drawImage(image, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, width, height)
  return canvas.toDataURL(mimeType, options.quality)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    image.src = dataUrl
  })
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
