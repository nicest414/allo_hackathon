import type { CaptureResult } from './types'
import { getCandidateCameraStream } from './candidateCamera'

export interface PortraitFrameOptions {
  width?: number
  height?: number
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
  timeoutMs?: number
}

const defaultPortraitFrameOptions = {
  width: 256,
  height: 256,
  mimeType: 'image/png',
  timeoutMs: 3000
} satisfies Required<Pick<PortraitFrameOptions, 'width' | 'height' | 'mimeType' | 'timeoutMs'>>

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

export async function capturePortraitFrame(
  stream: MediaStream,
  options: PortraitFrameOptions = {}
): Promise<string> {
  const width = options.width ?? defaultPortraitFrameOptions.width
  const height = options.height ?? defaultPortraitFrameOptions.height
  const mimeType = options.mimeType ?? defaultPortraitFrameOptions.mimeType
  const timeoutMs = options.timeoutMs ?? defaultPortraitFrameOptions.timeoutMs

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

    drawCoverFrame(context, video, width, height)
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
