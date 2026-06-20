import type { LlmJudgeResponseRequest, LlmJudgeResponseResult } from '../../shared/types/ipc'
import { getGeminiApiKey, isLlmDebug, isLlmFake } from '../env'
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
  // 分岐順: LLM_FAKE（決定的モック）→ キー未設定（中立スタブ）→ 実API
  if (isLlmFake()) {
    return createFakeJudgment(request)
  }

  const apiKey = getGeminiApiKey()

  if (!apiKey) {
    return createStubJudgment('GEMINI_API_KEY が未設定のため、スタブの判定結果を返しました。')
  }

  const rawText = await callGeminiGenerateContent(apiKey, request)
  return parseJudgmentResult(rawText)
}

/**
 * 実APIを呼ばずに、入力から決定的なスコアを算出するモック判定（LLM_FAKE 用）。
 * キー無し/オフライン/CI で、UI・スコア合成パイプラインを入力依存の非定数値で確認するためのもの。
 * ルールは「目安」であり実モデルの評価ではない（reason に [FAKE] を明示）。
 */
export function createFakeJudgment(request: LlmJudgeResponseRequest): LlmJudgeResponseResult {
  const answer = request.answer ?? ''
  const trimmed = answer.trim()

  // 回答の長さをベースに、具体性キーワードで加点・フィラーで減点する決定的ヒューリスティック。
  let raw = STUB_SCORE
  raw += Math.min(30, Math.floor(trimmed.length / 10) * 2) // 長さ（上限+30）
  for (const keyword of ['具体的', '結論', 'なぜなら', '実績', '経験']) {
    if (trimmed.includes(keyword)) raw += 6
  }
  for (const filler of ['えっと', 'あの', 'えー', 'うーん']) {
    if (trimmed.includes(filler)) raw -= 8
  }
  if (trimmed.length === 0) raw = 0

  return {
    score: clampScore(raw),
    reason: `[FAKE] 実APIを呼ばないモック判定（回答長=${trimmed.length}文字の決定的スコア）。`
  }
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
  const startedAt = Date.now()

  debugLog(() => `→ POST ${endpoint}\n  prompt:\n${indent(buildJudgePrompt(request))}`)

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

  debugLog(() => `← HTTP ${response.status} (${Date.now() - startedAt}ms)`)

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Gemini API呼び出しに失敗しました (HTTP ${response.status}): ${errorBody.slice(0, 200)}`)
  }

  const data = (await response.json()) as GeminiGenerateContentResponse
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) {
    throw new Error('Gemini応答に判定テキストが含まれていません。')
  }

  debugLog(() => `  raw response text: ${text}`)

  return text
}

/** LLM_DEBUG 有効時のみ stderr へ出力。APIキー・認証ヘッダは決して渡さないこと。 */
function debugLog(message: () => string): void {
  if (isLlmDebug()) {
    console.error(`[llm:debug] ${message()}`)
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}
