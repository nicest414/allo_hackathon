import type { CSSProperties, ReactElement } from 'react'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceClashBanner } from './DominanceClashBanner'
import { ResponseJudgePanel } from './ResponseJudgePanel'

export function OverlayRoot(): ReactElement {
  const dominance = useDominanceStore((state) => state.dominance)
  const scores = useDominanceStore((state) => state.scores)
  const setDominance = useDominanceStore((state) => state.setDominance)
  const reset = useDominanceStore((state) => state.reset)

  return (
    <div style={styles.root}>
      <DominanceClashBanner value={dominance} />
      <div style={styles.content}>
        <div
          style={styles.controls}
          onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
          onMouseLeave={() => void window.allo.overlay.setClickThrough({ enabled: true })}
        >
          <button onClick={() => setDominance(dominance - 10)}>劣勢 -10</button>
          <button onClick={() => setDominance(dominance + 10)}>優勢 +10</button>
          <button onClick={reset}>リセット</button>
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
