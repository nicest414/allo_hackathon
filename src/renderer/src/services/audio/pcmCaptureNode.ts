// Vite の ?url インポート: worklet を「バンドルせず」アセットとして同一オリジンから配信する。
// これにより CSP(script-src 'self') を満たしつつ addModule で読み込める。
import workletModuleUrl from './pcmCaptureProcessor.js?url'

/**
 * 音声ストリームから一定サンプル数ごとに Float32 チャンクを切り出すノードを生成する。
 *
 * 優先して AudioWorklet（音声スレッド）を使い、メインスレッドの負荷で音を取りこぼさないようにする。
 * AudioWorklet が使えない/読み込みに失敗した環境では、従来の ScriptProcessorNode に
 * 自動フォールバックして機能を維持する（退行防止）。
 */
export interface PcmCaptureNode {
  /** source.connect(node) で音声を流し込むためのノード。 */
  readonly node: AudioNode
  /** ノードを破棄する（コールバック解除・切断）。 */
  dispose(): void
}

export interface PcmCaptureNodeOptions {
  chunkSampleCount: number
  onChunk: (samples: Float32Array) => void
}

export type CreatePcmCaptureNode = (
  audioContext: AudioContext,
  options: PcmCaptureNodeOptions
) => Promise<PcmCaptureNode>

const PROCESSOR_NAME = 'pcm-capture-processor'
const FALLBACK_BUFFER_SIZE = 4096

// AudioContext ごとに worklet モジュール登録済みかを記録する（addModule の二重登録を防ぐ）。
const workletReady = new WeakSet<BaseAudioContext>()

async function ensureWorkletModule(audioContext: AudioContext): Promise<void> {
  if (workletReady.has(audioContext)) {
    return
  }

  await audioContext.audioWorklet.addModule(workletModuleUrl)
  workletReady.add(audioContext)
}

export const createPcmCaptureNode: CreatePcmCaptureNode = async (audioContext, options) => {
  if (typeof AudioWorkletNode !== 'undefined' && audioContext.audioWorklet) {
    try {
      await ensureWorkletModule(audioContext)

      const node = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { chunkSampleCount: options.chunkSampleCount }
      })

      node.port.onmessage = (event: MessageEvent) => {
        options.onChunk(event.data as Float32Array)
      }

      return {
        node,
        dispose: () => {
          node.port.onmessage = null
          node.disconnect()
        }
      }
    } catch (error) {
      console.warn('[stt] AudioWorklet利用不可。ScriptProcessorにフォールバックします', error)
    }
  }

  return createScriptProcessorCaptureNode(audioContext, options)
}

function createScriptProcessorCaptureNode(
  audioContext: AudioContext,
  options: PcmCaptureNodeOptions
): PcmCaptureNode {
  const processor = audioContext.createScriptProcessor(FALLBACK_BUFFER_SIZE, 1, 1)
  let pending = new Float32Array(0)

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const input = event.inputBuffer.getChannelData(0)
    const combined = new Float32Array(pending.length + input.length)
    combined.set(pending)
    combined.set(input, pending.length)
    pending = combined

    while (pending.length >= options.chunkSampleCount) {
      options.onChunk(pending.slice(0, options.chunkSampleCount))
      pending = pending.slice(options.chunkSampleCount)
    }
  }

  return {
    node: processor,
    dispose: () => {
      processor.onaudioprocess = null
      processor.disconnect()
    }
  }
}
