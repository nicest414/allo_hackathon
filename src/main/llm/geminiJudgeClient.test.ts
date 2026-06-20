import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMainEnvForTest } from '../env'
import { createFakeJudgment, judgeResponse, parseJudgmentResult } from './geminiJudgeClient'

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'))
}

/** fetch のモックレスポンスを組み立てる（必要な部分だけ実装）。 */
function mockResponse(options: {
  ok: boolean
  status: number
  json?: unknown
  text?: string
}): Response {
  return {
    ok: options.ok,
    status: options.status,
    json: async () => options.json,
    text: async () => options.text ?? ''
  } as unknown as Response
}

describe('parseJudgmentResult', () => {
  it('有効なJSONをscore/reasonに変換する', () => {
    const result = parseJudgmentResult('{"score": 73, "reason": "具体的で良い"}')
    expect(result).toEqual({ score: 73, reason: '具体的で良い' })
  })

  it('範囲外・小数のscoreを0〜100の整数に丸める', () => {
    expect(parseJudgmentResult('{"score": 140, "reason": "x"}').score).toBe(100)
    expect(parseJudgmentResult('{"score": -5, "reason": "x"}').score).toBe(0)
    expect(parseJudgmentResult('{"score": 61.7, "reason": "x"}').score).toBe(62)
  })

  it('JSONとして不正な応答はエラーにする', () => {
    expect(() => parseJudgmentResult('not json')).toThrow()
  })
})

describe('createFakeJudgment（決定的モック）', () => {
  it('同じ入力には常に同じスコアを返す（決定的）', () => {
    const req = { question: 'q', answer: '具体的な実績があります' }
    expect(createFakeJudgment(req)).toEqual(createFakeJudgment(req))
  })

  it('具体性キーワードで加点、フィラーで減点される', () => {
    const concrete = createFakeJudgment({ question: 'q', answer: '結論として具体的な実績があります' })
    const filler = createFakeJudgment({ question: 'q', answer: 'えっと、あの、うーん' })
    expect(concrete.score).toBeGreaterThan(filler.score)
    expect(concrete.reason).toContain('[FAKE]')
  })

  it('空の回答は0点', () => {
    expect(createFakeJudgment({ question: 'q', answer: '' }).score).toBe(0)
  })
})

describe('judgeResponse', () => {
  const originalKey = process.env.GEMINI_API_KEY
  let originalCwd: string
  let tempDir: string

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.LLM_FAKE
    delete process.env.LLM_DEBUG

    // getMainEnv() はprocess.cwd()/.envを再読み込みするため、開発者のリポジトリに実キーが
    // 書かれた.envがあっても拾わないよう、.envの無い一時ディレクトリへ退避してテストする。
    originalCwd = process.cwd()
    tempDir = mkdtempSync(join(tmpdir(), 'allo-gemini-judge-test-'))
    process.chdir(tempDir)
    resetMainEnvForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY
    } else {
      process.env.GEMINI_API_KEY = originalKey
    }
    delete process.env.LLM_FAKE
    delete process.env.LLM_DEBUG
    process.chdir(originalCwd)
    rmSync(tempDir, { force: true, recursive: true })
    resetMainEnvForTest()
  })

  it('APIキー未設定時はスタブ結果を返す（実APIを呼ばない）', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await judgeResponse({ question: 'q', answer: 'a' })

    expect(result.score).toBe(50)
    expect(result.reason).toContain('GEMINI_API_KEY')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('LLM_FAKE=1 のときは fetch を呼ばず決定的なモック判定を返す', async () => {
    process.env.LLM_FAKE = '1'
    process.env.GEMINI_API_KEY = 'should-not-be-used'
    resetMainEnvForTest()

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await judgeResponse({ question: 'q', answer: '結論として具体的です' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.reason).toContain('[FAKE]')
    expect(result.score).toBeGreaterThan(50)
  })

  describe('実API経路（fetch をモック）', () => {
    beforeEach(() => {
      process.env.GEMINI_API_KEY = 'test-key'
      resetMainEnvForTest()
    })

    it('成功レスポンス（fixture）をscore/reasonに解析する', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => mockResponse({ ok: true, status: 200, json: loadFixture('gemini-response.sample.json') }))
      )

      const result = await judgeResponse({ question: '志望動機は？', answer: '御社の理念に共感し…' })

      expect(result.score).toBe(78)
      expect(result.reason).toContain('結論')
    })

    it('HTTPエラー（429）は throw する', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => mockResponse({ ok: false, status: 429, text: 'rate limited' }))
      )
      await expect(judgeResponse({ question: 'q', answer: 'a' })).rejects.toThrow(/HTTP 429/)
    })

    it('応答に判定テキストが無い場合は throw する', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => mockResponse({ ok: true, status: 200, json: { candidates: [] } }))
      )
      await expect(judgeResponse({ question: 'q', answer: 'a' })).rejects.toThrow(/判定テキスト/)
    })

    it('テキストが不正JSONの場合は throw する', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          mockResponse({
            ok: true,
            status: 200,
            json: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }
          })
        )
      )
      await expect(judgeResponse({ question: 'q', answer: 'a' })).rejects.toThrow()
    })

    it('タイムアウト（fetchがAbortErrorでreject）は throw する', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new DOMException('The operation timed out.', 'TimeoutError')
        })
      )
      await expect(judgeResponse({ question: 'q', answer: 'a' })).rejects.toThrow()
    })
  })
})
