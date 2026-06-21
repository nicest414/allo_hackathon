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
    `transparent 0px,`,
    `transparent ${CLEAR_RADIUS_PX}px,`,
    `rgba(255, 255, 255, 0.22) ${FEATHER_RADIUS_PX}px,`,
    `#fff ${OUTER_RADIUS_PX}px)`
  ].join(' ')

  return {
    maskImage,
    WebkitMaskImage: maskImage
  }
}
