import { useCallback, useMemo, useState } from 'react'
import { calculateResponseScore } from '../domain/scoring/responseScore'
import { dominanceOrchestrator } from '../services/dominanceOrchestrator'
import { createResponseJudger } from '../services/responseJudger'

export interface ResponseJudgeView {
  /** 判定リクエスト中か */
  judging: boolean
  /** 直近の返答内容スコア(0-100)。未判定はnull */
  score: number | null
  /** 直近の判定理由（失敗時はエラー理由）。未判定はnull */
  reason: string | null
  /** 質問と返答を発話単位で判定し、結果をStoreのresponseスコアへ反映する */
  judge: (question: string, answer: string) => Promise<void>
}

/**
 * 返答内容判定をrendererから発話単位で呼び出し、結果を優勢度Storeへ接続するフック。
 * 呼び出し頻度の制御は responseJudger に委譲し、スコアの合成/補正は行わない（#33の責務）。
 */
export function useResponseJudge(): ResponseJudgeView {
  const judger = useMemo(() => createResponseJudger(), [])
  const [judging, setJudging] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  const judge = useCallback(
    async (question: string, answer: string) => {
      setJudging(true)

      try {
        const outcome = await judger.judge({ question, answer })

        // 重複/throttle/空入力でスキップされた場合は何も更新しない
        if (outcome.status === 'skipped') {
          return
        }

        // ok / error いずれもresultを反映する（errorは中立スコア+理由）
        const responseScore = calculateResponseScore({
          question,
          answer,
          score: outcome.result.score,
          reason: outcome.result.reason
        })

        // 返答スコアはオーケストレーター経由でStoreへ反映し、優勢度を再計算させる
        dominanceOrchestrator.reportResponse(responseScore)
        setScore(responseScore)
        setReason(outcome.result.reason)
      } finally {
        setJudging(false)
      }
    },
    [judger]
  )

  return { judging, score, reason, judge }
}
