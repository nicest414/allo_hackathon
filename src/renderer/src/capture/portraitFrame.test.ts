import { describe, expect, it, vi } from 'vitest'
import {
  calculateFaceCropBox,
  captureInterviewerPortraitImage,
  capturePortraitFrame
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
