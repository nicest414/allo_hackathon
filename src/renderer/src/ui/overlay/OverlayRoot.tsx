import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import type { DesktopCaptureSource } from '../../../../shared/types/capture'
import type { SttTranscriptEvent } from '../../../../shared/types/ipc'
import type { FaceAnalysisResult, TranscriptSegment } from '../../../../shared/types/analysis'
import {
  getScreenAccessStatus,
  listInterviewerScreenSources,
  openScreenSettings
} from '../../capture/interviewerScreen'
import { candidateMicSttPipeline } from '../../services/candidateMicSttPipeline'
import { interviewerLoopbackSttPipeline } from '../../services/interviewerLoopbackSttPipeline'
import { faceAnalysisLoop } from '../../services/faceAnalysisLoop'
import { voiceAnalysisLoop } from '../../services/voiceAnalysisLoop'
import { dominanceOrchestrator } from '../../services/dominanceOrchestrator'
import {
  captureAndStoreCandidatePortrait,
  captureAndStoreInterviewerPortrait
} from '../../services/portraitCaptureService'
import { detectFillers, DEFAULT_FILLER_WINDOW_MS } from '../../domain/scoring/fillerDetector'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceClashBanner } from './DominanceClashBanner'
import { useInitialCandidatePortraitImage } from './useInitialCandidatePortraitImage'
import { ResponseJudgePanel } from './ResponseJudgePanel'
import { useAutoResponseJudge } from '../../hooks/useAutoResponseJudge'
import {
  buildCursorTransparencyMaskStyle,
  type CursorPosition
} from './cursorTransparencyMask'

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

