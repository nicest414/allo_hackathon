import { describe, expect, it } from 'vitest'
import type { NormalizedFaceLandmark } from './faceLandmarker'
import { calculateNormalizedFaceBox } from './candidateFaceAnalyzer'

function lm(x: number, y: number): NormalizedFaceLandmark {
  return { x, y } as NormalizedFaceLandmark
}

describe('calculateNormalizedFaceBox', () => {
  it('ランドマーク無しは undefined', () => {
    expect(calculateNormalizedFaceBox([])).toBeUndefined()
  })

  it('外接矩形を中心に正方形＋パディングの枠を返す（0-1にクランプ）', () => {
    // 中央付近の小さな顔。padding 0 で検証しやすくする。
    const box = calculateNormalizedFaceBox([lm(0.4, 0.4), lm(0.6, 0.6)], 0)
    expect(box).toBeDefined()
    if (!box) return
    // 0.4-0.6 の正方形（一辺0.2）が中心(0.5,0.5)に置かれる
    expect(box.width).toBeCloseTo(0.2, 5)
    expect(box.height).toBeCloseTo(0.2, 5)
    expect(box.x).toBeCloseTo(0.4, 5)
    expect(box.y).toBeCloseTo(0.4, 5)
  })

  it('パディングを付けても 0-1 をはみ出さない', () => {
    const box = calculateNormalizedFaceBox([lm(0.1, 0.1), lm(0.9, 0.9)], 0.5)
    expect(box).toBeDefined()
    if (!box) return
    expect(box.width).toBeLessThanOrEqual(1)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(1.0000001)
    expect(box.y + box.height).toBeLessThanOrEqual(1.0000001)
  })

  it('長辺基準で正方形になる（縦長の顔でも width==height）', () => {
    const box = calculateNormalizedFaceBox([lm(0.45, 0.2), lm(0.55, 0.8)], 0)
    expect(box).toBeDefined()
    if (!box) return
    expect(box.width).toBeCloseTo(box.height, 5)
  })
})
