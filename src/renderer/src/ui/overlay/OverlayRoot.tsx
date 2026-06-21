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
import type { NormalizedRect } from '../../capture/portraitFrame'
import { candidateMicSttPipeline } from '../../services/candidateMicSttPipeline'
import { interviewerLoopbackSttPipeline } from '../../services/interviewerLoopbackSttPipeline'
import { faceAnalysisLoop } from '../../services/faceAnalysisLoop'
import { voiceAnalysisLoop } from '../../services/voiceAnalysisLoop'
import {
  applyManualInterviewerPortraitRect,
  captureAndStoreCandidatePortrait,
  captureAndStoreInterviewerPortrait
} from '../../services/portraitCaptureService'
import { detectFillers, DEFAULT_FILLER_WINDOW_MS } from '../../domain/scoring/fillerDetector'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceClashBanner } from './DominanceClashBanner'
import { ManualFaceRegionDialog } from './ManualFaceRegionDialog'
import { useInitialCandidatePortraitImage } from './useInitialCandidatePortraitImage'
import { useAutoResponseJudge } from '../../hooks/useAutoResponseJudge'

export function OverlayRoot(): ReactElement {
  useInitialCandidatePortraitImage()

  const baseDominance = useDominanceStore((state) => state.baseDominance)
  const candidatePortraitImageUrl = useDominanceStore(
    (state) => state.portraitImageUrls.candidate
  )
  const interviewerPortraitImageUrl = useDominanceStore(
    (state) => state.portraitImageUrls.interviewer
  )
  const interviewerManualFaceRect = useDominanceStore((state) => state.interviewerManualFaceRect)
  const setInterviewerManualFaceRect = useDominanceStore(
    (state) => state.setInterviewerManualFaceRect
  )
  const [manualFaceDialogRequest, setManualFaceDialogRequest] = useState<{
    rawFrameDataUrl: string
    sourceWidth: number
    sourceHeight: number
  } | null>(null)
  const setScores = useDominanceStore((state) => state.setScores)
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
  // フィラー検出は確定(final)transcriptの蓄積に対して行うため、最新配列をrefで保持する。
  const finalTranscriptsRef = useRef<TranscriptSegment[]>([])
  const [voiceLoopState, setVoiceLoopState] = useState(voiceAnalysisLoop.getState())
  const [voiceLoopMessage, setVoiceLoopMessage] = useState('')
  // 表情スコアロジックの生値はターミナルログ用に保持するのみで、画面には出さない。
  const candidateFaceDebugRef = useRef<FaceAnalysisResult | null>(null)
  const interviewerFaceDebugRef = useRef<FaceAnalysisResult | null>(null)

  useEffect(() => {
    return faceAnalysisLoop.onAnalysisResult((subject, result) => {
      if (subject === 'candidate') {
        candidateFaceDebugRef.current = result
      } else {
        interviewerFaceDebugRef.current = result
      }
    })
  }, [])
  // STT→LLM自動判定。トークン浪費を防ぐため初期OFF。ONの間だけ沈黙検知で自動発火する。
  const [autoJudgeEnabled, setAutoJudgeEnabled] = useState(false)
  const auto = useAutoResponseJudge(autoJudgeEnabled)

  const isInterviewRunning =
    faceLoopState.candidate ||
    faceLoopState.interviewer ||
    sttPipelineState.running ||
    voiceLoopState.running ||
    interviewerSttPipelineState.running

  // 生スコア・顔の生値はデバッグ用情報のため、画面表示せずターミナルログにのみ出す。
  useEffect(() => {
    if (!isInterviewRunning) {
      return
    }
    const intervalId = setInterval(() => {
      const { scores } = useDominanceStore.getState()
      console.log(
        `[scores] candidateFace=${scores.candidateFace} interviewerFace=${scores.interviewerFace} voice=${scores.voice} filler=${scores.filler} response=${scores.response}`
      )
      const cf = candidateFaceDebugRef.current
      if (cf) {
        console.log(
          `[face:candidate] smile=${cf.smileLevel} tension=${cf.tensionLevel} expression=${cf.expression}`
        )
      }
      const iface = interviewerFaceDebugRef.current
      if (iface) {
        console.log(
          `[face:interviewer] smile=${iface.smileLevel} tension=${iface.tensionLevel} expression=${iface.expression}`
        )
      }
    }, 1000)
    return () => clearInterval(intervalId)
  }, [isInterviewRunning])

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
    console.log(
      result.fillerCount > 0
        ? `[filler] フィラー ${result.fillerCount}回 (${result.matchedFillers.join('・')}) / score ${result.score}`
        : '[filler] フィラー未検出'
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

  // 手動範囲指定ダイアログはドラッグ操作を伴うため、ホバー時だけでなく開いている間は
  // 常時クリックスルーをOFFにする（ホバーが外れた瞬間に裏のアプリへクリックが漏れてドラッグが
  // 中断するのを防ぐ）。
  useEffect(() => {
    void window.allo.overlay.setClickThrough({ enabled: manualFaceDialogRequest === null })
  }, [manualFaceDialogRequest])

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
    console.log(`[transcript] STT${event.isFinal ? '' : '(interim)'}: ${event.text}`)

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
    if (result.ok) {
      console.log(`[stt] STT送信中 (${result.sampleRate}Hz)`)
      setSttMessage('')
    } else {
      setSttMessage(result.error.message)
    }
  }

  const stopSttPipeline = async (): Promise<void> => {
    await candidateMicSttPipeline.stop()
    refreshSttPipelineState()
    console.log('[stt] STT送信を停止しました')
    setSttMessage('')
  }

  const refreshVoiceLoopState = (): void => {
    setVoiceLoopState(voiceAnalysisLoop.getState())
  }

  const startVoiceLoop = async (): Promise<void> => {
    const result = await voiceAnalysisLoop.start({ intervalMs: 500 })
    refreshVoiceLoopState()
    if (result.ok) {
      console.log('[voice] 声解析中')
      setVoiceLoopMessage('')
    } else {
      setVoiceLoopMessage(result.error.message)
    }
  }

  const stopVoiceLoop = async (): Promise<void> => {
    await voiceAnalysisLoop.stop()
    refreshVoiceLoopState()
    console.log('[voice] 声解析を停止しました')
    setVoiceLoopMessage('')
  }

  const handleInterviewerTranscript = (event: SttTranscriptEvent): void => {
    // 就活生STTと同時に動くため、面接官は「面接官質問」行のみ更新する（STT:行は就活生用）。
    if (event.isFinal && event.text.trim() !== '') {
      console.log(`[transcript] 面接官質問: ${event.text}`)
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
    if (result.ok) {
      console.log(`[interviewer-stt] 面接官STT送信中 (${result.sampleRate}Hz)`)
      setInterviewerSttMessage('')
    } else {
      setInterviewerSttMessage(result.error.message)
    }
  }

  const stopInterviewerSttPipeline = async (): Promise<void> => {
    await interviewerLoopbackSttPipeline.stop()
    refreshInterviewerSttPipelineState()
    console.log('[interviewer-stt] 面接官STT送信を停止しました')
    setInterviewerSttMessage('')
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
      if (sources.length === 0) {
        setFaceLoopMessage('共有できる画面ソースが見つかりません')
      } else {
        console.log('[face] 面接官画面ソースを更新しました')
        setFaceLoopMessage('')
      }
    } catch (error) {
      setScreenSources([])
      setFaceLoopMessage(
        `画面ソースの取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // 自動検出→記憶済みmanualRect→(allowManualFallbackなら)手動指定ダイアログ、の優先順位で
  // 面接官の顔写真を取得する。面接開始時(allowManualFallback=false)はダイアログを出さず、
  // 「顔写真再取得」ボタン(allowManualFallback=true)のときだけユーザーに手動指定を促す。
  const captureInterviewerPortraitWithFallback = async (
    allowManualFallback: boolean
  ): Promise<{ ok: boolean; message?: string }> => {
    if (!selectedScreenSourceId) {
      return { ok: false, message: '面接官の画面ソースが未選択です' }
    }

    const result = await captureAndStoreInterviewerPortrait({
      sourceId: selectedScreenSourceId,
      manualRect: interviewerManualFaceRect,
      allowManualFallback
    })

    switch (result.kind) {
      case 'stored':
        return { ok: true }
      case 'manual-required':
        setManualFaceDialogRequest({
          rawFrameDataUrl: result.rawFrameDataUrl,
          sourceWidth: result.sourceWidth,
          sourceHeight: result.sourceHeight
        })
        return { ok: false, message: '面接官の顔を検出できませんでした。範囲を指定してください。' }
      case 'failed':
        return { ok: false, message: '面接官の顔写真の取得に失敗しました' }
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
      void captureInterviewerPortraitWithFallback(false).then((result) => {
        if (!result.ok && result.message) {
          console.warn(result.message)
        }
      })
    }

    const failureMessages: string[] = []
    if (!candidateResult.ok) {
      failureMessages.push(`就活生カメラ解析に失敗しました: ${candidateResult.error.message}`)
    }
    if (!interviewerResult.ok) {
      failureMessages.push(`面接官画面解析に失敗しました: ${interviewerResult.error.message}`)
    }
    if (failureMessages.length > 0) {
      setFaceLoopMessage(failureMessages.join(' / '))
    } else {
      console.log('[face] 就活生カメラ・面接官画面の解析中')
      setFaceLoopMessage('')
    }
  }

  const stopCandidateAndInterviewerFaceLoops = async (): Promise<void> => {
    await faceAnalysisLoop.stopAll()
    refreshFaceLoopState()
    console.log('[face] 就活生カメラ・面接官画面の解析を停止しました')
    setFaceLoopMessage('')
  }

  const retakeCandidateAndInterviewerPortraits = async (): Promise<void> => {
    console.log('[face] 顔写真を再取得しています…')
    setFaceLoopMessage('')

    const candidateImageUrl = await captureAndStoreCandidatePortrait()
    const interviewerResult = await captureInterviewerPortraitWithFallback(true)

    const failureMessages: string[] = []
    if (!candidateImageUrl) {
      failureMessages.push('候補者の顔写真の再取得に失敗しました')
    }
    if (!interviewerResult.ok && interviewerResult.message) {
      failureMessages.push(interviewerResult.message)
    }

    if (failureMessages.length > 0) {
      setFaceLoopMessage(failureMessages.join(' / '))
    } else {
      console.log('[face] 顔写真を再取得しました')
      setFaceLoopMessage('')
    }
  }

  const handleManualFaceRegionConfirm = async (rect: NormalizedRect): Promise<void> => {
    const request = manualFaceDialogRequest
    setInterviewerManualFaceRect(rect)
    setManualFaceDialogRequest(null)

    if (request !== null) {
      await applyManualInterviewerPortraitRect(request.rawFrameDataUrl, rect)
    }
  }

  const handleManualFaceRegionCancel = (): void => {
    setManualFaceDialogRequest(null)
  }

  const startInterview = async (): Promise<void> => {
    await startCandidateAndInterviewerFaceLoops()
    await startSttPipeline()
    await startVoiceLoop()
    await startInterviewerSttPipeline()
  }

  const stopInterview = async (): Promise<void> => {
    await stopCandidateAndInterviewerFaceLoops()
    await stopSttPipeline()
    await stopVoiceLoop()
    await stopInterviewerSttPipeline()
  }

  return (
    <div style={styles.root}>
      <DominanceClashBanner
        value={baseDominance}
        candidatePortraitSrc={candidatePortraitImageUrl}
        interviewerPortraitSrc={interviewerPortraitImageUrl}
      />
      <div style={styles.content}>
        <div style={styles.values}>優勢度: {Math.round(baseDominance)}</div>
        <div
          style={styles.controls}
          onMouseEnter={() => void window.allo.overlay.setClickThrough({ enabled: false })}
          onMouseLeave={() => void window.allo.overlay.setClickThrough({ enabled: true })}
        >
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
          <button onClick={() => void retakeCandidateAndInterviewerPortraits()}>
            顔写真再取得
          </button>
          {interviewerManualFaceRect !== undefined ? (
            <button onClick={() => setInterviewerManualFaceRect(undefined)}>
              顔の範囲を再指定
            </button>
          ) : null}
          {isInterviewRunning ? (
            <button onClick={() => void stopInterview()}>面接終了</button>
          ) : (
            <button onClick={() => void startInterview()}>面接開始</button>
          )}
          <button
            onClick={() =>
              setAutoJudgeEnabled((value) => {
                const next = !value
                console.log(
                  `[auto-judge] 自動判定: ${next ? 'ON（沈黙2.5秒で発火）' : 'OFF'}`
                )
                return next
              })
            }
          >
            自動判定: {autoJudgeEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        {faceLoopMessage ? <div style={styles.faceLoopMessage}>{faceLoopMessage}</div> : null}
        {voiceLoopMessage ? <div style={styles.sttMessage}>{voiceLoopMessage}</div> : null}
        {sttMessage ? <div style={styles.sttMessage}>{sttMessage}</div> : null}
        {interviewerSttMessage ? (
          <div style={styles.sttMessage}>{interviewerSttMessage}</div>
        ) : null}
        {auto.judging || auto.score !== null ? (
          <div style={styles.llmResult}>
            LLM判定: {auto.judging ? '判定中…' : `${auto.score}点${auto.reason ? ` — ${auto.reason}` : ''}`}
          </div>
        ) : null}
      </div>
      {manualFaceDialogRequest ? (
        <ManualFaceRegionDialog
          rawFrameDataUrl={manualFaceDialogRequest.rawFrameDataUrl}
          sourceWidth={manualFaceDialogRequest.sourceWidth}
          sourceHeight={manualFaceDialogRequest.sourceHeight}
          onConfirm={(rect) => void handleManualFaceRegionConfirm(rect)}
          onCancel={handleManualFaceRegionCancel}
        />
      ) : null}
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
  llmResult: {
    color: '#ffffff',
    fontFamily: 'sans-serif',
    fontSize: '13px',
    maxWidth: '720px',
    overflowWrap: 'anywhere'
  }
}
