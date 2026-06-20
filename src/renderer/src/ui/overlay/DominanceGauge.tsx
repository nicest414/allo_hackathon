import type { CSSProperties, ReactElement } from 'react'

interface DominanceGaugeProps {
  value: number
}

export function DominanceGauge({ value }: DominanceGaugeProps): ReactElement {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))

  return (
    <div style={styles.container}>
      <div style={styles.labels}>
        <span>劣勢</span>
        <span>優勢</span>
      </div>
      <div style={styles.track}>
        <div style={{ ...styles.fill, width: `${clamped}%` }} />
      </div>
      <div style={styles.value}>{clamped}</div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    width: '320px',
    color: '#ffffff',
    fontFamily: 'sans-serif'
  },
  labels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    marginBottom: '4px'
  },
  track: {
    position: 'relative',
    width: '100%',
    height: '16px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden'
  },
  fill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    transition: 'width 0.2s ease-out'
  },
  value: {
    textAlign: 'center',
    fontSize: '24px',
    fontWeight: 'bold',
    marginTop: '4px'
  }
}
