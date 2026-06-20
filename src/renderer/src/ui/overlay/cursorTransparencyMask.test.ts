import { describe, expect, it } from 'vitest'
import { buildCursorTransparencyMaskStyle } from './cursorTransparencyMask'

describe('buildCursorTransparencyMaskStyle', () => {
  it('カーソル位置がない場合はマスクをかけない', () => {
    expect(buildCursorTransparencyMaskStyle(null)).toEqual({})
  })

  it('カーソル位置を中心に透明な穴とフェザーを作る', () => {
    const style = buildCursorTransparencyMaskStyle({ x: 120, y: 34 })

    expect(style.maskImage).toContain('circle at 120px 34px')
    expect(style.maskImage).toContain('transparent 0 56px')
    expect(style.maskImage).toContain('rgba(0, 0, 0, 0.22) 92px')
    expect(style.WebkitMaskImage).toBe(style.maskImage)
  })
})
