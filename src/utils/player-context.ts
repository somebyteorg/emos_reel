import { StorageSerializers, useSessionStorage } from '@vueuse/core'
import type { MediaVersion } from '@/api/types'

export interface PlayerContext {
  mediaId: string
  forgeReelUuid: string
  todbId: number
  videoListId: number
  videoType: string
  videoTitle: string
  logo?: string | null
  backdrop: string | null
  seasonNumber: number | null
  episodeNumber: number | null
  episodeTitle: string | null
  partNumber: number | null
  mediaName: string
  versions?: MediaVersion[]
  resumeSeconds: number | null
}

const contextCache = useSessionStorage<Record<string, PlayerContext>>('emos_reel.player.contexts', {}, { serializer: StorageSerializers.object })

export function cachePlayerContext(context: PlayerContext) {
  contextCache.value = { ...contextCache.value, [context.mediaId]: context }
}

export function getPlayerContext(mediaId: string): PlayerContext | undefined {
  return contextCache.value[mediaId]
}

export function updatePlayerProgress(mediaId: string, seconds: number) {
  const context = contextCache.value[mediaId]
  if (!context) return
  contextCache.value = {
    ...contextCache.value,
    [mediaId]: { ...context, resumeSeconds: seconds },
  }
}
