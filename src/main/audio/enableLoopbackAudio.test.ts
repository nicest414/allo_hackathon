import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableLoopbackAudio } from './enableLoopbackAudio'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('enableLoopbackAudio', () => {
  afterEach(() => {
    setPlatform(originalPlatform)
    vi.doUnmock('electron-audio-loopback')
  })

  it('returns unsupported-platform on non-macOS platforms', async () => {
    setPlatform('win32')

    const result = await enableLoopbackAudio()

    expect(result.status).toBe('unsupported-platform')
    expect(result.message).toContain('win32')
  })

  it('returns unavailable on macOS when electron-audio-loopback fails to load', async () => {
    vi.doMock('electron-audio-loopback', () => {
      throw new Error('Cannot find module')
    })
    setPlatform('darwin')

    const result = await enableLoopbackAudio()

    expect(result.status).toBe('unavailable')
    expect(result.message).toContain('electron-audio-loopback')
  })

  it('returns enabled on macOS when initMain succeeds', async () => {
    vi.doMock('electron-audio-loopback', () => ({ initMain: vi.fn() }))
    setPlatform('darwin')

    const result = await enableLoopbackAudio()

    expect(result.status).toBe('enabled')
  })

  it('returns error on macOS when initMain throws', async () => {
    vi.doMock('electron-audio-loopback', () => ({
      initMain: () => {
        throw new Error('not ready')
      }
    }))
    setPlatform('darwin')

    const result = await enableLoopbackAudio()

    expect(result.status).toBe('error')
    expect(result.message).toContain('not ready')
  })
})
