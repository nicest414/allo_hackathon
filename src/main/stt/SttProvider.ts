import type { TranscriptSegment } from '../../shared/types/analysis'
import type { SttStartRequest } from '../../shared/types/ipc'

export type SttTranscriptListener = (segment: TranscriptSegment) => void

/**
 * STT実装の差し替えポイント。DeepgramSttProvider / GeminiLiveSttProviderが実装し、
 * createSttProvider.tsがSTT_PROVIDER環境変数で実体を選ぶ。
 */
export interface SttProvider {
  start(request: SttStartRequest): Promise<void>
  stop(): Promise<void>
  sendAudioChunk(chunk: ArrayBuffer): Promise<void>
  onTranscript(listener: SttTranscriptListener): () => void
}
