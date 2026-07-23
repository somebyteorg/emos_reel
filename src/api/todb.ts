import { StorageSerializers, useSessionStorage } from '@vueuse/core'
import { todb as todbClient } from '@/utils/ky'
import type { EpisodeInfo, SeasonInfo, TodbVideoListResponse, VideoDictionary, VideoImage, VideoInfo } from '@/api/types'

interface VideoImageResponse {
  page: number
  page_size: number
  total: number
  items: VideoImage[]
}

export interface TodbVideoListParams {
  videoType?: 'movie' | 'tv' | null
  title?: string
  year?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

const dictionaryCache = useSessionStorage<VideoDictionary | null>('emos_reel.todb.dict.video', null, { serializer: StorageSerializers.object })
const videoCache = useSessionStorage<Record<number, VideoInfo>>('emos_reel.todb.videos', {}, { serializer: StorageSerializers.object })
const imageCache = useSessionStorage<Record<string, VideoImage[]>>('emos_reel.todb.images', {}, { serializer: StorageSerializers.object })
const seasonCache = useSessionStorage<Record<number, SeasonInfo[]>>('emos_reel.todb.seasons', {}, { serializer: StorageSerializers.object })
const seasonDetailCache = useSessionStorage<Record<string, SeasonInfo>>('emos_reel.todb.season_details', {}, { serializer: StorageSerializers.object })
const episodeCache = useSessionStorage<Record<string, EpisodeInfo[]>>('emos_reel.todb.episodes', {}, { serializer: StorageSerializers.object })
const episodeDetailCache = useSessionStorage<Record<string, EpisodeInfo>>('emos_reel.todb.episode_details', {}, { serializer: StorageSerializers.object })

const videoRequests = new Map<number, Promise<VideoInfo>>()
const videoListRequests = new Map<string, Promise<TodbVideoListResponse>>()
const imageRequests = new Map<string, Promise<VideoImage[]>>()
const seasonRequests = new Map<number, Promise<SeasonInfo[]>>()
const seasonDetailRequests = new Map<string, Promise<SeasonInfo>>()
const episodeRequests = new Map<string, Promise<EpisodeInfo[]>>()
const episodeDetailRequests = new Map<string, Promise<EpisodeInfo>>()

function normalizePositiveInteger(value: number | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.floor(value!)))
}

function toVideoListSearchParams(params: TodbVideoListParams) {
  const searchParams: Record<string, string | number> = {
    page: normalizePositiveInteger(params.page, 1),
    page_size: normalizePositiveInteger(params.pageSize, 30, 100),
  }
  const title = params.title?.trim()
  const year = params.year?.trim()
  if (params.videoType === 'movie' || params.videoType === 'tv') searchParams.video_type = params.videoType
  if (title) searchParams.title = title
  if (year && /^\d{4}$/.test(year)) searchParams.year = year
  if (params.sortBy) searchParams.sort_by = params.sortBy
  if (params.sortOrder) searchParams.sort_order = params.sortOrder
  return searchParams
}

function cacheKey(params: Record<string, string | number>) {
  return new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()
}

export async function getVideo(todbId: number): Promise<VideoInfo> {
  const key = todbId
  if (videoCache.value[key]) return videoCache.value[key]
  if (videoRequests.has(key)) return videoRequests.get(key)!

  const request = todbClient
    .get(`video/${encodeURIComponent(todbId)}`)
    .json<VideoInfo>()
    .then((video) => {
      videoCache.value = { ...videoCache.value, [key]: video }
      return video
    })
    .finally(() => videoRequests.delete(key))
  videoRequests.set(key, request)
  return request
}

export async function getTodbVideoList(params: TodbVideoListParams): Promise<TodbVideoListResponse> {
  const searchParams = toVideoListSearchParams(params)
  const key = cacheKey(searchParams)
  if (videoListRequests.has(key)) return videoListRequests.get(key)!

  const request = todbClient
    .get('video/list', { searchParams })
    .json<TodbVideoListResponse>()
    .finally(() => videoListRequests.delete(key))
  videoListRequests.set(key, request)
  return request
}

