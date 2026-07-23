import { HTTPError } from 'ky'
import { StorageSerializers, useSessionStorage } from '@vueuse/core'
import { emos } from '@/utils/ky'
import type { PlaybackCodec } from '@/utils/media-codecs'
import type { ManifestSprite, ManifestSubtitle, MediaDetail, MediaSource, PlaybackManifest, PlaybackProgressPayload, RandomReelResponse, ReelInfo, UserBase } from '@/api/types'

interface MediaDetailResponse {
  page: number
  page_size: number
  total: number
  items: MediaDetail[]
}

interface ErrorResponse {
  message?: unknown
}

interface VideoIdLookupResponse {
  item_id: number | string
  todb_id: number | string
}

const videoIdByTodbIdCache = useSessionStorage<Record<number, number>>('emos_reel.emos.video_id_by_todb', {}, { serializer: StorageSerializers.object })
const todbIdByVideoIdCache = useSessionStorage<Record<number, number>>('emos_reel.emos.todb_id_by_video_id', {}, { serializer: StorageSerializers.object })
const videoIdByTodbIdRequests = new Map<number, Promise<number>>()
const todbIdByVideoIdRequests = new Map<number, Promise<number>>()

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

function parseLookupId(value: number | string, fieldName: keyof VideoIdLookupResponse) {
  const id = Number(value)
  if (!Number.isFinite(id) || id <= 0) throw new Error(`Invalid ${fieldName} lookup response`)
  return id
}

function cacheVideoIdLookup(todbId: number, videoId: number) {
  videoIdByTodbIdCache.value = { ...videoIdByTodbIdCache.value, [todbId]: videoId }
  todbIdByVideoIdCache.value = { ...todbIdByVideoIdCache.value, [videoId]: todbId }
}

async function lookupVideoId(videoIdType: 'todb' | 'video_id', videoIdValue: number): Promise<VideoIdLookupResponse> {
  return emos
    .get('api/video/getVideoId', {
      searchParams: {
        video_id_type: videoIdType,
        video_id_value: videoIdValue,
      },
    })
    .json<VideoIdLookupResponse>()
}

export async function getVideoIdByTodbId(todbVideoId: number): Promise<number> {
  if (videoIdByTodbIdCache.value[todbVideoId]) {
    const videoId = videoIdByTodbIdCache.value[todbVideoId]
    cacheVideoIdLookup(todbVideoId, videoId)
    return videoId
  }
  if (videoIdByTodbIdRequests.has(todbVideoId)) return videoIdByTodbIdRequests.get(todbVideoId)!

  const request = lookupVideoId('todb', todbVideoId)
    .then((response) => {
      const itemId = parseLookupId(response.item_id, 'item_id')
      const todbId = parseLookupId(response.todb_id, 'todb_id')
      cacheVideoIdLookup(todbId, itemId)
      return itemId
    })
    .finally(() => videoIdByTodbIdRequests.delete(todbVideoId))
  videoIdByTodbIdRequests.set(todbVideoId, request)
  return request
}

export async function getTodbIdByVideoId(emosVideoId: number): Promise<number> {
  if (todbIdByVideoIdCache.value[emosVideoId]) {
    const todbId = todbIdByVideoIdCache.value[emosVideoId]
    cacheVideoIdLookup(todbId, emosVideoId)
    return todbId
  }
  if (todbIdByVideoIdRequests.has(emosVideoId)) return todbIdByVideoIdRequests.get(emosVideoId)!

  const request = lookupVideoId('video_id', emosVideoId)
    .then((response) => {
      const itemId = parseLookupId(response.item_id, 'item_id')
      const todbId = parseLookupId(response.todb_id, 'todb_id')
      cacheVideoIdLookup(todbId, itemId)
      return todbId
    })
    .finally(() => todbIdByVideoIdRequests.delete(emosVideoId))
  todbIdByVideoIdRequests.set(emosVideoId, request)
  return request
}

export async function getUserBase(): Promise<UserBase> {
  return emos.get('api/user/base').json<UserBase>()
}

