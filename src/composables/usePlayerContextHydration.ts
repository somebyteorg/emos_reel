import type { Ref } from 'vue'
import { getMediaDetails } from '@/api/emos'
import type { MediaDetail, MediaVersion, PlaybackManifest, VideoInfo } from '@/api/types'
import { requestPlaybackVersions, resolveContextArtwork, resolvePlayerContext } from '@/composables/usePlayerContextResolver'
import { cachePlayerContext, type PlayerContext } from '@/utils/player-context'

interface UsePlayerContextHydrationOptions {
  mediaId: Readonly<Ref<string>>
  context: Ref<PlayerContext | undefined>
  detail: Ref<MediaDetail | undefined>
  videoInfo: Ref<VideoInfo | undefined>
  playbackVersions: Ref<MediaVersion[]>
  dataWarning: Ref<string>
  isCurrentLoad: (expectedLoad: number, expectedMediaId?: string) => boolean
}

export function usePlayerContextHydration(options: UsePlayerContextHydrationOptions) {
  function needsArtworkRefresh(nextContext: PlayerContext) {
    const cachedContext = nextContext as PlayerContext & { backdrop?: string | null; logo?: string | null }
    return cachedContext.backdrop === undefined || cachedContext.logo === undefined
  }

  async function restorePlaybackVersions(nextContext: PlayerContext, expectedLoad: number) {
    try {
      const versions = await requestPlaybackVersions(nextContext.videoListId, nextContext.mediaId, nextContext.seasonNumber, nextContext.episodeNumber, nextContext.partNumber)
      if (!options.isCurrentLoad(expectedLoad, nextContext.mediaId)) return
      options.playbackVersions.value = versions
      if (!versions.length) {
        options.dataWarning.value = '当前视频没有其它可切换的版本'
        return
      }
      const restoredContext = { ...nextContext, ...options.context.value, versions }
      options.context.value = restoredContext
      cachePlayerContext(restoredContext)
    } catch {
      if (options.isCurrentLoad(expectedLoad, nextContext.mediaId)) options.dataWarning.value = '暂时无法获取其它播放版本'
    }
  }

  async function restoreContextArtwork(nextContext: PlayerContext, expectedLoad: number) {
    try {
      const { backdrop, logo, videoInfo } = await resolveContextArtwork(nextContext)
      if (!options.isCurrentLoad(expectedLoad, nextContext.mediaId)) return
      options.videoInfo.value = videoInfo
      const restoredContext = {
        ...nextContext,
        ...options.context.value,
        backdrop,
        logo,
      }
      options.context.value = restoredContext
      cachePlayerContext(restoredContext)
    } catch {
      if (!options.isCurrentLoad(expectedLoad, nextContext.mediaId)) return
      const restoredContext = {
        ...nextContext,
        ...options.context.value,
        backdrop: nextContext.backdrop ?? options.context.value?.backdrop ?? null,
        logo: nextContext.logo ?? options.context.value?.logo ?? null,
      }
      options.context.value = restoredContext
      cachePlayerContext(restoredContext)
    }
  }

  async function hydrateContext(details: MediaDetail[], playbackManifest: PlaybackManifest, expectedLoad: number) {
    if (options.context.value) return
    const expectedMediaId = options.mediaId.value
    try {
      const resolved = await resolvePlayerContext(expectedMediaId, details, playbackManifest)
      if (!options.isCurrentLoad(expectedLoad, expectedMediaId)) return
      options.detail.value = resolved.detail
      options.videoInfo.value = resolved.videoInfo
      options.playbackVersions.value = resolved.versions
      if (resolved.warning) options.dataWarning.value = resolved.warning
      if (!resolved.context) return
      options.context.value = resolved.context
      cachePlayerContext(resolved.context)
    } catch {
      if (options.isCurrentLoad(expectedLoad, expectedMediaId)) options.dataWarning.value = '暂时无法读取影片资料'
    }
  }

  function requestPlaybackDetails(expectedLoad: number, expectedMediaId: string) {
    return getMediaDetails(expectedMediaId).catch(() => {
      if (options.isCurrentLoad(expectedLoad, expectedMediaId)) options.dataWarning.value = '暂时无法读取影片资料'
      return []
    })
  }

  return {
    hydrateContext,
    needsArtworkRefresh,
    requestPlaybackDetails,
    restoreContextArtwork,
    restorePlaybackVersions,
  }
}