export async function getVideoImages(todbId: number, pageSize = 12): Promise<VideoImage[]> {
  const normalizedPageSize = normalizePositiveInteger(pageSize, 12, 100)
  const key = `${todbId}:${normalizedPageSize}`
  if (imageCache.value[key]) return imageCache.value[key]
  if (imageRequests.has(key)) return imageRequests.get(key)!

  const request = todbClient
    .get('image', {
      searchParams: {
        type: 'backdrop',
        relation_type: 'video_list',
        relation_id: todbId,
        page: 1,
        page_size: normalizedPageSize,
      },
    })
    .json<VideoImageResponse>()
    .then((response) => {
      const images = [...response.items].sort((a, b) => Number(b.is_default) - Number(a.is_default))
      imageCache.value = { ...imageCache.value, [key]: images }
      return images
    })
    .finally(() => imageRequests.delete(key))
  imageRequests.set(key, request)
  return request
}

export async function getVideoDictionary(): Promise<VideoDictionary> {
  if (dictionaryCache.value) return dictionaryCache.value
  const dictionary = await todbClient.get('dict/video').json<VideoDictionary>()
  dictionaryCache.value = dictionary
  return dictionary
}

export async function getSeasons(todbId: number): Promise<SeasonInfo[]> {
  const key = todbId
  if (seasonCache.value[key]) return seasonCache.value[key]
  if (seasonRequests.has(key)) return seasonRequests.get(key)!

  const request = todbClient
    .get(`video/${encodeURIComponent(todbId)}/season/all`)
    .json<SeasonInfo[]>()
    .then((seasons) => {
      seasonCache.value = { ...seasonCache.value, [key]: seasons }
      return seasons
    })
    .finally(() => seasonRequests.delete(key))
  seasonRequests.set(key, request)
  return request
}

export async function getSeason(todbId: number, seasonNumber: number): Promise<SeasonInfo> {
  const key = `${todbId}:${seasonNumber}`
  if (seasonDetailCache.value[key]) return seasonDetailCache.value[key]
  const fromList = seasonCache.value[todbId]?.find((season) => season.season_number === seasonNumber)
  if (fromList) {
    seasonDetailCache.value = { ...seasonDetailCache.value, [key]: fromList }
    return fromList
  }
  if (seasonDetailRequests.has(key)) return seasonDetailRequests.get(key)!

  const request = todbClient
    .get(`video/${encodeURIComponent(todbId)}/season/${seasonNumber}`)
    .json<SeasonInfo>()
    .then((season) => {
      seasonDetailCache.value = { ...seasonDetailCache.value, [key]: season }
      return season
    })
    .finally(() => seasonDetailRequests.delete(key))
  seasonDetailRequests.set(key, request)
  return request
}

export async function getEpisodes(todbId: number, seasonNumber: number): Promise<EpisodeInfo[]> {
  const key = `${todbId}:${seasonNumber}`
  if (episodeCache.value[key]) return episodeCache.value[key]
  if (episodeRequests.has(key)) return episodeRequests.get(key)!

  const request = todbClient
    .get(`video/${encodeURIComponent(todbId)}/season/${seasonNumber}/episode/all`)
    .json<EpisodeInfo[]>()
    .then((episodes) => {
      episodeCache.value = { ...episodeCache.value, [key]: episodes }
      return episodes
    })
    .finally(() => episodeRequests.delete(key))
  episodeRequests.set(key, request)
  return request
}

export async function getEpisode(todbId: number, seasonNumber: number, episodeNumber: number): Promise<EpisodeInfo> {
  const key = `${todbId}:${seasonNumber}:${episodeNumber}`
  if (episodeDetailCache.value[key]) return episodeDetailCache.value[key]
  const fromList = episodeCache.value[`${todbId}:${seasonNumber}`]?.find((episode) => episode.episode_number === episodeNumber)
  if (fromList) {
    episodeDetailCache.value = { ...episodeDetailCache.value, [key]: fromList }
    return fromList
  }
  if (episodeDetailRequests.has(key)) return episodeDetailRequests.get(key)!

  const request = todbClient
    .get(`video/${encodeURIComponent(todbId)}/season/${seasonNumber}/episode/${episodeNumber}`)
    .json<EpisodeInfo>()
    .then((episode) => {
      episodeDetailCache.value = { ...episodeDetailCache.value, [key]: episode }
      return episode
    })
    .finally(() => episodeDetailRequests.delete(key))
  episodeDetailRequests.set(key, request)
  return request
}

export function imageUrl(path: unknown, size: 'original' | 'w300' | 'w500' = 'original'): string | undefined {
  if (typeof path !== 'string' || !path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  return `https://image.theotherdb.org/${size}/${path.replace(/^\/+/, '')}`
}
