import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import './OverlayRoot.css'
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
import { roundScore } from '../../domain/scoring/scoreUtils'
import { useDominanceStore } from '../../store/useDominanceStore'
import { DominanceClashBanner } from './DominanceClashBanner'
import { ManualFaceRegionDialog } from './ManualFaceRegionDialog'
import { useInitialCandidatePortraitImage } from './useInitialCandidatePortraitImage'
import { useAutoResponseJudge } from '../../hooks/useAutoResponseJudge'
import {
  buildCursorTransparencyMaskStyle,
  type CursorPosition
} from './cursorTransparencyMask'

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
  const overlayRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return faceAnalysisLoop.onAnalysisResult((subject, result) => {
      if (subject === 'candidate') {
        candidateFaceDebugRef.current = result
      } else {
        interviewerFaceDebugRef.current = result
      }
    })
  }, [])

  useEffect(() => {
    let isDisposed = false
    let isClickThroughEnabled = true
    const applyCursorMask = (
      element: HTMLElement,
      cursorPosition: CursorPosition | null
    ): void => {
      if (cursorPosition === null) {
        element.style.removeProperty('mask-image')
        element.style.removeProperty('-webkit-mask-image')
        element.style.removeProperty('mask-mode')
        element.style.removeProperty('mask-repeat')
        element.style.removeProperty('-webkit-mask-repeat')
        element.style.removeProperty('mask-size')
        element.style.removeProperty('-webkit-mask-size')
        return
      }

      const bounds = element.getBoundingClientRect()
      const maskStyle = buildCursorTransparencyMaskStyle({
        x: cursorPosition.x - bounds.left,
        y: cursorPosition.y - bounds.top
      })
      const maskImage = maskStyle.maskImage?.toString() ?? ''
      element.style.setProperty('mask-image', maskImage)
      element.style.setProperty('-webkit-mask-image', maskImage)
      element.style.setProperty('mask-mode', 'alpha')
      element.style.setProperty('mask-repeat', 'no-repeat')
      element.style.setProperty('-webkit-mask-repeat', 'no-repeat')
      element.style.setProperty('mask-size', '100% 100%')
      element.style.setProperty('-webkit-mask-size', '100% 100%')
    }

    const applyCursorMasks = (cursorPosition: CursorPosition | null): void => {
      const rootElement = overlayRootRef.current
      if (!rootElement) {
        return
      }

      for (const element of rootElement.querySelectorAll<HTMLElement>(
        '[data-cursor-transparent-mask]'
      )) {
        applyCursorMask(element, cursorPosition)
      }
    }

    const shouldCaptureClickAtCursor = (cursorPosition: CursorPosition | null): boolean => {
      if (cursorPosition === null) {
        return false
      }

      const interactiveElements = document.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [role="button"], [data-overlay-control]'
      )
      for (const element of interactiveElements) {
        const bounds = element.getBoundingClientRect()
        const isInside =
          cursorPosition.x >= bounds.left &&
          cursorPosition.x <= bounds.right &&
          cursorPosition.y >= bounds.top &&
          cursorPosition.y <= bounds.bottom
        if (isInside) {
          return true
        }
      }

      return false
    }

    const updateClickThrough = (enabled: boolean): void => {
      if (enabled === isClickThroughEnabled) {
        return
      }

      isClickThroughEnabled = enabled
      void window.allo.overlay.setClickThrough({ enabled })
    }

    const updateCursorPosition = async (): Promise<void> => {
      const cursorPosition = await window.allo.overlay.getCursorPosition()
      if (!isDisposed) {
        applyCursorMasks(cursorPosition)
        updateClickThrough(!shouldCaptureClickAtCursor(cursorPosition))
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
      updateClickThrough(true)
    }
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

  const clampedDominance = roundScore(baseDominance)
  const dominanceLeadingSide =
    clampedDominance === 50 ? 'neutral' : clampedDominance > 50 ? 'left' : 'right'
  const hasStatusMessage =
    faceLoopMessage !== '' ||
    voiceLoopMessage !== '' ||
    sttMessage !== '' ||
    interviewerSttMessage !== ''

  return (
    <div ref={overlayRootRef} className="overlay-root">
      <DominanceClashBanner
        value={baseDominance}
        candidatePortraitSrc={candidatePortraitImageUrl}
        interviewerPortraitSrc={interviewerPortraitImageUrl}
      />
      <div className="overlay-panel">
        <div className={`overlay-panel__dominance overlay-panel__dominance--${dominanceLeadingSide}`}>
          <span>優勢度</span>
          <span className="overlay-panel__dominance-value">{clampedDominance}</span>
        </div>
        <div className="overlay-panel__controls" data-overlay-control>
          <button className="overlay-button" onClick={() => void loadScreenSources()}>
            画面取得
          </button>
          {screenAccessDenied ? (
            <button
              className="overlay-button overlay-button--warning"
              onClick={() => void openScreenSettings()}
            >
              許可設定を開く
            </button>
          ) : null}
          <select
            className="overlay-select"
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
          <button className="overlay-button" onClick={() => void retakeCandidateAndInterviewerPortraits()}>
            顔写真再取得
          </button>
          {interviewerManualFaceRect !== undefined ? (
            <button className="overlay-button" onClick={() => setInterviewerManualFaceRect(undefined)}>
              顔の範囲を再指定
            </button>
          ) : null}
          {isInterviewRunning ? (
            <button className="overlay-button overlay-button--stop" onClick={() => void stopInterview()}>
              面接終了
            </button>
          ) : (
            <button className="overlay-button overlay-button--primary" onClick={() => void startInterview()}>
              面接開始
            </button>
          )}
          <button
            className={`overlay-button overlay-button--toggle${autoJudgeEnabled ? ' is-active' : ''}`}
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
        {hasStatusMessage ? (
          <div className="overlay-panel__messages">
            {faceLoopMessage ? <div className="overlay-message">{faceLoopMessage}</div> : null}
            {voiceLoopMessage ? <div className="overlay-message">{voiceLoopMessage}</div> : null}
            {sttMessage ? <div className="overlay-message">{sttMessage}</div> : null}
            {interviewerSttMessage ? (
              <div className="overlay-message">{interviewerSttMessage}</div>
            ) : null}
          </div>
        ) : null}
        {auto.judging || auto.score !== null ? (
          <div className={`overlay-judge${auto.judging ? ' overlay-judge--pending' : ''}`}>
            {auto.judging ? (
              'LLM判定: 判定中…'
            ) : (
              <>
                LLM判定: <span className="overlay-judge__score">{auto.score}点</span>
                {auto.reason ? ` — ${auto.reason}` : ''}
              </>
            )}
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
