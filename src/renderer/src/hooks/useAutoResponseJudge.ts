import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LlmJudgeResponseRequest } from '../../../shared/types/ipc'
import { calculateResponseScore } from '../domain/scoring/responseScore'
import { dominanceOrchestrator } from '../services/dominanceOrchestrator'
import { createResponseJudger } from '../services/responseJudger'
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
 * 面接官の質問×就活生の回答を沈黙検知で自動判定するフック。
 * enabled=false の間は reportQuestion/reportAnswer がトラッカーを動かさず、LLMを一切呼ばない。
 * 判定経路（responseJudger→reportResponse）は useResponseJudge と同一で、優勢度へ反映される。
 */
export function useAutoResponseJudge(enabled: boolean): AutoResponseJudgeView {
  const judger = useMemo(() => createResponseJudger(), [])
  const [judging, setJudging] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  const runJudge = useCallback(
    async (request: LlmJudgeResponseRequest): Promise<void> => {
      setJudging(true)
      try {
        const outcome = await judger.judge(request)
        if (outcome.status === 'skipped') {
          return
        }

        const responseScore = calculateResponseScore({
          question: request.question,
          answer: request.answer,
          score: outcome.result.score,
          reason: outcome.result.reason
        })
        dominanceOrchestrator.reportResponse(responseScore)
        setScore(responseScore)
        setReason(outcome.result.reason)
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
    setQuestion(text)
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
    setQuestion('')
    setAnswer('')
    setScore(null)
    setReason(null)
  }, [])

  return { judging, score, reason, question, answer, reportQuestion, reportAnswer, reset }
}
