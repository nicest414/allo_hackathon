// AudioWorklet プロセッサ（音声スレッドで動作）。
// chunkSampleCount 分たまるごとに Float32 チャンクをメインスレッドへ postMessage する。
// メインスレッドの負荷（MediaPipe 顔解析・React 再描画等）に影響されず音声を取りこぼさないことが目的。
// ※ このファイルは Vite のアセットURL（new URL(..., import.meta.url)）として読み込まれ、
//   バンドルされず同一オリジンから配信されるため CSP(script-src 'self') を満たす。
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const requested = options && options.processorOptions && options.processorOptions.chunkSampleCount
    this.chunkSampleCount = typeof requested === 'number' && requested > 0 ? requested : 2048
    this.buffer = new Float32Array(this.chunkSampleCount)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]

    if (channel) {
      let offset = 0
      while (offset < channel.length) {
        const need = this.chunkSampleCount - this.filled
        const take = Math.min(need, channel.length - offset)
        this.buffer.set(channel.subarray(offset, offset + take), this.filled)
        this.filled += take
        offset += take

        if (this.filled === this.chunkSampleCount) {
          const out = this.buffer.slice(0)
          // transferable で渡してコピーコストを避ける
          this.port.postMessage(out, [out.buffer])
          this.filled = 0
        }
      }
    }

    return true
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
