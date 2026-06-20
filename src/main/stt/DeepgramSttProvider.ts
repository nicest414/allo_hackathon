import type { TranscriptSegment } from '../../shared/types/analysis'
import type { SttStartRequest } from '../../shared/types/ipc'
import { isSttDebug } from '../env'
import type { SttProvider, SttTranscriptListener } from './SttProvider'

const DEEPGRAM_WS_BASE = 'wss://api.deepgram.com/v1/listen'
// 無音時のアイドル切断を防ぐためのKeepAlive送信間隔。
const KEEPALIVE_INTERVAL_MS = 8_000

/**
 * Deepgram streaming STTの実装。Node 22のglobal WebSocketで接続する（依存追加なし）。
 * 認証はDeepgramのサブプロトコル方式（['token', apiKey]）を使う。
 *
 * punctuate=false / smart_format=false に加え filler_words=true で「えっと」等の
 * フィラーを整形・除去させず、生に近い文字起こしを得る（フィラー検出の入力源にするため）。
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
      punctuate: 'false',
      smart_format: 'false',
      // Deepgramは既定でフィラー(uh/um/えっと等)を除去するため、明示的に保持する。
      filler_words: 'true'
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

    const isFinal = Boolean(message.is_final)

    // STT_DEBUG時のみ生transcriptをstderrへ。フィラーが実際にどう返るかの確認用（キーは出さない）。
    if (isSttDebug()) {
      console.error(`[stt:debug] (${isFinal ? 'final' : 'interim'}) "${text}"`)
    }

    const segment: TranscriptSegment = {
      timestamp: Date.now(),
      text,
      isFinal
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
