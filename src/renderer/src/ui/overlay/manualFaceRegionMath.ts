import type { NormalizedRect } from '../../capture/portraitFrame'

export interface DragPoints {
  startX: number
  startY: number
  endX: number
  endY: number
}

export interface DisplaySize {
  width: number
  height: number
}

const MIN_REGION_RATIO = 0.02

/**
 * ドラッグ中に観測した画面表示上のCSS px座標(start/end、どちらの方向にドラッグしても良い)を、
 * 表示中img要素のサイズで正規化した0〜1のNormalizedRectに変換する。
 * 解像度(sourceWidth/sourceHeight)ではなく表示サイズを基準にするため、img要素の拡大縮小の影響を受けない。
 */
export function computeNormalizedRectFromDrag(
  drag: DragPoints,
  displaySize: DisplaySize
): NormalizedRect | null {
  if (displaySize.width <= 0 || displaySize.height <= 0) {
    return null
  }

  // pxの範囲をクランプしてから比率に変換する(比率に変換してから引くと浮動小数誤差が出るため)。
  const left = clamp(Math.min(drag.startX, drag.endX), 0, displaySize.width)
  const top = clamp(Math.min(drag.startY, drag.endY), 0, displaySize.height)
  const right = clamp(Math.max(drag.startX, drag.endX), 0, displaySize.width)
  const bottom = clamp(Math.max(drag.startY, drag.endY), 0, displaySize.height)

  return {
    x: left / displaySize.width,
    y: top / displaySize.height,
    width: (right - left) / displaySize.width,
    height: (bottom - top) / displaySize.height
  }
}

/** ドラッグ確定ボタンを有効化してよいか(指定範囲が小さすぎないか)を判定する。 */
export function isRegionLargeEnough(rect: NormalizedRect | null): boolean {
  return rect !== null && rect.width >= MIN_REGION_RATIO && rect.height >= MIN_REGION_RATIO
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
