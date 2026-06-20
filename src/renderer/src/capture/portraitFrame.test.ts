import { describe, expect, it } from 'vitest'
import { calculateFaceCropBox, capturePortraitFrame } from './portraitFrame'
import type { NormalizedFaceLandmark } from '../analysis/face/faceLandmarker'

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

function landmarks(points: Array<[x: number, y: number]>): NormalizedFaceLandmark[] {
  return points.map(([x, y]) => ({ x, y }))
}
