import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LlmJudgeResponseRequest } from '../../../shared/types/ipc'
import { calculateResponseScore } from '../domain/scoring/responseScore'
import { dominanceOrchestrator } from '../services/dominanceOrchestrator'
import { createResponseJudger } from '../services/responseJudger'
import {
  createResponseHistoryTracker,
  type ResponseHistoryTracker
} from '../services/responseHistoryTracker'
import {
  createResponseTurnTracker,
  type ResponseTurnTracker
} from '../services/responseTurnTracker'

export interface AutoResponseJudgeView {
  /** 自動判定リクエスト中か */
  judging: boolean
  /** 直近の返答内容スコア(0-100)。未判定はnull */
  score: number | null
  /** 直近の判定理由。未判定はnull */
  reason: string | null
  /** 現在のターンの質問（表示用） */
  question: string
  /** 直近に受け取った回答テキスト（表示用） */
  answer: string
  /** 面接官STTの確定transcriptを質問として渡す */
  reportQuestion: (text: string) => void
  /** 就活生STTの確定transcriptを回答として渡す */
  reportAnswer: (text: string) => void
  /** ターン状態をリセット */
  reset: () => void
}

/**
 * 面接官の質問×就活生の回答を、質問と回答のやり取りが1セット終わるタイミング
 * （面接官の次の質問が来た時点。来ない場合は沈黙のフォールバックタイマー）で自動判定するフック。
 * enabled=false の間は reportQuestion/reportAnswer がトラッカーを動かさず、LLMを一切呼ばない。
 */
export function useAutoResponseJudge(enabled: boolean): AutoResponseJudgeView {
  const judger = useMemo(() => createResponseJudger(), [])
  const [judging, setJudging] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  // 同一ターン内のLLM呼び出し回数（クォータ消費の追跡用）。reportQuestionで新ターンになるとリセット。
  const turnCallCountRef = useRef(0)
  // 直近の連続エラー回数。429等の失敗が続いていることをログで分かるようにする（EMAには加算しない）。
  const consecutiveErrorCountRef = useRef(0)
  // 直近の質問×回答ペアを保持し、文脈依存の質問（指示語・前の回答への言及等）の判定精度を上げる。
  const historyTrackerRef = useRef<ResponseHistoryTracker | undefined>(undefined)
  if (!historyTrackerRef.current) {
    historyTrackerRef.current = createResponseHistoryTracker()
  }

  const runJudge = useCallback(
    async (request: LlmJudgeResponseRequest): Promise<void> => {
      turnCallCountRef.current += 1
      historyTrackerRef.current?.recordTurn({ question: request.question, answer: request.answer })
      const history = historyTrackerRef.current?.getHistory() ?? []
      const requestWithHistory: LlmJudgeResponseRequest = {
        ...request,
        history: history.length > 0 ? history : undefined
      }
      console.log(
        `[auto-judge] 判定中…(このターン${turnCallCountRef.current}回目, 履歴${history.length}件) question="${request.question}" answer="${request.answer}"`
      )
      setJudging(true)
      try {
        const outcome = await judger.judge(requestWithHistory)
        if (outcome.status === 'skipped') {
          console.log(`[auto-judge] status=skipped(${outcome.reason})`)
          return
        }

        if (outcome.status === 'error') {
          // API呼び出し失敗時の中立値(50)は実際の判定ではないため、優勢度のEMAに加算しない
          // （直前の有効なスコア/理由をそのまま維持する）。
          consecutiveErrorCountRef.current += 1
          console.log(
            `[auto-judge] status=error(連続${consecutiveErrorCountRef.current}回目) reason=${outcome.result.reason}（優勢度には加算しない）`
          )
          return
        }

        consecutiveErrorCountRef.current = 0
        const responseScore = calculateResponseScore({
          question: request.question,
          answer: request.answer,
          score: outcome.result.score,
          reason: outcome.result.reason
        })
        dominanceOrchestrator.reportResponse(responseScore)
        setScore(responseScore)
        setReason(outcome.result.reason)
        console.log(`[auto-judge] status=ok response=${responseScore} reason=${outcome.result.reason}`)
      } finally {
        setJudging(false)
      }
    },
    [judger]
  )

  // トラッカーは1度だけ生成。onTurn は安定な runJudge を参照する。
  const trackerRef = useRef<ResponseTurnTracker | undefined>(undefined)
  if (!trackerRef.current) {
    trackerRef.current = createResponseTurnTracker({
      onTurn: (request) => {
        void runJudge(request)
      }
    })
  }

  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      trackerRef.current?.reset()
    }
  }, [enabled])

  useEffect(() => {
    return () => {
      trackerRef.current?.dispose()
    }
  }, [])

  const reportQuestion = useCallback((text: string): void => {
    if (!enabledRef.current) {
      return
    }
    historyTrackerRef.current?.onQuestionChange(text)
    setQuestion(text)
    turnCallCountRef.current = 0
    trackerRef.current?.setQuestion(text)
  }, [])

  const reportAnswer = useCallback((text: string): void => {
    if (!enabledRef.current) {
      return
    }
    setAnswer(text)
    trackerRef.current?.addAnswer(text)
  }, [])

  const reset = useCallback((): void => {
    trackerRef.current?.reset()
    historyTrackerRef.current?.reset()
    setQuestion('')
    setAnswer('')
    setScore(null)
    setReason(null)
    turnCallCountRef.current = 0
    consecutiveErrorCountRef.current = 0
  }, [])

  return { judging, score, reason, question, answer, reportQuestion, reportAnswer, reset }
}
