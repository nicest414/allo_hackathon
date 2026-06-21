import { describe, expect, it } from 'vitest'
import { computeNormalizedRectFromDrag, isRegionLargeEnough } from './manualFaceRegionMath'

describe('computeNormalizedRectFromDrag', () => {
  it('normalizes a drag from top-left to bottom-right against the display size', () => {
    const rect = computeNormalizedRectFromDrag(
      { startX: 100, startY: 50, endX: 300, endY: 250 },
      { width: 1000, height: 500 }
    )

    expect(rect).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.4 })
  })

  it('normalizes the same way regardless of drag direction', () => {
    const rect = computeNormalizedRectFromDrag(
      { startX: 300, startY: 250, endX: 100, endY: 50 },
      { width: 1000, height: 500 }
    )

    expect(rect).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.4 })
  })

  it('clamps drag points that fall outside the displayed image', () => {
    const rect = computeNormalizedRectFromDrag(
      { startX: -50, startY: -50, endX: 1200, endY: 600 },
      { width: 1000, height: 500 }
    )

    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('returns null when the display size is empty', () => {
    expect(
      computeNormalizedRectFromDrag({ startX: 0, startY: 0, endX: 10, endY: 10 }, { width: 0, height: 0 })
    ).toBeNull()
  })
})

describe('isRegionLargeEnough', () => {
  it('rejects null', () => {
    expect(isRegionLargeEnough(null)).toBe(false)
  })

  it('rejects a region smaller than the minimum ratio', () => {
    expect(isRegionLargeEnough({ x: 0, y: 0, width: 0.01, height: 0.5 })).toBe(false)
  })

  it('accepts a region at or above the minimum ratio', () => {
    expect(isRegionLargeEnough({ x: 0, y: 0, width: 0.1, height: 0.1 })).toBe(true)
  })
})
