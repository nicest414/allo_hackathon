import { getSttProvider } from '../env'
import { DeepgramSttProvider } from './DeepgramSttProvider'
import { GeminiLiveSttProvider } from './GeminiLiveSttProvider'
import type { SttProvider } from './SttProvider'

/** .envのSTT_PROVIDERに応じてSttProviderの実体を選ぶファクトリ */
export function createSttProvider(): SttProvider {
  const providerName = getSttProvider()

  switch (providerName) {
    case 'deepgram':
      return new DeepgramSttProvider()
    case 'gemini_live':
      return new GeminiLiveSttProvider()
  }
}
