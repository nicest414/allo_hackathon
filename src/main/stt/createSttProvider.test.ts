import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMainEnvForTest } from '../env'
import { createSttProvider } from './createSttProvider'
import { DeepgramSttProvider } from './DeepgramSttProvider'
import { DummySttProvider } from './DummySttProvider'
import { GeminiLiveSttProvider } from './GeminiLiveSttProvider'

describe('createSttProvider', () => {
  const original = {
    provider: process.env.STT_PROVIDER,
    key: process.env.DEEPGRAM_API_KEY,
    fake: process.env.STT_FAKE
  }

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    process.env.STT_PROVIDER = ''
    process.env.DEEPGRAM_API_KEY = ''
    process.env.STT_FAKE = ''
    resetMainEnvForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restore('STT_PROVIDER', original.provider)
    restore('DEEPGRAM_API_KEY', original.key)
    restore('STT_FAKE', original.fake)
    resetMainEnvForTest()
  })

  it('DEEPGRAM_API_KEY 未設定なら Dummy にフォールバックする', () => {
    process.env.STT_PROVIDER = 'deepgram'
    resetMainEnvForTest()
    expect(createSttProvider()).toBeInstanceOf(DummySttProvider)
  })

  it('STT_FAKE=1 ならキーがあっても Dummy を返す', () => {
    process.env.STT_PROVIDER = 'deepgram'
    process.env.DEEPGRAM_API_KEY = 'real-key'
    process.env.STT_FAKE = '1'
    resetMainEnvForTest()
    expect(createSttProvider()).toBeInstanceOf(DummySttProvider)
  })

  it('キーがあれば DeepgramSttProvider を返す', () => {
    process.env.STT_PROVIDER = 'deepgram'
    process.env.DEEPGRAM_API_KEY = 'real-key'
    resetMainEnvForTest()
    expect(createSttProvider()).toBeInstanceOf(DeepgramSttProvider)
  })

  it('STT_PROVIDER=gemini_live は GeminiLiveSttProvider を返す', () => {
    process.env.STT_PROVIDER = 'gemini_live'
    resetMainEnvForTest()
    expect(createSttProvider()).toBeInstanceOf(GeminiLiveSttProvider)
  })
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
