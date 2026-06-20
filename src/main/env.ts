import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type SttProviderName = 'deepgram' | 'gemini_live'

export interface MainEnv {
  geminiApiKey?: string
  deepgramApiKey?: string
  sttProvider: SttProviderName
  /** LLM_FAKE 有効時：実APIを呼ばず決定的なモック判定を返す（キー無し/オフライン/CI用） */
  llmFake: boolean
  /** LLM_DEBUG 有効時：Gemini呼び出しの詳細をstderrに出す（キーは出さない） */
  llmDebug: boolean
}

const ENV_FILE_NAME = '.env'
const DEFAULT_STT_PROVIDER: SttProviderName = 'deepgram'
const STT_PROVIDERS = new Set<SttProviderName>(['deepgram', 'gemini_live'])

let cachedEnv: MainEnv | undefined

export function getMainEnv(): MainEnv {
  if (!cachedEnv) {
    loadDotEnv()

    cachedEnv = {
      geminiApiKey: readOptionalEnv('GEMINI_API_KEY'),
      deepgramApiKey: readOptionalEnv('DEEPGRAM_API_KEY'),
      sttProvider: readSttProvider(),
      llmFake: readBooleanEnv('LLM_FAKE'),
      llmDebug: readBooleanEnv('LLM_DEBUG')
    }
  }

  return cachedEnv
}

export function getGeminiApiKey(): string | undefined {
  return getMainEnv().geminiApiKey
}

export function getDeepgramApiKey(): string | undefined {
  return getMainEnv().deepgramApiKey
}

export function getSttProvider(): SttProviderName {
  return getMainEnv().sttProvider
}

export function isLlmFake(): boolean {
  return getMainEnv().llmFake
}

export function isLlmDebug(): boolean {
  return getMainEnv().llmDebug
}

export function resetMainEnvForTest(): void {
  cachedEnv = undefined
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ENV_FILE_NAME)

  if (!existsSync(envPath)) {
    return
  }

  const entries = parseDotEnv(readFileSync(envPath, 'utf8'))

  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function parseDotEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')

    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    result[key] = unquoteDotEnvValue(rawValue)
  }

  return result
}

function unquoteDotEnvValue(value: string): string {
  if (value.length < 2) {
    return value
  }

  const quote = value[0]
  const last = value[value.length - 1]

  if ((quote === '"' || quote === "'") && last === quote) {
    const unquoted = value.slice(1, -1)
    return quote === '"' ? unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : unquoted
  }

  return value
}

function readOptionalEnv(key: 'GEMINI_API_KEY' | 'DEEPGRAM_API_KEY'): string | undefined {
  const value = process.env[key]?.trim()
  return value ? value : undefined
}

/** "1" / "true" / "yes" / "on"（大文字小文字無視）を真とみなす。未設定・空は偽。 */
function readBooleanEnv(key: 'LLM_FAKE' | 'LLM_DEBUG'): boolean {
  const value = process.env[key]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function readSttProvider(): SttProviderName {
  const value = process.env.STT_PROVIDER?.trim()

  if (!value) {
    return DEFAULT_STT_PROVIDER
  }

  if (STT_PROVIDERS.has(value as SttProviderName)) {
    return value as SttProviderName
  }

  throw new Error(
    `Invalid STT_PROVIDER "${value}". Expected one of: ${Array.from(STT_PROVIDERS).join(', ')}.`
  )
}
