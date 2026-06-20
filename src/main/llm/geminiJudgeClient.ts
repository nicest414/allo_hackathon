import type { LlmJudgeResponseRequest, LlmJudgeResponseResult } from '../../shared/types/ipc'
import { getGeminiApiKey } from '../env'
import { RESPONSE_JUDGMENT_SCHEMA } from './responseSchema'

/**
 * 返答内容判定に使うGemini Flashモデル。
 * SDKは依存バージョンで仕様が変わりやすいため、ここではREST APIを直接叩く。
 */
const GEMINI_FLASH_MODEL = 'gemini-2.0-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
// リアルタイム用途のため、応答が無い場合は打ち切る（IPCの無期限ハング防止）
const REQUEST_TIMEOUT_MS = 10_000

const SYSTEM_PROMPT = [
  'あなたは就活面接の評価者です。',
  '面接官の質問に対する就活生の返答内容を評価し、0〜100の整数スコアと簡潔な理由を返してください。',
  '結論の明確さ・具体性・質問との適合度を重視し、内容が薄い/質問とずれている場合は低くしてください。'
].join('\n')

const STUB_SCORE = 50

/**
 * 就活生の返答内容をGemini Flashで判定する。
 *
 * - `GEMINI_API_KEY` 未設定時は実APIを呼ばず、明示的にスタブ結果を返す。
 * - API呼び出しに失敗した場合はエラーを投げる（呼び出し側＝IPCハンドラで処理する）。
 */
export async function judgeResponse(
  request: LlmJudgeResponseRequest
): Promise<LlmJudgeResponseResult> {
  const apiKey = getGeminiApiKey()

  if (!apiKey) {
    return createStubJudgment('GEMINI_API_KEY が未設定のため、スタブの判定結果を返しました。')
  }

  const rawText = await callGeminiGenerateContent(apiKey, request)
  return parseJudgmentResult(rawText)
}

/**
 * APIキー未設定など、実判定ができない場合の中立的なスタブ結果。
 */
export function createStubJudgment(reason: string): LlmJudgeResponseResult {
  return { score: STUB_SCORE, reason }
}

/**
 * Geminiの構造化出力（JSON文字列）を `LlmJudgeResponseResult` に変換する。
 * scoreは0〜100の整数に丸め、想定外の値はスタブ値にフォールバックする。
 */
export function parseJudgmentResult(rawText: string): LlmJudgeResponseResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error(`Gemini応答をJSONとして解析できませんでした: ${rawText.slice(0, 200)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Gemini応答が想定したオブジェクト形式ではありません。')
  }

  const record = parsed as Record<string, unknown>
  const score = clampScore(record.score)
  const reason = typeof record.reason === 'string' ? record.reason : '理由は返されませんでした。'

  return { score, reason }
}

export function buildJudgePrompt(request: LlmJudgeResponseRequest): string {
  return [
    `# 質問\n${request.question}`,
    `# 就活生の返答\n${request.answer}`,
    '# 指示\n上記の返答を評価し、スコアと理由を出力してください。'
  ].join('\n\n')
}

function clampScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric)) {
    return STUB_SCORE
  }

  return Math.min(100, Math.max(0, Math.round(numeric)))
}

async function callGeminiGenerateContent(
  apiKey: string,
  request: LlmJudgeResponseRequest
): Promise<string> {
  const endpoint = `${GEMINI_API_BASE}/models/${GEMINI_FLASH_MODEL}:generateContent`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildJudgePrompt(request) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_JUDGMENT_SCHEMA,
        temperature: 0.2
      }
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Gemini API呼び出しに失敗しました (HTTP ${response.status}): ${errorBody.slice(0, 200)}`)
  }

  const data = (await response.json()) as GeminiGenerateContentResponse
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) {
    throw new Error('Gemini応答に判定テキストが含まれていません。')
  }

  return text
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}
