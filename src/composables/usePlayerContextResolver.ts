import { getMediaSources, getTodbIdByVideoId } from '@/api/emos'
import { getEpisode, getVideo, imageUrl } from '@/api/todb'
import type { MediaDetail, MediaVersion, PlaybackManifest, VideoInfo } from '@/api/types'
import type { PlayerContext } from '@/utils/player-context'

export interface ResolvedPlayerContext {
  context?: PlayerContext
  detail?: MediaDetail
  versions: MediaVersion[]
  videoInfo?: VideoInfo
  warning: string
}

export async function requestPlaybackVersions(videoListId: number, expectedMediaId: string, seasonNumber: number | null, episodeNumber: number | null, partNumber: number | null) {
  const sources = await getMediaSources(videoListId, {
    seasonNumber: seasonNumber ?? undefined,
    episodeNumber: episodeNumber ?? undefined,
    partNumber: partNumber ?? undefined,
  })
  return sources.find((source) => source.versions.some((version) => version.media_id === expectedMediaId))?.versions ?? []
}

export function mediaVersionFromDetail(item: MediaDetail): MediaVersion {
  return {
    media_id: item.media_id,
    media_name: item.media_name,
    media_size: item.media_file_size,
    media_second: item.media_file_second,
    media_metadata: item.media_metadata ?? item.media_file_metadata ?? null,
    storage_title: item.storage_title ?? null,
  }
}

export async function resolvePlayerContext(mediaId: string, details: MediaDetail[], playbackManifest: PlaybackManifest): Promise<ResolvedPlayerContext> {
  const mediaDetail = details.find((item) => item.media_id === mediaId) ?? details[0]
  if (!mediaDetail?.video_id) {
    return { detail: mediaDetail, versions: [], warning: '暂时无法读取影片资料' }
  }

  const videoListId = mediaDetail.video_id
  const todbId = mediaDetail.todb_id ?? (await getTodbIdByVideoId(videoListId))
  const [videoInfo, requestedVersions] = await Promise.all([
    getVideo(todbId),
    requestPlaybackVersions(videoListId, mediaId, mediaDetail.season_number, mediaDetail.episode_number, mediaDetail.part_number).catch(() => []),
  ])
  const versions = requestedVersions.length ? requestedVersions : [mediaVersionFromDetail(mediaDetail)]
  let warning = ''
  let episodeTitle = mediaDetail.episode_title

  if (videoInfo.video_type === 'tv') {
    if (mediaDetail.season_number == null || mediaDetail.episode_number == null) {
      warning = '这一集的资料不完整'
    } else if (!episodeTitle) {
      episodeTitle = (await getEpisode(todbId, mediaDetail.season_number, mediaDetail.episode_number).catch(() => undefined))?.episode_title ?? null
    }
  }

  const context: PlayerContext = {
    mediaId,
    videoRouteId: String(videoListId),
    forgeReelUuid: playbackManifest.forge_reel_uuid,
    todbId,
    videoListId,
    videoType: videoInfo.video_type,
    videoTitle: videoInfo.video_title,
    logo: imageUrl(videoInfo.image_logo, 'w500') ?? null,
    backdrop: imageUrl(videoInfo.image_backdrop) ?? null,
    seasonNumber: mediaDetail.season_number,
    episodeNumber: mediaDetail.episode_number,
    episodeTitle,
    partNumber: mediaDetail.part_number,
    mediaName: mediaDetail.media_name,
    versions,
    resumeSeconds: null,
  }

  return {
    context,
    detail: mediaDetail,
    versions,
    videoInfo,
    warning: !versions.length && !warning ? '当前视频没有其它可切换的版本' : warning,
  }
}

export async function resolveContextArtwork(context: PlayerContext) {
  const videoInfo = await getVideo(context.todbId)
  return {
    backdrop: imageUrl(videoInfo.image_backdrop) ?? null,
    logo: imageUrl(videoInfo.image_logo, 'w500') ?? null,
    videoInfo,
  }
}
