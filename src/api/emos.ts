import { HTTPError } from 'ky'
import { emos } from '@/utils/ky'
import type { PlaybackCodec } from '@/utils/media-codecs'
import type { MediaDetail, MediaSource, PlaybackManifest, PlaybackProgressPayload, RandomReelResponse, ReelInfo, UserBase } from '@/api/types'

interface MediaDetailResponse {
  page: number
  page_size: number
  total: number
  items: MediaDetail[]
}

interface ErrorResponse {
  message?: unknown
}

export class PlaybackManifestError extends Error {
  readonly status: number | undefined
  readonly responseMessage: string | undefined

  constructor(status: number | undefined, responseMessage?: string) {
    super(responseMessage || 'Playback manifest request failed')
    this.name = 'PlaybackManifestError'
    this.status = status
    this.responseMessage = responseMessage
  }
}

export function getErrorStatus(error: unknown): number | undefined {
  return error instanceof HTTPError ? error.response.status : undefined
}

export async function getRandomReel(): Promise<RandomReelResponse> {
  return emos.get('api/reel/rand').json<RandomReelResponse>()
}

export async function getReelInfo(forgeReelUuid: string): Promise<ReelInfo> {
  return emos.get(`api/reel/info/${encodeURIComponent(forgeReelUuid)}`).json<ReelInfo>()
}

export async function getUserBase(): Promise<UserBase> {
  return emos.get('api/user/base').json<UserBase>()
}

export async function getMediaSources(videoListId: string | number, filters: { seasonNumber?: number; episodeNumber?: number; partNumber?: number } = {}): Promise<MediaSource[]> {
  const searchParams: Record<string, string> = { video_list_id: String(videoListId) }
  if (filters.seasonNumber != null) searchParams.season_number = String(filters.seasonNumber)
  if (filters.episodeNumber != null) searchParams.episode_number = String(filters.episodeNumber)
  if (filters.partNumber != null) searchParams.part_number = String(filters.partNumber)
  return emos.get('api/reel/media', { searchParams }).json<MediaSource[]>()
}

export async function getMediaDetails(mediaId: string): Promise<MediaDetail[]> {
  const response = await emos.get('api/video/media/listAll', { searchParams: { media_id: mediaId } }).json<MediaDetailResponse>()
  return response.items
}

export async function getPlaybackManifest(mediaId: string, codecs: readonly PlaybackCodec[]): Promise<PlaybackManifest> {
  try {
    const response = await emos.post('api/reel/manifest', {
      json: { media_id: mediaId, codecs },
    })
    if (response.status !== 200) throw new PlaybackManifestError(response.status)
    return await response.json<PlaybackManifest>()
  } catch (error) {
    if (error instanceof PlaybackManifestError) throw error
    if (!(error instanceof HTTPError)) throw new PlaybackManifestError(undefined)
    const payload = await error.response
      .clone()
      .json<ErrorResponse>()
      .catch(() => undefined)
    const responseMessage = typeof payload?.message === 'string' ? payload.message : undefined
    throw new PlaybackManifestError(error.response.status, responseMessage)
  }
}

export async function updatePlaybackProgress(payload: PlaybackProgressPayload, keepalive = false): Promise<void> {
  await emos.post('api/reel/progress', { json: payload, keepalive })
}
