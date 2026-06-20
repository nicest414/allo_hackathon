import type { TranscriptSegment } from '../../shared/types/analysis'
import type { SttStartRequest } from '../../shared/types/ipc'
import type { SttProvider, SttTranscriptListener } from './SttProvider'

const INTERIM_DELAY_MS = 400
const FINAL_DELAY_MS = 900

/**
 * 実STT APIを呼ばずダミーのtranscriptを流すフォールバック実装。
 * DEEPGRAM_API_KEY 未設定 / STT_FAKE=1 のときに createSttProvider が選ぶ。
 *
 * interim→final の順に、フィラー（「えっと」）を含む日本語を流すことで、
 * フィラー検出→優勢度ストア反映までのパイプライン全体を無キーで確認できるようにする。
 */
export class DummySttProvider implements SttProvider {
  private readonly listeners = new Set<SttTranscriptListener>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  async start(_request: SttStartRequest): Promise<void> {
    // 話し始め（interim）
    this.schedule(INTERIM_DELAY_MS, {
      timestamp: Date.now(),
      text: 'えっと',
      isFinal: false
    })
    // 確定（final・フィラーを含む）
    this.schedule(FINAL_DELAY_MS, {
      timestamp: Date.now(),
      text: 'えっと、私の強みは課題解決力です',
      isFinal: true
    })
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  async sendAudioChunk(_chunk: ArrayBuffer): Promise<void> {
    // ダミーでは音声は使わない
  }

  onTranscript(listener: SttTranscriptListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private schedule(delayMs: number, segment: TranscriptSegment): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      for (const listener of this.listeners) {
        listener(segment)
      }
    }, delayMs)
    this.timers.add(timer)
  }
}
