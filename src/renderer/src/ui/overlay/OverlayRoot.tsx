import type { CSSProperties, ReactElement } from 'react'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceGauge } from './DominanceGauge'

export function OverlayRoot(): ReactElement {
  const dominance = useDominanceStore((state) => state.dominance)
  const scores = useDominanceStore((state) => state.scores)
  const setDominance = useDominanceStore((state) => state.setDominance)
  const reset = useDominanceStore((state) => state.reset)

  return (
    <div style={styles.root}>
      <DominanceGauge value={dominance} />
      <div style={styles.controls}>
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
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
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
