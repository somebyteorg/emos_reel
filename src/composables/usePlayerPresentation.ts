import { computed, type Ref } from 'vue'
import { imageUrl } from '@/api/todb'
import type { MediaDetail, MediaVersion, PlaybackManifest, VideoInfo } from '@/api/types'
import type { PlayerContext } from '@/utils/player-context'

interface UsePlayerPresentationOptions {
  context: Ref<PlayerContext | undefined>
  detail: Ref<MediaDetail | undefined>
  videoInfo: Ref<VideoInfo | undefined>
  manifest: Ref<PlaybackManifest | undefined>
  mediaId: Readonly<Ref<string>>
  playbackVersions: Ref<MediaVersion[]>
}

export function usePlayerPresentation(options: UsePlayerPresentationOptions) {
  const baseTitle = computed(() => options.context.value?.videoTitle || options.videoInfo.value?.video_title || options.detail.value?.video_title || 'EMOS REEL')
  const title = computed(() => {
    const segments = [baseTitle.value]
    const seasonNumber = options.context.value?.seasonNumber ?? options.detail.value?.season_number
    const episodeNumber = options.context.value?.episodeNumber ?? options.detail.value?.episode_number
    if (seasonNumber != null) segments.push(`第 ${seasonNumber} 季`)
    if (episodeNumber != null) segments.push(`第 ${episodeNumber} 集`)
    return segments.join(' · ')
  })
  const episodeLine = computed(() => {
    const segments: string[] = []
    const episodeTitle = options.context.value?.episodeTitle || options.detail.value?.episode_title
    const partNumber = options.context.value?.partNumber ?? options.detail.value?.part_number
    if (episodeTitle) segments.push(episodeTitle)
    if (partNumber != null) segments.push(`分段 ${partNumber}`)
    return segments.join(' · ')
  })
  const currentPlaybackVersion = computed(() => options.playbackVersions.value.find((version) => version.media_id === options.mediaId.value))
  const mediaName = computed(() => currentPlaybackVersion.value?.media_name || options.manifest.value?.media_name || options.detail.value?.media_name || options.context.value?.mediaName || '')
  const storageLocation = computed(() => currentPlaybackVersion.value?.storage_title || '')
  const isSeries = computed(() => (options.context.value?.videoType || options.videoInfo.value?.video_type || options.detail.value?.video_type) === 'tv')
  const playingSeasonNumber = computed(() => options.context.value?.seasonNumber ?? options.detail.value?.season_number ?? null)
  const playingEpisodeNumber = computed(() => options.context.value?.episodeNumber ?? options.detail.value?.episode_number ?? null)
  const shareTitle = computed(() => {
    if (!isSeries.value || playingSeasonNumber.value == null || playingEpisodeNumber.value == null) {
      return baseTitle.value
    }
    const season = String(playingSeasonNumber.value).padStart(2, '0')
    const episode = String(playingEpisodeNumber.value).padStart(2, '0')
    return `${baseTitle.value} · S${season}E${episode}`
  })
  const playerLogoSource = computed(() => options.context.value?.logo || imageUrl(options.videoInfo.value?.image_logo, 'w500') || '')
  const playerBackdropSource = computed(() => options.context.value?.backdrop || imageUrl(options.videoInfo.value?.image_backdrop) || '')
  const showNowPlaying = computed(() => isSeries.value && Boolean(playerLogoSource.value))
  const nowPlayingTitle = computed(() => {
    if (!isSeries.value) return baseTitle.value
    return options.context.value?.episodeTitle || options.detail.value?.episode_title || (playingEpisodeNumber.value != null ? `第 ${playingEpisodeNumber.value} 集` : baseTitle.value)
  })
  const nowPlayingMeta = computed(() => {
    if (!isSeries.value) return ''
    const segments: string[] = []
    if (playingSeasonNumber.value != null) segments.push(`第 ${playingSeasonNumber.value} 季`)
    if (playingEpisodeNumber.value != null) segments.push(`第 ${playingEpisodeNumber.value} 集`)
    const partNumber = options.context.value?.partNumber ?? options.detail.value?.part_number
    if (partNumber != null) segments.push(`分段 ${partNumber}`)
    return segments.join(' · ')
  })
  const mediaSessionArtist = computed(() => episodeLine.value || mediaName.value)

  return {
    baseTitle,
    currentPlaybackVersion,
    episodeLine,
    isSeries,
    mediaName,
    mediaSessionArtist,
    nowPlayingMeta,
    nowPlayingTitle,
    playerBackdropSource,
    playerLogoSource,
    playingEpisodeNumber,
    playingSeasonNumber,
    shareTitle,
    showNowPlaying,
    storageLocation,
    title,
  }
}
