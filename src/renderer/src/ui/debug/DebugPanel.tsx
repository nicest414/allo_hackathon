import React, { useState } from 'react'
import { useDominanceStore } from '../../store/useDominanceStore'
import './DebugPanel.css'

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const {
    mockMode,
    setMockMode,
    scores,
    setScores,
    dominance,
    triggerCutin,
    logs,
    clearLogs
  } = useDominanceStore()

  const handleSliderChange = (key: keyof typeof scores, value: number) => {
    setScores({ [key]: value }, true)
  }

  const togglePanel = () => {
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    // パネルを開いて操作する間はクリック透過を切り、閉じたら透過させる
    void window.allo.overlay.setClickThrough({ enabled: !nextOpen })
  }

  return (
    <div className={`debug-panel ${isOpen ? 'debug-panel--open' : ''}`}>
      <button 
        className="debug-panel__toggle" 
        onClick={togglePanel}
        onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
        onMouseLeave={() => {
          if (!isOpen) {
            void window.allo.overlay.setClickThrough({ enabled: true })
          }
        }}
      >
        {isOpen ? '❌' : '⚙️ Debug'}
      </button>

      {isOpen && (
        <div 
          className="debug-panel__content"
          onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
          onMouseLeave={() => void window.allo.overlay.setClickThrough({ enabled: false })}
        >
          <h3 className="debug-panel__title">Debugger Panel</h3>
          
          <div className="debug-panel__section">
            <label className="debug-panel__label">
              <input 
                type="checkbox" 
                checked={mockMode} 
                onChange={(e) => setMockMode(e.target.checked)} 
              />
              Mock Mode (Ignore Sensors)
            </label>
          </div>

          <div className="debug-panel__section">
            <div className="debug-panel__monitor">
              <span>Overall Dominance:</span>
              <strong className="debug-panel__dominance-value">{dominance}</strong>
              <div className="debug-panel__progress-bg">
                <div 
                  className="debug-panel__progress-bar" 
                  style={{ width: `${dominance}%` }}
                />
              </div>
            </div>
          </div>

          <div className="debug-panel__section">
            <h4>Simulator Sliders</h4>
            {Object.entries(scores).map(([key, value]) => (
              <div key={key} className="debug-panel__slider-group">
                <div className="debug-panel__slider-header">
                  <span className="debug-panel__slider-name">{key}</span>
                  <span className="debug-panel__slider-val">{value}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={value} 
                  disabled={!mockMode}
                  onChange={(e) => handleSliderChange(key as any, parseInt(e.target.value))}
                  className="debug-panel__slider"
                />
              </div>
            ))}
          </div>

          <div className="debug-panel__section">
            <h4>Force Cutin Test</h4>
            <div className="debug-panel__btn-group">
              <button 
                className="debug-panel__btn debug-panel__btn--dominance"
                onClick={() => triggerCutin('dominance')}
              >
                Dominance (異議あり!)
              </button>
              <button 
                className="debug-panel__btn debug-panel__btn--deficit"
                onClick={() => triggerCutin('deficit')}
              >
                Deficit (劣勢)
              </button>
            </div>
          </div>

          <div className="debug-panel__section">
            <div className="debug-panel__section-header">
              <h4>Real-time Console Logs</h4>
              <button className="debug-panel__clear-btn" onClick={clearLogs}>Clear</button>
            </div>
            <div className="debug-panel__log-console">
              {logs.length === 0 ? (
                <div className="debug-panel__log-empty">No logs recorded yet.</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`debug-panel__log-line debug-panel__log-line--${log.type}`}>
                    <span className="debug-panel__log-time">[{log.timestamp}]</span>{' '}
                    <span className="debug-panel__log-msg">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

