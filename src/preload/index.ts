import electron from 'electron'
import type {
  AlloPreloadApi,
  CaptureDesktopSourcesResult,
  LlmJudgeResponseResult,
  ScreenAccessStatus,
  SttTranscriptEvent
} from '../shared/types/ipc'
import { IPC_CHANNELS } from '../shared/types/ipc'

const { contextBridge, ipcRenderer } = electron

const api: AlloPreloadApi = {
  stt: {
    start: async (request) => {
      await ipcRenderer.invoke(IPC_CHANNELS.sttStart, request)
    },
    stop: async () => {
      await ipcRenderer.invoke(IPC_CHANNELS.sttStop)
    },
    sendAudioChunk: async (request) => {
      await ipcRenderer.invoke(IPC_CHANNELS.sttAudioChunk, request)
    },
    onTranscript: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SttTranscriptEvent): void => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.sttTranscript, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.sttTranscript, handler)
      }
    }
  },
  llm: {
    judgeResponse: async (request) => {
      return ipcRenderer.invoke(
        IPC_CHANNELS.llmJudgeResponse,
        request
      ) as Promise<LlmJudgeResponseResult>
    }
  },
  capture: {
    listDesktopSources: async (request) => {
      return ipcRenderer.invoke(
        IPC_CHANNELS.captureDesktopSources,
        request
      ) as Promise<CaptureDesktopSourcesResult>
    },
    getScreenAccessStatus: async () => {
      return ipcRenderer.invoke(
        IPC_CHANNELS.captureScreenAccessStatus
      ) as Promise<ScreenAccessStatus>
    },
    openScreenSettings: async () => {
      await ipcRenderer.invoke(IPC_CHANNELS.captureOpenScreenSettings)
    },
    enableLoopbackAudio: async () => {
      await ipcRenderer.invoke(IPC_CHANNELS.captureEnableLoopbackAudio)
    },
    disableLoopbackAudio: async () => {
      await ipcRenderer.invoke(IPC_CHANNELS.captureDisableLoopbackAudio)
    }
  },
  overlay: {
    setClickThrough: async (request) => {
      await ipcRenderer.invoke(IPC_CHANNELS.overlaySetClickThrough, request)
    }
  }
}

contextBridge.exposeInMainWorld('allo', api)
