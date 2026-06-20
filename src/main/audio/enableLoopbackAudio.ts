export type LoopbackAudioStatus = 'enabled' | 'unsupported-platform' | 'unavailable' | 'error'

export interface LoopbackAudioResult {
  status: LoopbackAudioStatus
  message: string
}

interface LoopbackAudioModule {
  initMain: () => void
}

// 文字列リテラルのままimport()すると、tscのモジュール解決とRollup(electron-vite)の
// 静的解析が未インストールのelectron-audio-loopbackを解決しようとして失敗する。
// 変数経由にすることで両者の静的解析対象から外し、実行時にのみ存在確認する。
const LOOPBACK_MODULE_SPECIFIER: string = 'electron-audio-loopback'

const SUPPORTED_PLATFORMS: readonly NodeJS.Platform[] = ['darwin']

/**
 * 面接官側の出力音声（Web会議アプリの音）をループバックキャプチャ可能にする入口。
 * README記載の通りScreenCaptureKit前提のためmacOS専用。未対応OSやライブラリ未導入の場合も
 * 例外を投げず、ステータス付きの結果を返すことで呼び出し元がログ等で扱えるようにする。
 *
 * 実ライブラリ導入後は、initMain()がElectronのreadyイベント前の呼び出しを要求するため、
 * 呼び出し元（main/index.ts）はapp.whenReady()より前に本関数を呼ぶこと。
 */
export async function enableLoopbackAudio(): Promise<LoopbackAudioResult> {
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) {
    return {
      status: 'unsupported-platform',
      message: `音声ループバックは${SUPPORTED_PLATFORMS.join(', ')}のみ対応しています（現在のOS: ${process.platform}）。Windows対応は別issueで扱う。`
    }
  }

  const loopbackModule = await loadLoopbackModule()

  if (!loopbackModule) {
    return {
      status: 'unavailable',
      message: `${LOOPBACK_MODULE_SPECIFIER}が未導入のため、音声ループバックを有効化できません。`
    }
  }

  try {
    loopbackModule.initMain()
    return {
      status: 'enabled',
      message: '面接官側の出力音声ループバックを有効化しました。'
    }
  } catch (error) {
    return {
      status: 'error',
      message: `音声ループバックの有効化に失敗しました: ${toErrorMessage(error)}`
    }
  }
}

async function loadLoopbackModule(): Promise<LoopbackAudioModule | undefined> {
  try {
    return (await import(LOOPBACK_MODULE_SPECIFIER)) as LoopbackAudioModule
  } catch {
    return undefined
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
