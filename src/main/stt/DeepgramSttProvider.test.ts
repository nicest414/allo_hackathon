import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment } from '../../shared/types/analysis'
import { DeepgramSttProvider } from './DeepgramSttProvider'

type Listener = (event: { data?: unknown }) => void

/** Deepgram接続を模した最小のWebSocketスタブ。 */
class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = 0 // CONNECTING
  sent: Array<string | ArrayBuffer> = []
  closed = false
  private readonly listeners: Record<string, Listener[]> = {}

  constructor(
    public url: string,
    public protocols?: string | string[]
  ) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    ;(this.listeners[type] ??= []).push(listener)
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = 3
    this.emit('close', {})
  }

  // --- テスト操作用 ---
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', {})
  }

  emitMessage(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) })
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event)
    }
  }
}

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1)
  if (!socket) {
    throw new Error('WebSocket が生成されていません')
  }
  return socket
}

describe('DeepgramSttProvider', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('フィラー保持・文末検出パラメータとトークン認証で接続する', async () => {
    const provider = new DeepgramSttProvider('test-key')
    await provider.start({ sampleRate: 48000, language: 'ja', speaker: 'candidate' })

    const ws = lastSocket()
    expect(ws.url).toContain('wss://api.deepgram.com/v1/listen')
    expect(ws.url).toContain('language=ja')
    expect(ws.url).toContain('encoding=linear16')
    expect(ws.url).toContain('sample_rate=48000')
    // 句読点はONにしつつ filler_words でフィラーを残す
    expect(ws.url).toContain('punctuate=true')
    expect(ws.url).toContain('smart_format=false')
    expect(ws.url).toContain('filler_words=true')
    // 文末検出の安定化
    expect(ws.url).toContain('endpointing=300')
    expect(ws.url).toContain('utterance_end_ms=1000')
    expect(ws.protocols).toEqual(['token', 'test-key'])
  })

  it('Resultsメッセージを interim/final の TranscriptSegment として emit する', async () => {
    const provider = new DeepgramSttProvider('k')
    const received: TranscriptSegment[] = []
    provider.onTranscript((segment) => received.push(segment))

    await provider.start({ sampleRate: 16000, speaker: 'candidate' })
    const ws = lastSocket()
    ws.emitOpen()

    ws.emitMessage({
      type: 'Results',
      is_final: false,
      channel: { alternatives: [{ transcript: 'えっと' }] }
    })
    ws.emitMessage({
      type: 'Results',
      is_final: true,
      channel: { alternatives: [{ transcript: 'えっと、強みは課題解決力です' }] }
    })

    expect(received).toHaveLength(2)
    expect(received[0]).toMatchObject({ text: 'えっと', isFinal: false })
    expect(received[1]).toMatchObject({ text: 'えっと、強みは課題解決力です', isFinal: true })
  })

  it('空transcriptやMetadataは無視する', async () => {
    const provider = new DeepgramSttProvider('k')
    const received: TranscriptSegment[] = []
    provider.onTranscript((segment) => received.push(segment))

    await provider.start({ sampleRate: 16000, speaker: 'candidate' })
    const ws = lastSocket()
    ws.emitOpen()

    ws.emitMessage({ type: 'Metadata' })
    ws.emitMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: '' }] } })

    expect(received).toHaveLength(0)
  })

  it('接続確立前のchunkはキューに退避し、open後に送信する', async () => {
    const provider = new DeepgramSttProvider('k')
    await provider.start({ sampleRate: 16000, speaker: 'candidate' })
    const ws = lastSocket()

    const chunk = new ArrayBuffer(8)
    await provider.sendAudioChunk(chunk) // まだCONNECTING
    expect(ws.sent).toHaveLength(0)

    ws.emitOpen()
    expect(ws.sent).toContain(chunk)
  })

  it('open後のchunkは即送信する', async () => {
    const provider = new DeepgramSttProvider('k')
    await provider.start({ sampleRate: 16000, speaker: 'candidate' })
    const ws = lastSocket()
    ws.emitOpen()

    const chunk = new ArrayBuffer(4)
    await provider.sendAudioChunk(chunk)
    expect(ws.sent).toContain(chunk)
  })

  it('stop で CloseStream を送って切断する', async () => {
    const provider = new DeepgramSttProvider('k')
    await provider.start({ sampleRate: 16000, speaker: 'candidate' })
    const ws = lastSocket()
    ws.emitOpen()

    await provider.stop()
    expect(ws.sent).toContain(JSON.stringify({ type: 'CloseStream' }))
    expect(ws.closed).toBe(true)
  })
})