export function OverlayRoot(): ReactElement {
  useInitialCandidatePortraitImage()

  const baseDominance = useDominanceStore((state) => state.baseDominance)
  const dominance = useDominanceStore((state) => state.dominance)
  const scores = useDominanceStore((state) => state.scores)
  const candidatePortraitImageUrl = useDominanceStore(
    (state) => state.portraitImageUrls.candidate
  )
  const interviewerPortraitImageUrl = useDominanceStore(
    (state) => state.portraitImageUrls.interviewer
  )
  const setScores = useDominanceStore((state) => state.setScores)
  const setDominance = useDominanceStore((state) => state.setDominance)
  const reset = useDominanceStore((state) => state.reset)

  // 実producer（顔分析ループ等）が未実装のため、開発用に候補者顔スコアを手動で動かして
  // オーケストレーター経由の再計算→ゲージ反映を確認できるようにする。
  const [candidateFace, setCandidateFace] = useState(50)
  const [faceLoopState, setFaceLoopState] = useState(faceAnalysisLoop.getState())
  const [screenSources, setScreenSources] = useState<DesktopCaptureSource[]>([])
  const [selectedScreenSourceId, setSelectedScreenSourceId] = useState('')
  const [faceLoopMessage, setFaceLoopMessage] = useState('')
  // 画面収録許可が未許可のとき「許可設定を開く」ボタンを出すためのフラグ。
  const [screenAccessDenied, setScreenAccessDenied] = useState(false)
  const [sttPipelineState, setSttPipelineState] = useState(candidateMicSttPipeline.getState())
  const [interviewerSttPipelineState, setInterviewerSttPipelineState] = useState(
    interviewerLoopbackSttPipeline.getState()
  )
  const [sttMessage, setSttMessage] = useState('')
  const [interviewerSttMessage, setInterviewerSttMessage] = useState('')
  const [latestTranscript, setLatestTranscript] = useState('')
  const [latestInterviewerQuestion, setLatestInterviewerQuestion] = useState('')
  // フィラー検出は確定(final)transcriptの蓄積に対して行うため、最新配列をrefで保持する。
  const finalTranscriptsRef = useRef<TranscriptSegment[]>([])
  const [fillerSummary, setFillerSummary] = useState('')
  const [voiceLoopState, setVoiceLoopState] = useState(voiceAnalysisLoop.getState())
  const [voiceLoopMessage, setVoiceLoopMessage] = useState('')
  // 表情スコアロジックの動作確認用（一時的なデバッグ表示）。スコア合成前の生値を見える化する。
  const [candidateFaceDebug, setCandidateFaceDebug] = useState<FaceAnalysisResult | null>(null)
  const [interviewerFaceDebug, setInterviewerFaceDebug] = useState<FaceAnalysisResult | null>(null)
  const overlayRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return faceAnalysisLoop.onAnalysisResult((subject, result) => {
      if (subject === 'candidate') {
        setCandidateFaceDebug(result)
      } else {
        setInterviewerFaceDebug(result)
      }
    })
  }, [])

  useEffect(() => {
    let isDisposed = false
    const applyCursorMask = (
      element: HTMLElement,
      cursorPosition: CursorPosition | null
    ): void => {
      if (cursorPosition === null) {
        element.style.maskImage = ''
        element.style.webkitMaskImage = ''
        return
      }

      const bounds = element.getBoundingClientRect()
      const maskStyle = buildCursorTransparencyMaskStyle({
        x: cursorPosition.x - bounds.left,
        y: cursorPosition.y - bounds.top
      })
      element.style.maskImage = maskStyle.maskImage?.toString() ?? ''
      element.style.webkitMaskImage = maskStyle.WebkitMaskImage?.toString() ?? ''
    }

    const applyCursorMasks = (cursorPosition: CursorPosition | null): void => {
      const rootElement = overlayRootRef.current
      if (!rootElement) {
        return
      }

      applyCursorMask(rootElement, cursorPosition)
      for (const element of rootElement.querySelectorAll<HTMLElement>(
        '[data-cursor-transparent-mask]'
      )) {
        applyCursorMask(element, cursorPosition)
      }
    }

    const updateCursorPosition = async (): Promise<void> => {
      const cursorPosition = await window.allo.overlay.getCursorPosition()
      if (!isDisposed) {
        applyCursorMasks(cursorPosition)
      }
    }

    const intervalId = window.setInterval(() => {
      void updateCursorPosition()
    }, 33)
    void updateCursorPosition()

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
      applyCursorMasks(null)
    }
  }, [])
  // STT→LLM自動判定。トークン浪費を防ぐため初期OFF。ONの間だけ沈黙検知で自動発火する。
  const [autoJudgeEnabled, setAutoJudgeEnabled] = useState(false)
  const auto = useAutoResponseJudge(autoJudgeEnabled)

  // 直近 windowMs 内のfinal transcriptだけでフィラーを再評価し、Storeへ反映する。
  // 黙る/きれいに話すと古いフィラーが窓から抜けてスコアが下がる（=ゲージが揺れ動く）。
  const recomputeFiller = useCallback((): void => {
    const cutoff = Date.now() - DEFAULT_FILLER_WINDOW_MS
    finalTranscriptsRef.current = finalTranscriptsRef.current.filter(
      (segment) => segment.timestamp >= cutoff
    )
    const result = detectFillers(finalTranscriptsRef.current, undefined, {
      windowMs: DEFAULT_FILLER_WINDOW_MS
    })
    setScores({ filler: result.score })
    setFillerSummary(
      result.fillerCount > 0
        ? `フィラー ${result.fillerCount}回 (${result.matchedFillers.join('・')}) / score ${result.score}`
        : 'フィラー未検出'
    )
  }, [setScores])

  useEffect(() => {
    // 新規transcriptが来なくても定期的に再評価し、時間経過でフィラースコアを減衰させる。
    const intervalId = setInterval(recomputeFiller, 1000)
    return () => {
      clearInterval(intervalId)
      void faceAnalysisLoop.stopAll()
      void voiceAnalysisLoop.stop()
      void candidateMicSttPipeline.stop()
      void interviewerLoopbackSttPipeline.stop()
    }
  }, [recomputeFiller])

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

  const refreshInterviewerSttPipelineState = (): void => {
    setInterviewerSttPipelineState(interviewerLoopbackSttPipeline.getState())
  }

  const handleTranscript = (event: SttTranscriptEvent): void => {
    setLatestTranscript(event.text)

    // 確定したtranscriptのみフィラー検出の対象に蓄積し、Storeのfillerスコアへ反映する。
    // （優勢度への寄与は dominanceCalculator 側で 100-score に反転される）
    if (!event.isFinal) {
      return
    }

    finalTranscriptsRef.current = [
      ...finalTranscriptsRef.current,
      { timestamp: Date.now(), text: event.text, isFinal: true }
    ]
    recomputeFiller()

    // 自動判定ON時：就活生の確定発話を「回答」として渡す（沈黙検知で自動判定）。
    auto.reportAnswer(event.text)
  }

  const startSttPipeline = async (): Promise<void> => {
    // speaker付きSTTになったため、就活生マイクと面接官ループバックは同時に動かせる。
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

  const refreshVoiceLoopState = (): void => {
    setVoiceLoopState(voiceAnalysisLoop.getState())
  }

  const startVoiceLoop = async (): Promise<void> => {
    const result = await voiceAnalysisLoop.start({ intervalMs: 500 })
    refreshVoiceLoopState()
    setVoiceLoopMessage(result.ok ? '声解析中' : result.error.message)
  }

  const stopVoiceLoop = async (): Promise<void> => {
    await voiceAnalysisLoop.stop()
    refreshVoiceLoopState()
    setVoiceLoopMessage('声解析を停止しました')
  }

  const handleInterviewerTranscript = (event: SttTranscriptEvent): void => {
    // 就活生STTと同時に動くため、面接官は「面接官質問」行のみ更新する（STT:行は就活生用）。
    if (event.isFinal && event.text.trim() !== '') {
      setLatestInterviewerQuestion(event.text)
      // 自動判定ON時：面接官の確定発話を「質問」として渡す（新ターン開始）。
      auto.reportQuestion(event.text)
    }
  }

  const startInterviewerSttPipeline = async (): Promise<void> => {
    // 就活生STTと同時に面接官STTを動かせる（speaker付きSTT）。
    const result = await interviewerLoopbackSttPipeline.start({
      chunkMs: 250,
      language: 'ja-JP',
      onTranscript: handleInterviewerTranscript
    })
    refreshInterviewerSttPipelineState()
    setInterviewerSttMessage(
      result.ok
        ? `面接官STT送信中 (${result.sampleRate}Hz)`
        : result.error.message
    )
  }

  const stopInterviewerSttPipeline = async (): Promise<void> => {
    await interviewerLoopbackSttPipeline.stop()
    refreshInterviewerSttPipelineState()
    setInterviewerSttMessage('面接官STT送信を停止しました')
  }

  const loadScreenSources = async (): Promise<void> => {
    // 先に画面収録許可を確認し、未許可なら設定誘導を出す（取得が黒画/失敗するのを防ぐ）。
    const accessStatus = await getScreenAccessStatus()
    if (accessStatus !== 'granted') {
      setScreenAccessDenied(true)
      setScreenSources([])
      setFaceLoopMessage(
        '画面収録の許可が必要です。「許可設定を開く」→「画面収録」でこのアプリを有効化し、再度「画面取得」を押してください。'
      )
      return
    }

    setScreenAccessDenied(false)

    try {
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
    } catch (error) {
      setScreenSources([])
      setFaceLoopMessage(
        `画面ソースの取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const startCandidateAndInterviewerFaceLoops = async (): Promise<void> => {
    const candidateResult = await faceAnalysisLoop.startCandidate({
      fps: 6,
      width: 640,
      height: 480
    })
    const interviewerResult = await faceAnalysisLoop.startInterviewer({
      sourceId: selectedScreenSourceId,
      fps: 4,
      width: 1280,
      height: 720
    })
    refreshFaceLoopState()

    if (interviewerResult.ok) {
      void captureAndStoreInterviewerPortrait({ sourceId: selectedScreenSourceId }).catch(
        (error: unknown) => {
          console.warn('Failed to initialize interviewer portrait image', error)
        }
      )
    }

    const failureMessages: string[] = []
    if (!candidateResult.ok) {
      failureMessages.push(`就活生カメラ解析に失敗しました: ${candidateResult.error.message}`)
    }
    if (!interviewerResult.ok) {
      failureMessages.push(`面接官画面解析に失敗しました: ${interviewerResult.error.message}`)
    }
    setFaceLoopMessage(
      failureMessages.length > 0 ? failureMessages.join(' / ') : '就活生カメラ・面接官画面の解析中'
    )
  }

  const stopCandidateAndInterviewerFaceLoops = async (): Promise<void> => {
    await faceAnalysisLoop.stopAll()
    refreshFaceLoopState()
    setFaceLoopMessage('就活生カメラ・面接官画面の解析を停止しました')
  }

  const retakeCandidateAndInterviewerPortraits = async (): Promise<void> => {
    setFaceLoopMessage('顔写真を再取得しています…')

    const candidateImageUrl = await captureAndStoreCandidatePortrait()
    const interviewerImageUrl = selectedScreenSourceId
      ? await captureAndStoreInterviewerPortrait({ sourceId: selectedScreenSourceId })
      : null

    const failureMessages: string[] = []
    if (!candidateImageUrl) {
      failureMessages.push('候補者の顔写真の再取得に失敗しました')
    }
    if (!selectedScreenSourceId) {
      failureMessages.push('面接官の画面ソースが未選択です')
    } else if (!interviewerImageUrl) {
      failureMessages.push('面接官の顔写真の再取得に失敗しました')
    }

    setFaceLoopMessage(
      failureMessages.length > 0 ? failureMessages.join(' / ') : '顔写真を再取得しました'
    )
  }

  const handleReset = async (): Promise<void> => {
    await faceAnalysisLoop.stopAll()
    await voiceAnalysisLoop.stop()
    await candidateMicSttPipeline.stop()
    await interviewerLoopbackSttPipeline.stop()
    dominanceOrchestrator.reset()
    setCandidateFace(50)
    refreshFaceLoopState()
    refreshVoiceLoopState()
    refreshSttPipelineState()
    refreshInterviewerSttPipelineState()
    setLatestTranscript('')
    setLatestInterviewerQuestion('')
    finalTranscriptsRef.current = []
    setFillerSummary('')
    setVoiceLoopMessage('')
    auto.reset()
    reset()
  }

  return (
    <div ref={overlayRootRef} style={styles.root}>
      <DominanceClashBanner
        value={dominance}
        candidatePortraitSrc={candidatePortraitImageUrl}
        interviewerPortraitSrc={interviewerPortraitImageUrl}
      />
      <div style={styles.content}>
        <div style={styles.values}>
          優勢度: {dominance}（基礎: {baseDominance}）
        </div>
        <div
          style={styles.controls}
          onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
          onMouseLeave={() => void window.allo.overlay.setClickThrough({ enabled: true })}
        >
          <button onClick={() => setDominance(dominance - 10)}>相手 +10</button>
          <button onClick={() => setDominance(dominance + 10)}>You +10</button>
          <button onClick={() => reportCandidateFace(candidateFace - 10)}>顔 -10（dev）</button>
          <button onClick={() => reportCandidateFace(candidateFace + 10)}>顔 +10（dev）</button>
          <button onClick={() => void loadScreenSources()}>画面取得</button>
          {screenAccessDenied ? (
            <button onClick={() => void openScreenSettings()}>許可設定を開く</button>
          ) : null}
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
          {faceLoopState.candidate || faceLoopState.interviewer ? (
            <button onClick={() => void stopCandidateAndInterviewerFaceLoops()}>
              カメラ・面接官停止
            </button>
          ) : (
            <button onClick={() => void startCandidateAndInterviewerFaceLoops()}>
              カメラ・面接官開始
            </button>
          )}
          <button onClick={() => void retakeCandidateAndInterviewerPortraits()}>
            顔写真再取得
          </button>
          {sttPipelineState.running ? (
            <button onClick={() => void stopSttPipeline()}>STT停止</button>
          ) : (
            <button onClick={() => void startSttPipeline()}>STT開始</button>
          )}
          {voiceLoopState.running ? (
            <button onClick={() => void stopVoiceLoop()}>声解析停止</button>
          ) : (
            <button onClick={() => void startVoiceLoop()}>声解析開始</button>
          )}
          {interviewerSttPipelineState.running ? (
            <button onClick={() => void stopInterviewerSttPipeline()}>面接官STT停止</button>
          ) : (
            <button onClick={() => void startInterviewerSttPipeline()}>面接官STT開始</button>
          )}
          <button onClick={() => setAutoJudgeEnabled((value) => !value)}>
            自動判定: {autoJudgeEnabled ? 'ON' : 'OFF'}
          </button>
          <button onClick={handleReset}>リセット</button>
        </div>
        {faceLoopMessage ? <div style={styles.faceLoopMessage}>{faceLoopMessage}</div> : null}
        {voiceLoopMessage ? <div style={styles.sttMessage}>{voiceLoopMessage}</div> : null}
        {sttMessage ? <div style={styles.sttMessage}>{sttMessage}</div> : null}
        {interviewerSttMessage ? (
          <div style={styles.sttMessage}>{interviewerSttMessage}</div>
        ) : null}
        {latestTranscript ? (
          <div style={styles.transcript}>STT: {latestTranscript}</div>
        ) : null}
        {latestInterviewerQuestion ? (
          <div style={styles.transcript}>面接官質問: {latestInterviewerQuestion}</div>
        ) : null}
        {fillerSummary ? <div style={styles.sttMessage}>{fillerSummary}</div> : null}
        {autoJudgeEnabled ? (
          <div style={styles.sttMessage}>
            自動判定ON（沈黙2.5秒で発火）
            {auto.judging ? ' — 判定中…' : ''}
            {auto.score !== null ? ` / response: ${auto.score}` : ''}
            {auto.reason ? ` — ${auto.reason}` : ''}
          </div>
        ) : null}
        <ul style={styles.scores}>
          {Object.entries(scores).map(([key, value]) => (
            <li key={key}>
              {key}: {value}
            </li>
          ))}
        </ul>
        {candidateFaceDebug ? (
          <div style={styles.faceLoopMessage}>
            顔(自分) 生値: smile={candidateFaceDebug.smileLevel} tension=
            {candidateFaceDebug.tensionLevel} expression={candidateFaceDebug.expression}
          </div>
        ) : null}
        {interviewerFaceDebug ? (
          <div style={styles.faceLoopMessage}>
            顔(相手) 生値: smile={interviewerFaceDebug.smileLevel} tension=
            {interviewerFaceDebug.tensionLevel} expression={interviewerFaceDebug.expression}
          </div>
        ) : null}
        <ResponseJudgePanel questionDraft={latestInterviewerQuestion} />
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
