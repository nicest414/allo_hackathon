import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useResponseJudge } from '../../hooks/useResponseJudge'

export interface ResponseJudgePanelProps {
  questionDraft?: string
}

/**
 * 返答内容判定の最小導線UI。
 * 面接官STTで自動取得した質問を初期入力し、必要なら手で補正してLLM判定を呼べるようにする。
 * 判定結果(responseスコア・理由)を表示し、Storeのresponseスコアにも反映される。
 */
export function ResponseJudgePanel({ questionDraft = '' }: ResponseJudgePanelProps): ReactElement {
  const { judge, judging, score, reason } = useResponseJudge()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const lastAppliedQuestionDraftRef = useRef('')

  useEffect(() => {
    const canApplyDraft =
      questionDraft.trim() !== '' &&
      (question.trim() === '' || question === lastAppliedQuestionDraftRef.current)

    if (canApplyDraft) {
      setQuestion(questionDraft)
      lastAppliedQuestionDraftRef.current = questionDraft
    }
  }, [question, questionDraft])

  const canJudge = !judging && question.trim() !== '' && answer.trim() !== ''

  return (
    <div
      style={styles.panel}
      // 入力操作のためホバー中はクリック透過を切る
      onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
      onMouseLeave={() => void window.allo.overlay.setClickThrough({ enabled: true })}
    >
      <input
        style={styles.input}
        placeholder="面接官の質問"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <textarea
        style={{ ...styles.input, height: 48, resize: 'none' }}
        placeholder="就活生の返答"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
      />
      <button disabled={!canJudge} onClick={() => void judge(question, answer)}>
        {judging ? '判定中…' : '返答を判定'}
      </button>
      {score !== null && (
        <p style={styles.result}>
          response: {score}
          {reason ? ` — ${reason}` : ''}
        </p>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    width: '260px',
    background: 'rgba(0, 0, 0, 0.55)',
    borderRadius: '8px',
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '12px'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: '12px'
  },
  result: {
    margin: 0,
    lineHeight: 1.4
  }
}
