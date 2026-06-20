import { ipcMain } from 'electron'
import type { LlmJudgeResponseRequest, LlmJudgeResponseResult } from '../../shared/types/ipc'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { createStubJudgment, judgeResponse } from '../llm/geminiJudgeClient'

/**
 * LLM判定用のipcMainハンドラを登録する。
 * renderer → main の「この返答を判定して」という依頼を受け、結果だけを返す。
 * APIキーはmain側（geminiJudgeClient）でのみ参照し、rendererには渡さない。
 */
export function registerLlmIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.llmJudgeResponse,
    async (_event, request: LlmJudgeResponseRequest): Promise<LlmJudgeResponseResult> => {
      try {
        return await judgeResponse(request)
      } catch (error) {
        // 判定失敗でUIを止めないよう、理由付きの中立スコアにフォールバックする
        const message = error instanceof Error ? error.message : String(error)
        return createStubJudgment(`判定に失敗しました: ${message}`)
      }
    }
  )
}

/**
 * ハンドラを解除する（ウィンドウ再生成やテスト時のクリーンアップ用）。
 */
export function unregisterLlmIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.llmJudgeResponse)
}
