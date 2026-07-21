import { computed, ref, type Ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getMediaSources } from '@/api/emos'
import { getEpisodes, getSeasons } from '@/api/todb'
import type { EpisodeInfo, MediaSource, SeasonInfo } from '@/api/types'
import { pickPreferredMediaVersion, useMediaSourceSelection } from '@/composables/useMediaSourceSelection'
import { cachePlayerContext, type PlayerContext, updatePlayerProgress } from '@/utils/player-context'

interface UsePlayerEpisodeSwitcherOptions {
  context: Ref<PlayerContext | undefined>
  enabled: Readonly<Ref<boolean>>
  mediaId: Readonly<Ref<string>>
  currentTime: Ref<number>
  playbackRate: Ref<number>
  videoElement: Ref<HTMLVideoElement | undefined>
  isSeries: Readonly<Ref<boolean>>
  playingSeasonNumber: Readonly<Ref<number | null>>
  playingEpisodeNumber: Readonly<Ref<number | null>>
  beforeOpen: () => void
  seekTo: (seconds: number) => void
  submitProgress: (keepalive?: boolean, targetMediaId?: string, seconds?: number, rate?: number) => void
}

export function usePlayerEpisodeSwitcher(options: UsePlayerEpisodeSwitcherOptions) {
  const router = useRouter()
  const episodeSwitcherOpen = ref(false)
  const episodeSwitcherLoading = ref(false)
  const episodeResourceLoading = ref(false)
  const episodeSwitching = ref(false)
  const episodeResourceError = ref('')
  const switcherSeasons = ref<SeasonInfo[]>([])
  const switcherEpisodes = ref<EpisodeInfo[]>([])
  const episodeIndex = ref<EpisodeInfo[]>([])
  const switcherSources = ref<MediaSource[]>([])
  const switcherSeasonNumber = ref<number | null>(null)
  const switcherEpisodeNumber = ref<number | null>(null)
  const switcherPartNumber = ref<number | null>(null)
  const switcherMediaId = ref('')
  let loadSequence = 0
  let activeVideoKey = ''

  const switcherSelectedEpisode = computed(() => switcherEpisodes.value.find((episode) => episode.episode_number === switcherEpisodeNumber.value))
  const preferredSwitcherMediaId = computed(() =>
    switcherSeasonNumber.value === options.playingSeasonNumber.value && switcherEpisodeNumber.value === options.playingEpisodeNumber.value ? options.mediaId.value : undefined,
  )
  const {
    availableEpisodeNumbers,
    partSources: switcherPartSources,
    selectedSource: switcherSelectedSource,
    sourceForEpisode,
    versions: switcherVersions,
  } = useMediaSourceSelection({
    sources: switcherSources,
    isSeries: options.isSeries,
    seasonNumber: switcherSeasonNumber,
    episodeNumber: switcherEpisodeNumber,
    partNumber: switcherPartNumber,
    mediaId: switcherMediaId,
    preferredMediaId: preferredSwitcherMediaId,
  })
  const currentEpisodeIndex = computed(() => episodeIndex.value.findIndex((episode) => episode.episode_number === options.playingEpisodeNumber.value))
  const canPreviousEpisode = computed(() => options.isSeries.value && !episodeSwitching.value && currentEpisodeIndex.value > 0)
  const canNextEpisode = computed(() => options.isSeries.value && !episodeSwitching.value && currentEpisodeIndex.value >= 0 && currentEpisodeIndex.value < episodeIndex.value.length - 1)

  async function preloadEpisodeIndex(nextContext: PlayerContext | undefined) {
    if (!options.enabled.value || !nextContext || nextContext.videoType !== 'tv' || nextContext.seasonNumber == null) {
      episodeIndex.value = []
      return
    }
    const expectedMediaId = nextContext.mediaId
    const episodes = await getEpisodes(nextContext.todbId, nextContext.seasonNumber).catch(() => [])
    if (options.enabled.value && options.context.value?.mediaId === expectedMediaId) episodeIndex.value = episodes
  }

  async function loadSwitcherSeason(seasonNumber: number, preferredEpisodeNumber?: number | null) {
    const currentContext = options.context.value
    if (!options.enabled.value || !currentContext) return
    const currentLoad = ++loadSequence
    switcherSeasonNumber.value = seasonNumber
    switcherEpisodeNumber.value = null
    switcherPartNumber.value = null
    switcherMediaId.value = ''
    switcherEpisodes.value = []
    switcherSources.value = []
    episodeSwitcherLoading.value = true
    episodeResourceLoading.value = true
    episodeResourceError.value = ''

    const [episodesResult, sourcesResult] = await Promise.allSettled([getEpisodes(currentContext.todbId, seasonNumber), getMediaSources(currentContext.videoListId, { seasonNumber })])
    if (currentLoad !== loadSequence) return
    if (episodesResult.status === 'rejected') {
      episodeResourceError.value = '本季数据暂时不可用'
      episodeSwitcherLoading.value = false
      episodeResourceLoading.value = false
      return
    }

    switcherEpisodes.value = episodesResult.value
    if (seasonNumber === options.playingSeasonNumber.value) episodeIndex.value = episodesResult.value
    if (sourcesResult.status === 'fulfilled') {
      switcherSources.value = sourcesResult.value
    } else {
      episodeResourceError.value = '片源信息暂时不可用'
    }

    const preferredExists = preferredEpisodeNumber != null && episodesResult.value.some((episode) => episode.episode_number === preferredEpisodeNumber)
    const firstPlayable = switcherSources.value
      .filter((source) => source.episode_number != null && source.versions.length)
      .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))[0]?.episode_number
    switcherEpisodeNumber.value = preferredExists ? preferredEpisodeNumber! : (firstPlayable ?? episodesResult.value[0]?.episode_number ?? null)
    switcherPartNumber.value =
      seasonNumber === options.playingSeasonNumber.value && switcherEpisodeNumber.value === options.playingEpisodeNumber.value ? (options.context.value?.partNumber ?? null) : null
    episodeSwitcherLoading.value = false
    episodeResourceLoading.value = false
  }

  async function openEpisodeSwitcher() {
    const currentContext = options.context.value
    if (!options.enabled.value || !currentContext || currentContext.videoType !== 'tv') return
    options.beforeOpen()
    episodeSwitcherOpen.value = true
    episodeResourceError.value = ''
    if (!switcherSeasons.value.length) {
      const expectedVideoKey = activeVideoKey
      episodeSwitcherLoading.value = true
      try {
        const seasons = await getSeasons(currentContext.todbId)
        if (expectedVideoKey !== activeVideoKey) return
        switcherSeasons.value = seasons
      } catch {
        if (expectedVideoKey !== activeVideoKey) return
        episodeResourceError.value = '季数据暂时不可用'
        episodeSwitcherLoading.value = false
        return
      }
      episodeSwitcherLoading.value = false
    }
    const seasonNumber = currentContext.seasonNumber ?? switcherSeasons.value[0]?.season_number
    if (seasonNumber == null) return
    if (switcherSeasonNumber.value === seasonNumber && switcherEpisodes.value.length && switcherSources.value.length) {
      switcherEpisodeNumber.value = currentContext.episodeNumber
      switcherPartNumber.value = currentContext.partNumber
      return
    }
    await loadSwitcherSeason(seasonNumber, currentContext.episodeNumber)
  }

  function selectSwitcherEpisode(episodeNumber: number) {
    switcherEpisodeNumber.value = episodeNumber
    switcherPartNumber.value = null
  }

  function selectSwitcherPart(partNumber: number | null) {
    switcherPartNumber.value = partNumber
  }

  async function switchSelectedEpisode(fromStart = false) {
    if (!options.enabled.value) return
    const currentContext = options.context.value
    const source = switcherSelectedSource.value
    const version = switcherVersions.value.find((item) => item.media_id === switcherMediaId.value)
    const episode = switcherSelectedEpisode.value
    if (!currentContext || !source || !version || !episode || switcherSeasonNumber.value == null) return
    if (version.media_id === options.mediaId.value) {
      if (fromStart || source.is_complete) {
        options.seekTo(0)
        void options.videoElement.value?.play()
      }
      episodeSwitcherOpen.value = false
      return
    }

    episodeSwitching.value = true
    updatePlayerProgress(options.mediaId.value, options.currentTime.value)
    options.submitProgress(false, options.mediaId.value, options.currentTime.value, options.playbackRate.value)
    const shouldStartOver = fromStart || source.is_complete
    cachePlayerContext({
      ...currentContext,
      mediaId: version.media_id,
      seasonNumber: switcherSeasonNumber.value,
      episodeNumber: episode.episode_number,
      episodeTitle: episode.episode_title,
      partNumber: source.part_number,
      mediaName: version.media_name,
      versions: source.versions,
      resumeSeconds: shouldStartOver ? 0 : source.play_seconds,
    })
    episodeSwitcherOpen.value = false
    try {
      await router.replace({
        name: 'player',
        params: { mediaId: version.media_id },
        query: shouldStartOver ? { t: '0' } : undefined,
      })
    } finally {
      episodeSwitching.value = false
    }
  }

  async function switchAdjacentEpisode(direction: -1 | 1) {
    if (!options.enabled.value) return
    const currentContext = options.context.value
    if (!currentContext || currentContext.seasonNumber == null || currentContext.episodeNumber == null) return
    if (switcherSeasonNumber.value !== currentContext.seasonNumber || !switcherSources.value.length) {
      await loadSwitcherSeason(currentContext.seasonNumber, currentContext.episodeNumber)
    }
    const playableNumbers = [...new Set(switcherSources.value.filter((source) => source.episode_number != null && source.versions.length).map((source) => source.episode_number!))].sort(
      (a, b) => a - b,
    )
    const candidates = direction < 0 ? playableNumbers.filter((number) => number < currentContext.episodeNumber!).reverse() : playableNumbers.filter((number) => number > currentContext.episodeNumber!)
    const episodeNumber = candidates[0]
    if (episodeNumber == null) {
      await openEpisodeSwitcher()
      return
    }
    switcherEpisodeNumber.value = episodeNumber
    const source = sourceForEpisode(episodeNumber)
    const version = source ? pickPreferredMediaVersion(source.versions) : undefined
    if (!source || !version) {
      await openEpisodeSwitcher()
      return
    }
    switcherPartNumber.value = source.part_number
    switcherMediaId.value = version.media_id
    await switchSelectedEpisode()
  }

  function resetForVideo(nextContext: PlayerContext | undefined) {
    const nextVideoKey = nextContext ? `${nextContext.todbId}:${nextContext.videoListId}` : ''
    if (nextVideoKey === activeVideoKey) return
    activeVideoKey = nextVideoKey
    loadSequence += 1
    episodeSwitcherOpen.value = false
    episodeSwitcherLoading.value = false
    episodeResourceLoading.value = false
    episodeSwitching.value = false
    episodeResourceError.value = ''
    episodeIndex.value = []
    switcherSeasons.value = []
    switcherEpisodes.value = []
    switcherSources.value = []
    switcherSeasonNumber.value = null
    switcherEpisodeNumber.value = null
    switcherPartNumber.value = null
    switcherMediaId.value = ''
  }

  watch(
    [options.context, options.enabled],
    ([nextContext, enabled]) => {
      resetForVideo(nextContext)
      if (enabled) void preloadEpisodeIndex(nextContext)
      else {
        loadSequence += 1
        episodeSwitcherOpen.value = false
      }
    },
    { immediate: true },
  )
  return {
    availableEpisodeNumbers,
    canNextEpisode,
    canPreviousEpisode,
    episodeIndex,
    episodeResourceError,
    episodeResourceLoading,
    episodeSwitcherLoading,
    episodeSwitcherOpen,
    episodeSwitching,
    loadSwitcherSeason,
    openEpisodeSwitcher,
    selectSwitcherEpisode,
    selectSwitcherPart,
    switchAdjacentEpisode,
    switcherEpisodeNumber,
    switcherEpisodes,
    switcherMediaId,
    switcherPartNumber,
    switcherPartSources,
    switcherSeasonNumber,
    switcherSeasons,
    switcherSelectedEpisode,
    switcherSources,
    switcherVersions,
    switchSelectedEpisode,
  }
}
