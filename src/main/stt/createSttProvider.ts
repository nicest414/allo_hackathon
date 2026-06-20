import { getDeepgramApiKey, getSttProvider, isSttFake } from '../env'
import { DeepgramSttProvider } from './DeepgramSttProvider'
import { DummySttProvider } from './DummySttProvider'
import { GeminiLiveSttProvider } from './GeminiLiveSttProvider'
import type { SttProvider } from './SttProvider'

/**
 * .envのSTT_PROVIDERに応じてSttProviderの実体を選ぶファクトリ。
 *
 * 実APIキーが無い / STT_FAKE=1 のときは DummySttProvider にフォールバックし、
 * キー無し・オフライン・CIでもパイプライン全体を確認できるようにする（LLMのstub/fakeに対応）。
 */
export function createSttProvider(): SttProvider {
  const providerName = getSttProvider()

  if (isSttFake()) {
    console.info('[stt] mode: FAKE（ダミーtranscript・実API非接続）')
    return new DummySttProvider()
  }

  switch (providerName) {
    case 'deepgram': {
      const apiKey = getDeepgramApiKey()
      if (!apiKey) {
        console.info('[stt] mode: DUMMY（DEEPGRAM_API_KEY 未設定のためダミーtranscript）')
        return new DummySttProvider()
      }
      console.info('[stt] mode: LIVE（Deepgram streaming）')
      return new DeepgramSttProvider(apiKey)
    }
    case 'gemini_live':
      // Gemini Live STT は未実装（ダミー据え置き・別issue）
      return new GeminiLiveSttProvider()
  }
}
