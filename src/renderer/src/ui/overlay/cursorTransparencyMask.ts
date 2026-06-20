import type { CSSProperties } from 'react'

export interface CursorPosition {
  x: number
  y: number
}

const CLEAR_RADIUS_PX = 56
const FEATHER_RADIUS_PX = 92
const OUTER_RADIUS_PX = 136

export function buildCursorTransparencyMaskStyle(
  cursorPosition: CursorPosition | null
): CSSProperties {
  if (cursorPosition === null) {
    return {}
  }

  const maskImage = [
    `radial-gradient(circle at ${cursorPosition.x}px ${cursorPosition.y}px,`,
    `transparent 0 ${CLEAR_RADIUS_PX}px,`,
    `rgba(0, 0, 0, 0.22) ${FEATHER_RADIUS_PX}px,`,
    `#000 ${OUTER_RADIUS_PX}px)`
  ].join(' ')

  return {
    maskImage,
    WebkitMaskImage: maskImage
  }
}
