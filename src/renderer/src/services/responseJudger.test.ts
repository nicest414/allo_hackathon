import { describe, expect, it, vi } from 'vitest'
import { createResponseJudger } from './responseJudger'

const request = { question: 'なぜ当社を志望しますか', answer: '御社の技術力に惹かれました' }

describe('createResponseJudger', () => {
  it('正常に判定結果を返す', async () => {
    const judge = vi.fn().mockResolvedValue({ score: 80, reason: '具体的' })
    const judger = createResponseJudger({ judge })

    const outcome = await judger.judge(request)

    expect(outcome).toEqual({ status: 'ok', result: { score: 80, reason: '具体的' } })
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('質問または返答が空ならスキップして呼び出さない', async () => {
    const judge = vi.fn().mockResolvedValue({ score: 80, reason: 'x' })
    const judger = createResponseJudger({ judge })

    expect(await judger.judge({ question: '  ', answer: 'a' })).toEqual({
      status: 'skipped',
      reason: 'empty'
    })
    expect(await judger.judge({ question: 'q', answer: '' })).toEqual({
      status: 'skipped',
      reason: 'empty'
    })
    expect(judge).not.toHaveBeenCalled()
  })

  it('判定中の重複呼び出しはbusyでスキップする', async () => {
    let resolve: (value: { score: number; reason: string }) => void = () => {}
    const judge = vi.fn().mockImplementation(
      () =>
        new Promise<{ score: number; reason: string }>((r) => {
          resolve = r
        })
    )
    const judger = createResponseJudger({ judge })

    const first = judger.judge(request)
    const second = await judger.judge(request)

    expect(second).toEqual({ status: 'skipped', reason: 'busy' })

    resolve({ score: 70, reason: 'ok' })
    expect(await first).toEqual({ status: 'ok', result: { score: 70, reason: 'ok' } })
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('最小間隔内の再呼び出しはthrottledでスキップする', async () => {
    const judge = vi.fn().mockResolvedValue({ score: 60, reason: 'ok' })
    let clock = 1000
    const judger = createResponseJudger({ judge, minIntervalMs: 1500, now: () => clock })

    await judger.judge(request) // lastCallAt = 1000
    clock = 2000 // 1000ms後 < 1500ms

    expect(await judger.judge(request)).toEqual({ status: 'skipped', reason: 'throttled' })
    expect(judge).toHaveBeenCalledTimes(1)

    clock = 2600 // 前回(1000)から1600ms後 >= 1500ms
    // 別内容の質問/回答にしてthrottle解除を確認（同一だとdedupに当たるため）
    const outcome = await judger.judge({ question: 'q2', answer: 'a2' })
    expect(outcome.status).toBe('ok')
    expect(judge).toHaveBeenCalledTimes(2)
  })

  it('直近に判定したのと同一の質問×回答はduplicateでスキップする', async () => {
    const judge = vi.fn().mockResolvedValue({ score: 60, reason: 'ok' })
    let clock = 1000
    const judger = createResponseJudger({ judge, minIntervalMs: 1500, now: () => clock })

    await judger.judge(request) // 1回目はOK
    clock = 5000 // throttle窓は十分過ぎている

    expect(await judger.judge(request)).toEqual({ status: 'skipped', reason: 'duplicate' })
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('判定失敗時は中立スコアと理由を返す', async () => {
    const judge = vi.fn().mockRejectedValue(new Error('IPC失敗'))
    const judger = createResponseJudger({ judge })

    const outcome = await judger.judge(request)

    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') {
      expect(outcome.result.score).toBe(50)
      expect(outcome.result.reason).toContain('IPC失敗')
    }
  })
})
