import electron from 'electron'
import type { SourcesOptions } from 'electron'
import type {
  DesktopCaptureSource,
  DesktopCaptureSourcesRequest
} from '../../shared/types/capture'

const { desktopCapturer } = electron

const DEFAULT_THUMBNAIL_SIZE = { width: 320, height: 180 } as const

export async function listDesktopSources(
  request: DesktopCaptureSourcesRequest = {}
): Promise<DesktopCaptureSource[]> {
  try {
    const sources = await desktopCapturer.getSources(toSourcesOptions(request))

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id || undefined,
      thumbnailDataUrl: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
      appIconDataUrl:
        source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined
    }))
  } catch (error) {
    console.error('Failed to get desktop sources. Screen recording permission might be missing:', error)
    return []
  }
}

function toSourcesOptions(request: DesktopCaptureSourcesRequest): SourcesOptions {
  return {
    types: request.types ?? ['screen', 'window'],
    thumbnailSize: request.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE,
    fetchWindowIcons: true
  }
}
