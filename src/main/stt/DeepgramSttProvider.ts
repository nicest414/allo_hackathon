import type { TranscriptSegment } from '../../shared/types/analysis'
import type { SttStartRequest } from '../../shared/types/ipc'
import type { SttProvider, SttTranscriptListener } from './SttProvider'

const DUMMY_TRANSCRIPT_DELAY_MS = 500

/**
 * Deepgram streaming STTのスタブ実装。実APIへの接続は行わず、
 * start()後にダミーのtranscriptを1件流してIPCの流れを確認できるようにする。
 */
export class DeepgramSttProvider implements SttProvider {
  private readonly listeners = new Set<SttTranscriptListener>()
  private dummyTimer: ReturnType<typeof setTimeout> | undefined

  async start(_request: SttStartRequest): Promise<void> {
    this.dummyTimer = setTimeout(() => this.emitDummyTranscript(), DUMMY_TRANSCRIPT_DELAY_MS)
  }

  async stop(): Promise<void> {
    if (this.dummyTimer) {
      clearTimeout(this.dummyTimer)
      this.dummyTimer = undefined
    }
  }

  async sendAudioChunk(_chunk: ArrayBuffer): Promise<void> {
    // 実APIへのstreaming音声送信は別issueで実装する
  }

  onTranscript(listener: SttTranscriptListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emitDummyTranscript(): void {
    const segment: TranscriptSegment = {
      timestamp: Date.now(),
      text: '（Deepgramスタブ）ダミーの文字起こしです',
      isFinal: true
    }

    for (const listener of this.listeners) {
      listener(segment)
    }
  }
}