export async function getMediaSources(videoListId: number, filters: { seasonNumber?: number; episodeNumber?: number; partNumber?: number } = {}): Promise<MediaSource[]> {
  const searchParams: Record<string, string | number> = { video_list_id: videoListId }
  if (filters.seasonNumber != null) searchParams.season_number = filters.seasonNumber
  if (filters.episodeNumber != null) searchParams.episode_number = filters.episodeNumber
  if (filters.partNumber != null) searchParams.part_number = filters.partNumber
  return emos.get('api/reel/media', { searchParams }).json<MediaSource[]>()
}

export async function getMediaDetails(mediaId: string): Promise<MediaDetail[]> {
  const response = await emos.get('api/video/media/listAll', { searchParams: { media_id: mediaId, include_metadata: '1' } }).json<MediaDetailResponse>()
  return response.items
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseManifestSubtitles(value: unknown): ManifestSubtitle[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || !item.url) return []
    return [
      {
        type: typeof item.type === 'string' ? item.type : '',
        language: typeof item.language === 'string' ? item.language : undefined,
        title: typeof item.title === 'string' ? item.title : '',
        url: item.url,
      },
    ]
  })
}

function parseManifestSprites(value: unknown): ManifestSprite[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.base_url !== 'string' || !Array.isArray(item.frame_times) || !Array.isArray(item.files)) return []
    const frameTimes = item.frame_times.filter((time): time is number => typeof time === 'number' && Number.isFinite(time))
    const files = item.files.filter((file): file is string => typeof file === 'string' && Boolean(file))
    const width = Number(item.width)
    const height = Number(item.height)
    const columns = Number(item.columns)
    const rows = Number(item.rows)
    if (![width, height, columns, rows].every((number) => Number.isFinite(number) && number > 0) || !frameTimes.length || !files.length) return []
    return [
      {
        base_url: item.base_url,
        frame_times: frameTimes,
        width,
        height,
        columns,
        rows,
        count_frame: Number.isFinite(Number(item.count_frame)) ? Number(item.count_frame) : frameTimes.length,
        files,
      },
    ]
  })
}

function parsePlaybackManifest(raw: unknown): PlaybackManifest {
  if (!isRecord(raw) || !isRecord(raw.play_data)) {
    throw new PlaybackManifestError(undefined, '播放清单格式无效')
  }
  const normalized = {
    ...raw,
    media_name: typeof raw.media_name === 'string' ? raw.media_name : '',
    subtitles: parseManifestSubtitles(raw.subtitles),
    sprites: parseManifestSprites(raw.sprites),
  }
  if (raw.play_type === 'url' && typeof raw.play_data.play_url === 'string' && raw.play_data.play_url && 'data' in raw.play_data) {
    return normalized as unknown as PlaybackManifest
  }
  if (raw.play_type === 'm3u8' && typeof raw.play_data.m3u8_master === 'string' && raw.play_data.m3u8_master) {
    return normalized as unknown as PlaybackManifest
  }
  throw new PlaybackManifestError(undefined, '播放清单格式无效')
}

export async function getPlaybackManifest(mediaId: string, codecs: readonly PlaybackCodec[]): Promise<PlaybackManifest> {
  try {
    const response = await emos.post('api/reel/manifest', {
      json: { media_id: mediaId, codecs },
    })
    if (response.status !== 200) throw new PlaybackManifestError(response.status)
    return parsePlaybackManifest(await response.json<unknown>())
  } catch (error) {
    if (error instanceof PlaybackManifestError) throw error
    if (!(error instanceof HTTPError)) throw new PlaybackManifestError(undefined)
    const payload = (await error.response
      .clone()
      .json()
      .catch(() => undefined)) as ErrorResponse | undefined
    const responseMessage = typeof payload?.message === 'string' ? payload.message : undefined
    throw new PlaybackManifestError(error.response.status, responseMessage)
  }
}

export async function updatePlaybackProgress(payload: PlaybackProgressPayload, keepalive = false): Promise<void> {
  await emos.post('api/reel/progress', { json: payload, keepalive })
}
