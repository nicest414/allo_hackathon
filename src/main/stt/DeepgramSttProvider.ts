import type { TranscriptSegment } from '../../shared/types/analysis'
import type { SttStartRequest } from '../../shared/types/ipc'
import type { SttProvider, SttTranscriptListener } from './SttProvider'

const DEEPGRAM_WS_BASE = 'wss://api.deepgram.com/v1/listen'
// 無音時のアイドル切断を防ぐためのKeepAlive送信間隔。
const KEEPALIVE_INTERVAL_MS = 8_000

/**
 * Deepgram streaming STTの実装。Node 22のglobal WebSocketで接続する（依存追加なし）。
 * 認証はDeepgramのサブプロトコル方式（['token', apiKey]）を使う。
 *
 * punctuate=true で読点を入れて可読性とLLM判定の質を上げつつ、filler_words=true で
 * 「えっと」等のフィラーを残す（フィラー検出の入力源にするため）。smart_format=false は
 * 数値・日付の整形でテキストが変質するのを避けるため維持する。
 * endpointing / utterance_end_ms で文末検出を安定させ、finalセグメントの細切れを減らす。
 * 接続確立前に届いた音声chunkはキューに退避し、open後にまとめて送る。
 */
export class DeepgramSttProvider implements SttProvider {
  private readonly listeners = new Set<SttTranscriptListener>()
  private readonly pendingChunks: ArrayBuffer[] = []
  private ws: WebSocket | undefined
  private open = false
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly apiKey: string) {}

  async start(request: SttStartRequest): Promise<void> {
    const params = new URLSearchParams({
      model: 'nova-2',
      language: request.language ?? 'ja',
      encoding: 'linear16',
      sample_rate: String(request.sampleRate),
      channels: '1',
      interim_results: 'true',
      // 可読性とLLM判定の質のため句読点はON。フィラーは filler_words=true で残す。
      punctuate: 'true',
      smart_format: 'false',
      filler_words: 'true',
      // 文末検出を安定させ、finalセグメントの細切れ・誤確定を減らす。
      endpointing: '300',
      utterance_end_ms: '1000',
      vad_events: 'true'
    })

    const ws = new WebSocket(`${DEEPGRAM_WS_BASE}?${params.toString()}`, ['token', this.apiKey])
    this.ws = ws

    ws.addEventListener('open', () => {
      this.open = true
      this.flushPendingChunks()
      this.startKeepAlive()
    })
    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(event.data)
    })
    ws.addEventListener('error', () => {
      // 接続エラーでlistenerを壊さない。鍵やヘッダはログに出さない。
      console.warn('[stt] Deepgram WebSocket error')
    })
    ws.addEventListener('close', () => {
      this.open = false
      this.stopKeepAlive()
    })
  }

  async stop(): Promise<void> {
    this.stopKeepAlive()
    this.pendingChunks.length = 0

    const ws = this.ws
    this.ws = undefined
    this.open = false

    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'CloseStream' }))
        } catch {
          // 送信失敗は無視してcloseに進む
        }
      }
      ws.close()
    }
  }

  async sendAudioChunk(chunk: ArrayBuffer): Promise<void> {
    if (this.ws && this.open && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
    } else {
      // 接続確立前のchunkは退避し、open後に順序を保って送る。
      this.pendingChunks.push(chunk)
    }
  }

  onTranscript(listener: SttTranscriptListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private flushPendingChunks(): void {
    if (!this.ws) {
      return
    }
    for (const chunk of this.pendingChunks) {
      this.ws.send(chunk)
    }
    this.pendingChunks.length = 0
  }

  private startKeepAlive(): void {
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      if (this.ws && this.open && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, KEEPALIVE_INTERVAL_MS)
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = undefined
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      return
    }

    let message: DeepgramMessage
    try {
      message = JSON.parse(data) as DeepgramMessage
    } catch {
      return
    }

    // Results以外（Metadata / UtteranceEnd 等）は無視する
    if (message.type !== undefined && message.type !== 'Results') {
      return
    }

    const text = message.channel?.alternatives?.[0]?.transcript
    if (!text) {
      return
    }

    const segment: TranscriptSegment = {
      timestamp: Date.now(),
      text,
      isFinal: Boolean(message.is_final)
    }

    for (const listener of this.listeners) {
      listener(segment)
    }
  }
}

interface DeepgramMessage {
  type?: string
  is_final?: boolean
  channel?: {
    alternatives?: Array<{ transcript?: string }>
  }
}
