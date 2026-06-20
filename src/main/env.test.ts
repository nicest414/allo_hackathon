import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getDeepgramApiKey,
  getGeminiApiKey,
  getSttProvider,
  resetMainEnvForTest
} from './env'

const ENV_KEYS = ['GEMINI_API_KEY', 'DEEPGRAM_API_KEY', 'STT_PROVIDER'] as const

let originalCwd: string
let tempDir: string
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>

describe('main env', () => {
  beforeEach(() => {
    originalCwd = process.cwd()
    originalEnv = {}

    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }

    tempDir = mkdtempSync(join(tmpdir(), 'allo-env-test-'))
    process.chdir(tempDir)
    resetMainEnvForTest()
  })

  afterEach(() => {
    resetMainEnvForTest()
    process.chdir(originalCwd)
    rmSync(tempDir, { force: true, recursive: true })

    for (const key of ENV_KEYS) {
      const value = originalEnv[key]

      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('loads typed values from .env in the main process', () => {
    writeFileSync(
      join(tempDir, '.env'),
      [
        'GEMINI_API_KEY=gemini-secret',
        'DEEPGRAM_API_KEY=deepgram-secret',
        'STT_PROVIDER=gemini_live'
      ].join('\n')
    )

    expect(getGeminiApiKey()).toBe('gemini-secret')
    expect(getDeepgramApiKey()).toBe('deepgram-secret')
    expect(getSttProvider()).toBe('gemini_live')
  })

  it('defaults to deepgram and treats blank API keys as unset', () => {
    writeFileSync(join(tempDir, '.env'), 'GEMINI_API_KEY=   \nDEEPGRAM_API_KEY=\n')

    expect(getGeminiApiKey()).toBeUndefined()
    expect(getDeepgramApiKey()).toBeUndefined()
    expect(getSttProvider()).toBe('deepgram')
  })

  it('does not override environment variables that already exist', () => {
    process.env.GEMINI_API_KEY = 'shell-gemini'
    process.env.STT_PROVIDER = 'deepgram'
    writeFileSync(join(tempDir, '.env'), 'GEMINI_API_KEY=file-gemini\nSTT_PROVIDER=gemini_live\n')

    expect(getGeminiApiKey()).toBe('shell-gemini')
    expect(getSttProvider()).toBe('deepgram')
  })

  it('rejects unsupported STT_PROVIDER values', () => {
    writeFileSync(join(tempDir, '.env'), 'STT_PROVIDER=unknown\n')

    expect(() => getSttProvider()).toThrow('Invalid STT_PROVIDER "unknown"')
  })
})
