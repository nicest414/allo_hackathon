import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { SttProvider, SttTranscriptListener } from '../stt/SttProvider'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    },
    createSttProvider: vi.fn<() => SttProvider>()
  }
})

vi.mock('electron', () => ({
  default: {
    ipcMain: mocks.ipcMain
  }
}))

vi.mock('../stt/createSttProvider', () => ({
  createSttProvider: mocks.createSttProvider
}))

describe('registerSttIpc', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.handlers.clear()
    mocks.ipcMain.handle.mockClear()
    mocks.createSttProvider.mockReset()
  })

  it('stops the active provider before replacing it on stt:start', async () => {
    const first = createProvider()
    const second = createProvider()
    mocks.createSttProvider.mockReturnValueOnce(first).mockReturnValueOnce(second)

    const { registerSttIpc } = await import('./sttIpc')
    registerSttIpc(() => null)

    const startHandler = getHandler(IPC_CHANNELS.sttStart)
    await startHandler(undefined, { sampleRate: 16000 })
    await startHandler(undefined, { sampleRate: 16000 })

    expect(first.stop).toHaveBeenCalledOnce()
    expect(first.unsubscribe).toHaveBeenCalledOnce()
    expect(second.start).toHaveBeenCalledOnce()
  })

  it('cleans up the newly created provider if start fails', async () => {
    const provider = createProvider()
    provider.start.mockRejectedValueOnce(new Error('start failed'))
    mocks.createSttProvider.mockReturnValueOnce(provider)

    const { registerSttIpc } = await import('./sttIpc')
    registerSttIpc(() => null)

    const startHandler = getHandler(IPC_CHANNELS.sttStart)
    await expect(startHandler(undefined, { sampleRate: 16000 })).rejects.toThrow('start failed')

    expect(provider.stop).toHaveBeenCalledOnce()
    expect(provider.unsubscribe).toHaveBeenCalledOnce()
  })
})

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) {
    throw new Error(`handler not registered: ${channel}`)
  }
  return handler
}

function createProvider(): SttProvider & {
  start: ReturnType<typeof vi.fn<SttProvider['start']>>
  stop: ReturnType<typeof vi.fn<SttProvider['stop']>>
  sendAudioChunk: ReturnType<typeof vi.fn<SttProvider['sendAudioChunk']>>
  unsubscribe: ReturnType<typeof vi.fn>
} {
  const unsubscribe = vi.fn()

  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    sendAudioChunk: vi.fn(async () => undefined),
    onTranscript: vi.fn((_listener: SttTranscriptListener) => unsubscribe),
    unsubscribe
  }
}
