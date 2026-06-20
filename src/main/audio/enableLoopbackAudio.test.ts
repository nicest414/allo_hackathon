import { afterEach, describe, expect, it } from 'vitest'
import { enableLoopbackAudio } from './enableLoopbackAudio'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('enableLoopbackAudio', () => {
  afterEach(() => {
    setPlatform(originalPlatform)
  })

  it('returns unsupported-platform on non-macOS platforms', async () => {
    setPlatform('win32')

    const result = await enableLoopbackAudio()

    expect(result.status).toBe('unsupported-platform')
    expect(result.message).toContain('win32')
  })

  it('returns unavailable on macOS when electron-audio-loopback is not installed', async () => {
    setPlatform('darwin')

    const result = await enableLoopbackAudio()

    expect(result.status).toBe('unavailable')
    expect(result.message).toContain('electron-audio-loopback')
  })
})
