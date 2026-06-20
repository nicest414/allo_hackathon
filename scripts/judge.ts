#!/usr/bin/env tsx
/**
 * Gemini 返答判定（judgeResponse）を Electron 無しで直接叩く開発用ハーネス。
 *
 * geminiJudgeClient は Electron 非依存（fetch + node のみ）なので、素の Node(tsx)で実行できる。
 * モードは judgeResponse 内のロジックに従う:
 *   - LLM_FAKE=1     → 実APIを呼ばず決定的なモック判定
 *   - GEMINI_API_KEY → 実 Gemini API 呼び出し
 *   - どちらも無し    → 中立50のスタブ
 *
 * 使い方:
 *   mise run judge -- "質問文" "回答文"
 *   mise run judge -- "質問" "回答" -v          # 送信プロンプト + 生JSON応答も表示
 *   mise run judge -- "質問" "回答" --debug      # LLM_DEBUG を立てて詳細ログ
 *   mise run judge -- --file scripts/fixtures/cases.json   # 複数ケースをバッチ実行
 *
 * 注意: APIキーは一切出力しない。
 */
import { readFileSync } from 'node:fs'
import type { LlmJudgeResponseRequest } from '../src/shared/types/ipc'
import { buildJudgePrompt, judgeResponse } from '../src/main/llm/geminiJudgeClient'
import { getGeminiApiKey, isLlmFake } from '../src/main/env'

interface ParsedArgs {
  question?: string
  answer?: string
  file?: string
  verbose: boolean
  debug: boolean
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { verbose: false, debug: false, help: false }
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '-v':
      case '--verbose':
        parsed.verbose = true
        break
      case '--debug':
        parsed.debug = true
        break
      case '-h':
      case '--help':
        parsed.help = true
        break
      case '--file':
        parsed.file = argv[++i]
        break
      case '--question':
        parsed.question = argv[++i]
        break
      case '--answer':
        parsed.answer = argv[++i]
        break
      default:
        positionals.push(arg)
    }
  }

  if (parsed.question === undefined) parsed.question = positionals[0]
  if (parsed.answer === undefined) parsed.answer = positionals[1]
  return parsed
}

function printHelp(): void {
  console.log(
    [
      'Gemini 返答判定ハーネス',
      '',
      '  mise run judge -- "質問" "回答" [-v] [--debug]',
      '  mise run judge -- --file <cases.json>',
      '',
      'options:',
      '  -v, --verbose   送信プロンプトと生JSON応答も表示',
      '      --debug     LLM_DEBUG を有効化（status/レイテンシ等をstderrに）',
      '      --file F    {question, answer} の配列JSONをバッチ実行',
      '',
      'modes (judgeResponse のロジックに従う):',
      '  LLM_FAKE=1 → モック / GEMINI_API_KEY → 実API / 無し → スタブ'
    ].join('\n')
  )
}

function currentMode(): string {
  if (isLlmFake()) return 'FAKE（モック・実API非呼び出し）'
  if (getGeminiApiKey()) return 'LIVE（実 Gemini API）'
  return 'STUB（キー未設定・中立50）'
}

async function runOne(request: LlmJudgeResponseRequest, verbose: boolean): Promise<void> {
  if (verbose) {
    console.log('--- 送信プロンプト ---')
    console.log(buildJudgePrompt(request))
    console.log('----------------------')
  }

  const result = await judgeResponse(request)

  console.log(`Q: ${request.question}`)
  console.log(`A: ${request.answer}`)
  console.log(`score : ${result.score}`)
  console.log(`reason: ${result.reason}`)
  console.log('')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  // --debug は LLM_DEBUG を立ててから env を初めて読ませる（env.ts はキャッシュするため import 副作用前に設定）
  if (args.debug) {
    process.env.LLM_DEBUG = '1'
  }

  console.error(`[judge] mode: ${currentMode()}`)

  let cases: LlmJudgeResponseRequest[]

  if (args.file) {
    const raw = JSON.parse(readFileSync(args.file, 'utf8')) as unknown
    if (!Array.isArray(raw)) {
      throw new Error(`--file は {question, answer} の配列JSONである必要があります: ${args.file}`)
    }
    cases = raw as LlmJudgeResponseRequest[]
  } else {
    if (!args.question || args.answer === undefined) {
      printHelp()
      throw new Error('質問と回答を指定してください（位置引数 or --question/--answer）。')
    }
    cases = [{ question: args.question, answer: args.answer }]
  }

  for (const c of cases) {
    await runOne(c, args.verbose)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[judge] エラー: ${message}`)
  process.exitCode = 1
})
