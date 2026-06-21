import { ipcMain } from 'electron'
import type { LlmJudgeResponseRequest, LlmJudgeResponseResult } from '../../shared/types/ipc'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { judgeResponse } from '../llm/geminiJudgeClient'

/**
 * LLM判定用のipcMainハンドラを登録する。
 * renderer → main の「この返答を判定して」という依頼を受け、結果だけを返す。
 * APIキーはmain側（geminiJudgeClient）でのみ参照し、rendererには渡さない。
 *
 * 判定失敗（HTTPエラー等）はここで握り潰さず例外のまま伝播させる。renderer側
 * （responseJudger）が catch して status: 'error' として扱い、中立スコアを
 * 優勢度に加算しないよう判断できるようにするため。
 */
export function registerLlmIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.llmJudgeResponse,
    (_event, request: LlmJudgeResponseRequest): Promise<LlmJudgeResponseResult> =>
      judgeResponse(request)
  )
}

/**
 * ハンドラを解除する（ウィンドウ再生成やテスト時のクリーンアップ用）。
 */
export function unregisterLlmIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.llmJudgeResponse)
}
