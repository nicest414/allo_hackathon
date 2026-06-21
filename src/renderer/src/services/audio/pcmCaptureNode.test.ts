import { describe, expect, it, vi } from 'vitest'
import { createPcmCaptureNode } from './pcmCaptureNode'

// テスト環境(node)では AudioWorkletNode が未定義のため、createPcmCaptureNode は
// 自動的に ScriptProcessorNode フォールバックを使う。その蓄積・チャンク化を検証する。

function createFakeContext(): {
  context: AudioContext
  processor: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onaudioprocess: ((event: AudioProcessingEvent) => void) | null }
  emit: (samples: Float32Array) => void
} {
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null
  }
  const context = {
    audioWorklet: undefined,
    createScriptProcessor: vi.fn(() => processor)
  } as unknown as AudioContext

  return {
    context,
    processor,
    emit: (samples) => {
      processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => samples }
      } as unknown as AudioProcessingEvent)
    }
  }
}

describe('createPcmCaptureNode (ScriptProcessor fallback)', () => {
  it('chunkSampleCount ごとに蓄積してチャンクを切り出す', async () => {
    const fake = createFakeContext()
    const chunks: Float32Array[] = []

    const capture = await createPcmCaptureNode(fake.context, {
      chunkSampleCount: 4,
      onChunk: (samples) => chunks.push(samples)
    })

    fake.emit(new Float32Array([0.1, 0.2]))
    expect(chunks).toHaveLength(0) // まだ4サンプル未満

    fake.emit(new Float32Array([0.3, 0.4, 0.5]))
    expect(chunks).toHaveLength(1) // 4サンプル到達で1チャンク
    expect(chunks[0]).toHaveLength(4)
    expect(chunks[0][0]).toBeCloseTo(0.1)
    expect(chunks[0][3]).toBeCloseTo(0.4)

    expect(capture.node).toBe(fake.processor as unknown as AudioNode)
  })

  it('dispose でコールバック解除と切断を行う', async () => {
    const fake = createFakeContext()
    const capture = await createPcmCaptureNode(fake.context, {
      chunkSampleCount: 4,
      onChunk: vi.fn()
    })

    capture.dispose()

    expect(fake.processor.onaudioprocess).toBeNull()
    expect(fake.processor.disconnect).toHaveBeenCalledOnce()
  })
})
