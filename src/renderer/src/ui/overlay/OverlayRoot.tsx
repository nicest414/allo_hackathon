import { useState, type CSSProperties, type ReactElement } from 'react'
import { dominanceOrchestrator } from '../../services/dominanceOrchestrator'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceClashBanner } from './DominanceClashBanner'
import { ResponseJudgePanel } from './ResponseJudgePanel'

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

export function OverlayRoot(): ReactElement {
  const baseDominance = useDominanceStore((state) => state.baseDominance)
  const dominance = useDominanceStore((state) => state.dominance)
  const scores = useDominanceStore((state) => state.scores)
  const reset = useDominanceStore((state) => state.reset)

  // 実producer（顔分析ループ等）が未実装のため、開発用に候補者顔スコアを手動で動かして
  // オーケストレーター経由の再計算→ゲージ反映を確認できるようにする。
  const [candidateFace, setCandidateFace] = useState(50)

  const reportCandidateFace = (next: number): void => {
    const value = clamp(next)
    setCandidateFace(value)
    dominanceOrchestrator.reportCandidateFace({ subject: 'candidate', value })
  }

  const handleReset = (): void => {
    dominanceOrchestrator.reset()
    setCandidateFace(50)
    reset()
  }

  return (
    <div style={styles.root}>
      <DominanceClashBanner value={dominance} />
      <div style={styles.content}>
        <div style={styles.values}>
          優勢度: {dominance}（基礎: {baseDominance}）
        </div>
        <div
          style={styles.controls}
          onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
          onMouseLeave={() => void window.allo.overlay.setClickThrough({ enabled: true })}
        >
          <button onClick={() => reportCandidateFace(candidateFace - 10)}>顔 -10（dev）</button>
          <button onClick={() => reportCandidateFace(candidateFace + 10)}>顔 +10（dev）</button>
          <button onClick={handleReset}>リセット</button>
        </div>
        <ul style={styles.scores}>
          {Object.entries(scores).map(([key, value]) => (
            <li key={key}>
              {key}: {value}
            </li>
          ))}
        </ul>
        <ResponseJudgePanel />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    alignItems: 'stretch',
    gap: '12px'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '16px'
  },
  values: {
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '13px'
  },
  controls: {
    display: 'flex',
    gap: '8px'
  },
  scores: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '12px',
    display: 'flex',
    gap: '12px'
  }
}
