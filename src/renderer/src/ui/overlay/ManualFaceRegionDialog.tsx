import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { NormalizedRect } from '../../capture/portraitFrame'
import { computeNormalizedRectFromDrag, isRegionLargeEnough } from './manualFaceRegionMath'
import './ManualFaceRegionDialog.css'

export interface ManualFaceRegionDialogProps {
  rawFrameDataUrl: string
  sourceWidth: number
  sourceHeight: number
  onConfirm: (rect: NormalizedRect) => void
  onCancel: () => void
}

interface DragPoint {
  x: number
  y: number
}

/**
 * 面接官の顔の自動検出に失敗したときに表示する、生フレーム上でドラッグして顔のおおよその
 * 範囲を指定してもらうモーダル。表示サイズ基準で正規化するため、画像の拡大縮小の影響を受けない。
 */
export function ManualFaceRegionDialog({
  rawFrameDataUrl,
  sourceWidth,
  sourceHeight,
  onConfirm,
  onCancel
}: ManualFaceRegionDialogProps): ReactElement {
  const imageRef = useRef<HTMLImageElement>(null)
  const [dragStart, setDragStart] = useState<DragPoint | null>(null)
  const [dragCurrent, setDragCurrent] = useState<DragPoint | null>(null)

  const rect =
    dragStart !== null && dragCurrent !== null && imageRef.current !== null
      ? computeNormalizedRectFromDrag(
          { startX: dragStart.x, startY: dragStart.y, endX: dragCurrent.x, endY: dragCurrent.y },
          { width: imageRef.current.clientWidth, height: imageRef.current.clientHeight }
        )
      : null

  const canConfirm = isRegionLargeEnough(rect)

  const toImagePoint = (event: ReactPointerEvent<HTMLImageElement>): DragPoint | null => {
    if (imageRef.current === null) {
      return null
    }
    const bounds = imageRef.current.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLImageElement>): void => {
    const point = toImagePoint(event)
    if (point === null) {
      return
    }
    // ドラッグ中にカーソルが画像の外に出ても矩形を更新し続けられるようにする。
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(point)
    setDragCurrent(point)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLImageElement>): void => {
    if (dragStart === null) {
      return
    }
    const point = toImagePoint(event)
    if (point !== null) {
      setDragCurrent(point)
    }
  }

  const handleConfirm = (): void => {
    if (rect !== null && canConfirm) {
      onConfirm(rect)
    }
  }

  const selectionStyle =
    dragStart !== null && dragCurrent !== null
      ? {
          left: `${Math.min(dragStart.x, dragCurrent.x)}px`,
          top: `${Math.min(dragStart.y, dragCurrent.y)}px`,
          width: `${Math.abs(dragCurrent.x - dragStart.x)}px`,
          height: `${Math.abs(dragCurrent.y - dragStart.y)}px`
        }
      : null

  return (
    <div className="manual-face-region-dialog" role="dialog" aria-modal="true">
      <div className="manual-face-region-dialog__card">
        <p className="manual-face-region-dialog__instructions">
          面接官の顔が写っている範囲をドラッグで囲んでください。
        </p>
        <div
          className="manual-face-region-dialog__frame"
          style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}
        >
          <img
            ref={imageRef}
            className="manual-face-region-dialog__image"
            src={rawFrameDataUrl}
            alt=""
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
          />
          {selectionStyle ? (
            <div className="manual-face-region-dialog__selection" style={selectionStyle} />
          ) : null}
        </div>
        <div className="manual-face-region-dialog__actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            この範囲で確定
          </button>
        </div>
      </div>
    </div>
  )
}
