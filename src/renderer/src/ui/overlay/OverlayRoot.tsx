import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type { DesktopCaptureSource } from '../../../../shared/types/capture'
import type { SttTranscriptEvent } from '../../../../shared/types/ipc'
import { listInterviewerScreenSources } from '../../capture/interviewerScreen'
import { candidateMicSttPipeline } from '../../services/candidateMicSttPipeline'
import { faceAnalysisLoop } from '../../services/faceAnalysisLoop'
import { dominanceOrchestrator } from '../../services/dominanceOrchestrator'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceClashBanner } from './DominanceClashBanner'
import { useInitialCandidatePortraitImage } from './useInitialCandidatePortraitImage'
import { ResponseJudgePanel } from './ResponseJudgePanel'

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

export function OverlayRoot(): ReactElement {
  useInitialCandidatePortraitImage()

  const baseDominance = useDominanceStore((state) => state.baseDominance)
  const dominance = useDominanceStore((state) => state.dominance)
  const scores = useDominanceStore((state) => state.scores)
  const candidatePortraitImageUrl = useDominanceStore(
    (state) => state.portraitImageUrls.candidate
  )
  const reset = useDominanceStore((state) => state.reset)

  // 実producer（顔分析ループ等）が未実装のため、開発用に候補者顔スコアを手動で動かして
  // オーケストレーター経由の再計算→ゲージ反映を確認できるようにする。
  const [candidateFace, setCandidateFace] = useState(50)
  const [faceLoopState, setFaceLoopState] = useState(faceAnalysisLoop.getState())
  const [screenSources, setScreenSources] = useState<DesktopCaptureSource[]>([])
  const [selectedScreenSourceId, setSelectedScreenSourceId] = useState('')
  const [faceLoopMessage, setFaceLoopMessage] = useState('')
  const [sttPipelineState, setSttPipelineState] = useState(candidateMicSttPipeline.getState())
  const [sttMessage, setSttMessage] = useState('')
  const [latestTranscript, setLatestTranscript] = useState('')

  useEffect(() => {
    return () => {
      void faceAnalysisLoop.stopAll()
      void candidateMicSttPipeline.stop()
    }
  }, [])

  const reportCandidateFace = (next: number): void => {
    const value = clamp(next)
    setCandidateFace(value)
    dominanceOrchestrator.reportCandidateFace({ subject: 'candidate', value })
  }

  const refreshFaceLoopState = (): void => {
    setFaceLoopState(faceAnalysisLoop.getState())
  }

  const refreshSttPipelineState = (): void => {
    setSttPipelineState(candidateMicSttPipeline.getState())
  }

  const handleTranscript = (event: SttTranscriptEvent): void => {
    setLatestTranscript(event.text)
  }

  const startSttPipeline = async (): Promise<void> => {
    const result = await candidateMicSttPipeline.start({
      chunkMs: 250,
      sampleRate: 16000,
      channelCount: 1,
      onTranscript: handleTranscript
    })
    refreshSttPipelineState()
    setSttMessage(result.ok ? `STT送信中 (${result.sampleRate}Hz)` : result.error.message)
  }

  const stopSttPipeline = async (): Promise<void> => {
    await candidateMicSttPipeline.stop()
    refreshSttPipelineState()
    setSttMessage('STT送信を停止しました')
  }

  const startCandidateFaceLoop = async (): Promise<void> => {
    const result = await faceAnalysisLoop.startCandidate({ fps: 6, width: 640, height: 480 })
    refreshFaceLoopState()
    setFaceLoopMessage(result.ok ? '就活生カメラ解析中' : result.error.message)
  }

  const stopCandidateFaceLoop = async (): Promise<void> => {
    await faceAnalysisLoop.stopCandidate()
    refreshFaceLoopState()
    setFaceLoopMessage('就活生カメラ解析を停止しました')
  }

  const loadScreenSources = async (): Promise<void> => {
    const sources = await listInterviewerScreenSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 160, height: 90 }
    })

    setScreenSources(sources)
    setSelectedScreenSourceId((current) => current || sources[0]?.id || '')
    setFaceLoopMessage(
      sources.length === 0
        ? '共有できる画面ソースが見つかりません'
        : '面接官画面ソースを更新しました'
    )
  }

  const startInterviewerFaceLoop = async (): Promise<void> => {
    const result = await faceAnalysisLoop.startInterviewer({
      sourceId: selectedScreenSourceId,
      fps: 4,
      width: 1280,
      height: 720
    })
    refreshFaceLoopState()
    setFaceLoopMessage(result.ok ? '面接官画面解析中' : result.error.message)
  }

  const stopInterviewerFaceLoop = async (): Promise<void> => {
    await faceAnalysisLoop.stopInterviewer()
    refreshFaceLoopState()
    setFaceLoopMessage('面接官画面解析を停止しました')
  }

  const handleReset = async (): Promise<void> => {
    await faceAnalysisLoop.stopAll()
    await candidateMicSttPipeline.stop()
    dominanceOrchestrator.reset()
    setCandidateFace(50)
    refreshFaceLoopState()
    refreshSttPipelineState()
    setLatestTranscript('')
    reset()
  }

  return (
    <div style={styles.root}>
      <DominanceClashBanner value={dominance} candidatePortraitSrc={candidatePortraitImageUrl} />
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
          {faceLoopState.candidate ? (
            <button onClick={() => void stopCandidateFaceLoop()}>カメラ停止</button>
          ) : (
            <button onClick={() => void startCandidateFaceLoop()}>カメラ開始</button>
          )}
          <button onClick={() => void loadScreenSources()}>画面取得</button>
          <select
            value={selectedScreenSourceId}
            onChange={(event) => setSelectedScreenSourceId(event.target.value)}
          >
            <option value="">画面未選択</option>
            {screenSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          {faceLoopState.interviewer ? (
            <button onClick={() => void stopInterviewerFaceLoop()}>面接官停止</button>
          ) : (
            <button onClick={() => void startInterviewerFaceLoop()}>面接官開始</button>
          )}
          {sttPipelineState.running ? (
            <button onClick={() => void stopSttPipeline()}>STT停止</button>
          ) : (
            <button onClick={() => void startSttPipeline()}>STT開始</button>
          )}
          <button onClick={handleReset}>リセット</button>
        </div>
        {faceLoopMessage ? <div style={styles.faceLoopMessage}>{faceLoopMessage}</div> : null}
        {sttMessage ? <div style={styles.sttMessage}>{sttMessage}</div> : null}
        {latestTranscript ? (
          <div style={styles.transcript}>STT: {latestTranscript}</div>
        ) : null}
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
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  faceLoopMessage: {
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '12px'
  },
  sttMessage: {
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '12px'
  },
  transcript: {
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '12px',
    maxWidth: '720px',
    overflowWrap: 'anywhere'
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
