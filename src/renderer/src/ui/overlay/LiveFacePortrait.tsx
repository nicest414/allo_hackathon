import { useEffect, useRef, type ReactElement } from 'react'
import type { NormalizedFaceBox } from '../../../../shared/types/analysis'

export interface LiveFacePortraitProps {
  /** 解析（カメラ/画面）が動いているか。falseなら静止画フォールバック。 */
  active: boolean
  /** 表示元のライブMediaStream（faceAnalysisLoopから共有）。 */
  stream?: MediaStream
  /** 最新の顔の正規化枠（0-1）。未取得時は中央正方形でカバー。 */
  faceBox?: NormalizedFaceBox
  /** 描画ループが毎フレーム最新の顔枠を取得するためのgetter（再レンダー不要・推奨）。 */
  getFaceBox?: () => NormalizedFaceBox | undefined
  /** active/streamが無いときに表示する静止画（撮影済み or デフォルト立ち絵）。 */
  fallbackSrc: string
  /** 左右反転（就活生のカメラは鏡像が自然）。 */
  mirrored?: boolean
  className?: string
  alt?: string
  /** 出力canvasの一辺(px)。 */
  size?: number
}

const DEFAULT_SIZE = 256
// 描画は最大~30fpsにキャップしてCPUを抑える（顔枠更新は解析fps程度なので十分）。
const DRAW_INTERVAL_MS = 1000 / 30

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * 解析中はライブ映像を顔追従でクロップしてcanvasに描画し、停止中は静止画にフォールバックする立ち絵。
 * ストリームは faceAnalysisLoop から共有されたものを使い、二重キャプチャしない。
 */
export function LiveFacePortrait({
  active,
  stream,
  faceBox,
  getFaceBox,
  fallbackSrc,
  mirrored = false,
  className,
  alt = '',
  size = DEFAULT_SIZE
}: LiveFacePortraitProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 最新の顔枠はrefで参照し、枠更新ごとに描画ループを作り直さない。
  const faceBoxRef = useRef<NormalizedFaceBox | undefined>(faceBox)
  faceBoxRef.current = faceBox
  const getFaceBoxRef = useRef(getFaceBox)
  getFaceBoxRef.current = getFaceBox

  const live = active && stream !== undefined

  useEffect(() => {
    if (!live || !stream) {
      return
    }

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    void video.play().catch(() => undefined)

    let rafHandle = 0
    let lastDrawAt = 0

    const draw = (now: number): void => {
      rafHandle = requestAnimationFrame(draw)
      if (now - lastDrawAt < DRAW_INTERVAL_MS) {
        return
      }
      lastDrawAt = now

      const canvas = canvasRef.current
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!canvas || vw === 0 || vh === 0) {
        return
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }

      // クロップ元の正方形領域(px)を決める。顔枠があれば顔追従、無ければ中央カバー。
      const box = getFaceBoxRef.current?.() ?? faceBoxRef.current
      let side: number
      let sx: number
      let sy: number
      if (box) {
        const centerX = (box.x + box.width / 2) * vw
        const centerY = (box.y + box.height / 2) * vh
        side = Math.min(box.width * vw, vw, vh)
        sx = clamp(centerX - side / 2, 0, vw - side)
        sy = clamp(centerY - side / 2, 0, vh - side)
      } else {
        side = Math.min(vw, vh)
        sx = (vw - side) / 2
        sy = (vh - side) / 2
      }

      ctx.save()
      ctx.clearRect(0, 0, size, size)
      if (mirrored) {
        ctx.translate(size, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size)
      ctx.restore()
    }

    rafHandle = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafHandle)
      video.pause()
      video.srcObject = null
    }
  }, [live, stream, mirrored, size])

  if (!live) {
    return <img className={className} src={fallbackSrc} alt={alt} draggable={false} />
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      role="img"
      aria-label={alt}
    />
  )
}
