import { describe, expect, it, vi } from 'vitest'
import {
  calculateFaceCropBox,
  calculateManualFaceCropBox,
  captureInterviewerPortraitImage,
  capturePortraitFrame,
  squareCropBoxFromCenter
} from './portraitFrame'
import type { NormalizedFaceLandmark } from '../analysis/face/faceLandmarker'

vi.mock('./interviewerScreen', () => ({
  getInterviewerScreenStream: vi.fn()
}))

import { getInterviewerScreenStream } from './interviewerScreen'

const getStream = vi.mocked(getInterviewerScreenStream)

describe('calculateFaceCropBox', () => {
  it('returns a padded square crop around face landmarks', () => {
    const cropBox = calculateFaceCropBox(
      landmarks([
        [0.4, 0.3],
        [0.6, 0.3],
        [0.4, 0.7],
        [0.6, 0.7]
      ]),
      1000,
      500,
      0.25
    )

    expect(cropBox).toEqual({
      x: 350,
      y: 100,
      width: 300,
      height: 300
    })
  })

  it('keeps the padded face crop inside the source frame', () => {
    const cropBox = calculateFaceCropBox(
      landmarks([
        [0.0, 0.0],
        [0.2, 0.0],
        [0.0, 0.2],
        [0.2, 0.2]
      ]),
      400,
      400,
      0.5
    )

    expect(cropBox).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 160
    })
  })

  it('returns null when landmarks are empty', () => {
    expect(calculateFaceCropBox([], 400, 400)).toBeNull()
  })
})

describe('squareCropBoxFromCenter', () => {
  it('returns a square of the given size centered on the point when no padding is requested', () => {
    expect(squareCropBoxFromCenter({ x: 500, y: 250 }, 200, 1000, 500)).toEqual({
      x: 400,
      y: 150,
      width: 200,
      height: 200
    })
  })

  it('applies paddingRatio the same way calculateFaceCropBox does', () => {
    expect(squareCropBoxFromCenter({ x: 500, y: 250 }, 200, 1000, 500, 0.25)).toEqual({
      x: 350,
      y: 100,
      width: 300,
      height: 300
    })
  })

  it('clamps the square so it stays inside the source frame', () => {
    expect(squareCropBoxFromCenter({ x: 40, y: 40 }, 80, 400, 400, 0.5)).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 160
    })
  })
})

describe('calculateManualFaceCropBox', () => {
  it('converts a normalized rect into a square crop box sized by its larger dimension', () => {
    const cropBox = calculateManualFaceCropBox({ x: 0.4, y: 0.3, width: 0.2, height: 0.1 }, 1000, 500)

    expect(cropBox).toEqual({
      x: 400,
      y: 75,
      width: 200,
      height: 200
    })
  })

  it('clamps a rect that extends past the source frame', () => {
    const cropBox = calculateManualFaceCropBox({ x: 0.85, y: 0.85, width: 0.3, height: 0.3 }, 400, 400)

    expect(cropBox).toEqual({
      x: 280,
      y: 280,
      width: 120,
      height: 120
    })
  })

  it('returns null for a degenerate rect or frame', () => {
    expect(calculateManualFaceCropBox({ x: 0, y: 0, width: 0, height: 0.2 }, 400, 400)).toBeNull()
    expect(calculateManualFaceCropBox({ x: 0, y: 0, width: 0.2, height: 0.2 }, 0, 400)).toBeNull()
  })
})

describe('capturePortraitFrame', () => {
  it.each([
    ['width', { width: 0 }],
    ['height', { height: Number.NaN }]
  ])('rejects invalid %s before rendering', async (_name, options) => {
    await expect(
      capturePortraitFrame({} as MediaStream, options)
    ).rejects.toThrow('正の有限値')
  })
})

describe('captureInterviewerPortraitImage', () => {
  it('requests a high-resolution screen stream and passes through acquisition errors', async () => {
    getStream.mockResolvedValue({
      ok: false,
      error: { code: 'permission-denied', message: 'denied' }
    })

    const result = await captureInterviewerPortraitImage({ sourceId: 'screen:1' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'permission-denied', message: 'denied' }
    })
    expect(getStream).toHaveBeenCalledWith({
      sourceId: 'screen:1',
      width: 1280,
      height: 720,
      frameRate: 10
    })
  })
})

function landmarks(points: Array<[x: number, y: number]>): NormalizedFaceLandmark[] {
  return points.map(([x, y]) => ({ x, y }))
}
