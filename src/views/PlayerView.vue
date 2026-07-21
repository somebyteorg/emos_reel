<script lang="ts" setup>
  import { Activity, AlertCircle, ChevronLeft, ExternalLink, House, ListVideo, LoaderCircle, LockKeyhole, Play, RotateCw, Share2 } from '@lucide/vue'
  import { useEventListener, useIntervalFn, useTimeoutFn } from '@vueuse/core'
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import PlayerControls from '@/components/PlayerControls.vue'
  import PlayerDebugPanel from '@/components/PlayerDebugPanel.vue'
  import PlayerEndOverlay from '@/components/PlayerEndOverlay.vue'
  import PlayerErrorVersionPicker from '@/components/PlayerErrorVersionPicker.vue'
  import PlayerEpisodeSwitcher from '@/components/PlayerEpisodeSwitcher.vue'
  import ShareDialog from '@/components/ShareDialog.vue'
  import { usePlaybackProgress } from '@/composables/usePlaybackProgress'
  import { usePlayerEpisodeSwitcher } from '@/composables/usePlayerEpisodeSwitcher'
  import { usePlayerMediaSession } from '@/composables/usePlayerMediaSession'
  import { useShakaPlayer } from '@/composables/useShakaPlayer'
  import { type SubtitlePreference, usePlayerSubtitles } from '@/composables/usePlayerSubtitles'
  import { getMediaDetails, getMediaSources, getPlaybackManifest, PlaybackManifestError } from '@/api/emos'
  import { getEpisode, getVideo, imageUrl } from '@/api/todb'
  import type { EpisodeInfo, MediaDetail, MediaVersion, PlaybackManifest, VideoInfo } from '@/api/types'
  import { useSignStore } from '@/stores/sign'
  import type { PlayerBufferedRange, PlayerDebugSnapshot } from '@/types/player'
  import { getSupportedPlaybackCodecs, hasRequiredPlaybackCodecs } from '@/utils/media-codecs'
  import { fallbackPlaybackErrorMessage, formatUnknownPlaybackError, playbackErrorUserMessage } from '@/utils/player-errors'
  import { formatBitrate, formatTransferSpeed } from '@/utils/player-metrics'
  import { cachePlayerContext, getPlayerContext, type PlayerContext, updatePlayerProgress } from '@/utils/player-context'

  const route = useRoute()
  const router = useRouter()
  const signStore = useSignStore()
  const mediaId = computed(() => String(route.params.mediaId || ''))
  const videoElement = ref<HTMLVideoElement>()
  const playerShell = ref<HTMLElement>()
  const context = ref<PlayerContext>()
  const detail = ref<MediaDetail>()
  const videoInfo = ref<VideoInfo>()
  const manifest = ref<PlaybackManifest>()
  const manifestReady = ref(false)
  const loading = ref(false)
  const ready = ref(false)
  const errorMessage = ref('')
  const latestPlaybackErrorMessage = ref('')
  const latestPlaybackErrorUserMessage = ref('')
  const manifestNotFound = ref(false)
  const dataWarning = ref('')
  const paused = ref(true)
  const currentTime = ref(0)
  const duration = ref(0)
  const bufferedRanges = ref<PlayerBufferedRange[]>([])
  const volume = ref(1)
  const muted = ref(false)
  const controlsVisible = ref(true)
  const controlsLocked = ref(false)
  const playbackVersions = ref<MediaVersion[]>([])
  const versionSwitching = ref(false)
  const playbackRate = ref(1)
  const debugVisible = ref(false)
  const bufferingVisible = ref(false)
  const playbackEnded = ref(false)
  const endOverlayDismissed = ref(false)
  const endNextResolving = ref(false)
  const endNextEpisode = ref<EpisodeInfo>()
  const nextEpisodeCountdown = ref(0)
  const shareOpen = ref(false)
  const fullscreen = ref(false)
  const canPictureInPicture = ref(false)
  let loadSequence = 0
  let nextLoadShouldAutoplay = true
  let nextSubtitlePreference: SubtitlePreference
  let nextAudioPreference = ''

  const baseTitle = computed(() => context.value?.videoTitle || videoInfo.value?.video_title || detail.value?.video_title || 'EMOS REEL')
  const title = computed(() => {
    const segments = [baseTitle.value]
    const seasonNumber = context.value?.seasonNumber ?? detail.value?.season_number
    const episodeNumber = context.value?.episodeNumber ?? detail.value?.episode_number
    if (seasonNumber != null) segments.push(`第 ${seasonNumber} 季`)
    if (episodeNumber != null) segments.push(`第 ${episodeNumber} 集`)
    return segments.join(' · ')
  })
  const episodeLine = computed(() => {
    const segments: string[] = []
    const episodeTitle = context.value?.episodeTitle || detail.value?.episode_title
    const partNumber = context.value?.partNumber ?? detail.value?.part_number
    if (episodeTitle) segments.push(episodeTitle)
    if (partNumber != null) segments.push(`分段 ${partNumber}`)
    return segments.join(' · ')
  })
  const mediaName = computed(() => context.value?.mediaName || manifest.value?.media_name || detail.value?.media_name || '')
  const isSeries = computed(() => (context.value?.videoType || videoInfo.value?.video_type || detail.value?.video_type) === 'tv')
  const playingSeasonNumber = computed(() => context.value?.seasonNumber ?? detail.value?.season_number ?? null)
  const playingEpisodeNumber = computed(() => context.value?.episodeNumber ?? detail.value?.episode_number ?? null)
  const shareTitle = computed(() => {
    if (!isSeries.value || playingSeasonNumber.value == null || playingEpisodeNumber.value == null) {
      return baseTitle.value
    }
    const season = String(playingSeasonNumber.value).padStart(2, '0')
    const episode = String(playingEpisodeNumber.value).padStart(2, '0')
    return `${baseTitle.value} · S${season}E${episode}`
  })
  const playerLogo = computed(() => context.value?.logo || imageUrl(videoInfo.value?.image_logo, 'w500') || '')
  const showNowPlaying = computed(() => isSeries.value && Boolean(playerLogo.value))
  const nowPlayingTitle = computed(() => {
    if (!isSeries.value) return baseTitle.value
    return context.value?.episodeTitle || detail.value?.episode_title || (playingEpisodeNumber.value != null ? `第 ${playingEpisodeNumber.value} 集` : baseTitle.value)
  })
  const nowPlayingMeta = computed(() => {
    if (!isSeries.value) return ''
    const segments: string[] = []
    if (playingSeasonNumber.value != null) segments.push(`第 ${playingSeasonNumber.value} 季`)
    if (playingEpisodeNumber.value != null) segments.push(`第 ${playingEpisodeNumber.value} 集`)
    const partNumber = context.value?.partNumber ?? detail.value?.part_number
    if (partNumber != null) segments.push(`分段 ${partNumber}`)
    return segments.join(' · ')
  })
  const endNextEpisodeLabel = computed(() => (endNextEpisode.value ? `第 ${endNextEpisode.value.episode_number} 集` : ''))
  const mediaSessionArtist = computed(() => episodeLine.value || mediaName.value)
  const mediaSessionArtwork = computed(() => context.value?.backdrop)
  const debugSnapshot = ref<PlayerDebugSnapshot>({
    downloadSpeed: '--',
    estimatedBandwidth: '--',
    streamBandwidth: '--',
    bufferAhead: '--',
    viewport: '--',
    resolution: '--',
    droppedFrames: '--',
    codecs: '--',
    mediaId: '',
    mediaName: '',
  })
  const {
    audioOptions,
    destroy: destroyShakaPlayer,
    getPlayer,
    getStats,
    lastSegmentDownloadAt,
    load: loadShakaPlayer,
    segmentDownloadBitsPerSecond,
    selectAudioTrack: selectShakaAudioTrack,
    selectedAudioId,
  } = useShakaPlayer({
    videoElement,
    getToken: () => signStore.user_token,
    onError: (playbackError, critical) => {
      latestPlaybackErrorMessage.value = playbackError.message || `Shaka Error ${playbackError.code}`
      latestPlaybackErrorUserMessage.value = playbackErrorUserMessage(playbackError)
      if (ready.value && critical) errorMessage.value = latestPlaybackErrorUserMessage.value
    },
    onStatsChanged: () => {
      if (debugVisible.value) updateDebugSnapshot()
    },
  })
  const {
    capturePreference: captureSubtitlePreference,
    loadWhenPlayable: loadSubtitlesWhenPlayable,
    queueLoad: queueSubtitleLoad,
    reset: resetSubtitles,
    selectSubtitle,
    selectedSubtitle,
    subtitleBackgroundMode,
    subtitleBackgroundOpacity,
    subtitleFontSize,
    subtitleOptions,
    subtitlePosition,
  } = usePlayerSubtitles({ videoElement, getPlayer })
  const {
    markPlaybackSuccessful,
    pause: pauseProgressUpdates,
    persistContext: persistContextProgress,
    requestUpdate: requestThrottledProgressUpdate,
    reset: resetProgressUpdates,
    submitLatest: submitLatestPlaybackProgress,
  } = usePlaybackProgress({ mediaId, currentTime, playbackRate, ready, paused })
  const {
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
  } = usePlayerEpisodeSwitcher({
    context,
    enabled: manifestReady,
    mediaId,
    currentTime,
    playbackRate,
    videoElement,
    isSeries,
    playingSeasonNumber,
    playingEpisodeNumber,
    beforeOpen: () => {
      shareOpen.value = false
    },
    seekTo,
    submitProgress: submitLatestPlaybackProgress,
  })
  const overlayOpen = computed(() => shareOpen.value || episodeSwitcherOpen.value)
  const {
    syncMetadata: syncMediaSessionMetadata,
    syncPosition: syncMediaSessionPosition,
    updatePosition: updateMediaSessionPosition,
  } = usePlayerMediaSession({
    videoElement,
    ready,
    paused,
    title,
    artist: mediaSessionArtist,
    artwork: mediaSessionArtwork,
    canPrevious: canPreviousEpisode,
    canNext: canNextEpisode,
    seekTo,
    playPrevious: () => {
      void switchAdjacentEpisode(-1)
    },
    playNext: () => {
      void switchAdjacentEpisode(1)
    },
  })
  const { start: startHideTimer, stop: stopHideTimer } = useTimeoutFn(
    () => {
      if (!paused.value && !shareOpen.value && !controlsLocked.value) controlsVisible.value = false
    },
    2600,
    { immediate: false },
  )
  const { start: startBufferingNotice, stop: stopBufferingNotice } = useTimeoutFn(
    () => {
      if (ready.value && !paused.value) bufferingVisible.value = true
    },
    450,
    { immediate: false },
  )
  const { pause: pauseNextCountdown, resume: resumeNextCountdown } = useIntervalFn(
    () => {
      if (nextEpisodeCountdown.value <= 1) {
        pauseNextCountdown()
        void playNextEpisode()
        return
      }
      nextEpisodeCountdown.value -= 1
    },
    1000,
    { immediate: false },
  )
  const { pause: pauseDebugUpdates, resume: resumeDebugUpdates } = useIntervalFn(updateDebugSnapshot, 1000, { immediate: false })

  function beginLogin() {
    signStore.rememberReturnPath(route.fullPath)
    window.location.assign(signStore.loginUrl())
  }

  function showControls() {
    controlsVisible.value = true
    stopHideTimer()
    if (!paused.value && !controlsLocked.value) startHideTimer()
  }

  function setControlsLocked(locked: boolean) {
    controlsLocked.value = locked
    if (locked) showControls()
    else if (!paused.value) startHideTimer()
  }

  async function requestPlaybackVersions(videoListId: number, expectedMediaId: string, seasonNumber: number | null, episodeNumber: number | null, partNumber: number | null) {
    const sources = await getMediaSources(videoListId, {
      seasonNumber: seasonNumber ?? undefined,
      episodeNumber: episodeNumber ?? undefined,
      partNumber: partNumber ?? undefined,
    })
    return sources.find((source) => source.versions.some((version) => version.media_id === expectedMediaId))?.versions ?? []
  }

  async function restorePlaybackVersions(nextContext: PlayerContext, expectedLoad: number) {
    try {
      const versions = await requestPlaybackVersions(nextContext.videoListId, nextContext.mediaId, nextContext.seasonNumber, nextContext.episodeNumber, nextContext.partNumber)
      if (expectedLoad !== loadSequence || mediaId.value !== nextContext.mediaId) return
      playbackVersions.value = versions
      if (!versions.length) {
        dataWarning.value = '当前资源未返回可切换的播放版本。'
        return
      }
      const restoredContext = { ...nextContext, ...context.value, versions }
      context.value = restoredContext
      cachePlayerContext(restoredContext)
    } catch {
      if (expectedLoad === loadSequence) dataWarning.value = '播放版本暂时无法恢复。'
    }
  }

  async function restoreContextLogo(nextContext: PlayerContext, expectedLoad: number) {
    try {
      const info = await getVideo(nextContext.todbId)
      if (expectedLoad !== loadSequence || mediaId.value !== nextContext.mediaId) return
      videoInfo.value = info
      const restoredContext = {
        ...nextContext,
        ...context.value,
        logo: imageUrl(info.image_logo, 'w500') ?? null,
      }
      context.value = restoredContext
      cachePlayerContext(restoredContext)
    } catch {
      if (expectedLoad === loadSequence) {
        const restoredContext = { ...nextContext, ...context.value, logo: null }
        context.value = restoredContext
        cachePlayerContext(restoredContext)
      }
    }
  }

  async function switchPlaybackVersion(targetMediaId: string) {
    if (targetMediaId === mediaId.value || versionSwitching.value) return
    const targetVersion = playbackVersions.value.find((version) => version.media_id === targetMediaId)
    const currentContext = context.value
    const video = videoElement.value
    if (!targetVersion || !currentContext || !video) return

    updatePlayerProgress(mediaId.value, currentTime.value)
    submitLatestPlaybackProgress(false, mediaId.value, currentTime.value, playbackRate.value)
    nextLoadShouldAutoplay = Boolean(errorMessage.value) || !video.paused
    nextSubtitlePreference = captureSubtitlePreference()
    nextAudioPreference = selectedAudioId.value
    cachePlayerContext({
      ...currentContext,
      mediaId: targetVersion.media_id,
      mediaName: targetVersion.media_name,
      versions: playbackVersions.value,
      resumeSeconds: currentTime.value,
    })
    versionSwitching.value = true
    try {
      await router.replace({ name: 'player', params: { mediaId: targetVersion.media_id } })
    } catch {
      versionSwitching.value = false
      nextLoadShouldAutoplay = true
      nextSubtitlePreference = undefined
      nextAudioPreference = ''
    }
  }

  function selectPlaybackRate(rate: number) {
    const video = videoElement.value
    if (!video) return
    video.playbackRate = rate
    playbackRate.value = rate
    syncMediaSessionPosition()
  }

  function selectAudioTrack(id: string) {
    if (selectShakaAudioTrack(id)) showControls()
  }

  function getBufferAhead(video: HTMLVideoElement) {
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) >= video.currentTime) {
        return Math.max(0, video.buffered.end(index) - video.currentTime)
      }
    }
    return 0
  }

  function updateDebugSnapshot() {
    const video = videoElement.value
    const shell = playerShell.value
    const stats = getStats()
    if (!video || !stats) return
    const width = Number.isFinite(stats.width) ? stats.width : video.videoWidth
    const height = Number.isFinite(stats.height) ? stats.height : video.videoHeight
    const decodedFrames = Number.isFinite(stats.decodedFrames) ? stats.decodedFrames : 0
    const droppedFrames = Number.isFinite(stats.droppedFrames) ? stats.droppedFrames : 0
    const droppedPercent = decodedFrames > 0 ? (droppedFrames / decodedFrames) * 100 : 0
    const recentDownloadSpeed = Date.now() - lastSegmentDownloadAt.value <= 12_000 ? segmentDownloadBitsPerSecond.value : 0
    debugSnapshot.value = {
      downloadSpeed: formatTransferSpeed(recentDownloadSpeed),
      estimatedBandwidth: formatTransferSpeed(stats.estimatedBandwidth),
      streamBandwidth: formatBitrate(stats.streamBandwidth),
      bufferAhead: `${getBufferAhead(video).toFixed(1)} 秒`,
      viewport: shell ? `${shell.clientWidth} × ${shell.clientHeight}` : '--',
      resolution: width > 0 && height > 0 ? `${width} × ${height}` : '--',
      droppedFrames: `${droppedFrames} / ${decodedFrames} (${droppedPercent.toFixed(2)}%)`,
      codecs: stats.currentCodecs || '--',
      mediaId: mediaId.value,
      mediaName: mediaName.value || '--',
    }
  }

  function handleBufferingStart() {
    if (!ready.value || paused.value) return
    stopBufferingNotice()
    startBufferingNotice()
  }

  function handleBufferingEnd() {
    stopBufferingNotice()
    bufferingVisible.value = false
  }

  function cancelNextCountdown() {
    pauseNextCountdown()
    nextEpisodeCountdown.value = 0
  }

  async function handlePlaybackEnded() {
    updatePlaybackState()
    pauseProgressUpdates()
    submitLatestPlaybackProgress()
    handleBufferingEnd()
    playbackEnded.value = true
    endOverlayDismissed.value = false
    endNextResolving.value = false
    endNextEpisode.value = undefined
    controlsVisible.value = true
    cancelNextCountdown()
    const currentContext = context.value
    if (!currentContext || !canNextEpisode.value || currentContext.seasonNumber == null || currentContext.episodeNumber == null) return
    endNextResolving.value = true
    try {
      if (switcherSeasonNumber.value !== currentContext.seasonNumber || !switcherSources.value.length) {
        await loadSwitcherSeason(currentContext.seasonNumber, currentContext.episodeNumber)
      }
      if (!playbackEnded.value || endOverlayDismissed.value) return
      const nextPlayableNumber = [
        ...new Set(
          switcherSources.value
            .filter((source) => source.episode_number != null && source.episode_number > currentContext.episodeNumber! && source.versions.length)
            .map((source) => source.episode_number!),
        ),
      ].sort((a, b) => a - b)[0]
      endNextEpisode.value = episodeIndex.value.find((episode) => episode.episode_number === nextPlayableNumber)
      if (!endNextEpisode.value) return
      nextEpisodeCountdown.value = 8
      resumeNextCountdown()
    } finally {
      endNextResolving.value = false
    }
  }

  function closeEndOverlay() {
    endOverlayDismissed.value = true
    cancelNextCountdown()
  }

  async function playNextEpisode() {
    cancelNextCountdown()
    endNextResolving.value = false
    playbackEnded.value = false
    endOverlayDismissed.value = false
    await switchAdjacentEpisode(1)
  }

  function replayCurrent() {
    cancelNextCountdown()
    endNextResolving.value = false
    endNextEpisode.value = undefined
    playbackEnded.value = false
    endOverlayDismissed.value = false
    seekTo(0)
    void videoElement.value?.play()
  }

  function togglePlayback() {
    const video = videoElement.value
    if (!video || !ready.value) return
    if (playbackEnded.value) {
      replayCurrent()
      return
    }
    if (video.paused) void video.play()
    else video.pause()
  }

  function toggleMute() {
    const video = videoElement.value
    if (!video) return
    video.muted = !video.muted
    muted.value = video.muted
  }

  function changeVolume(nextVolume: number) {
    const video = videoElement.value
    if (!video) return
    video.volume = nextVolume
    video.muted = nextVolume === 0
    volume.value = nextVolume
    muted.value = video.muted
  }

  function updatePlaybackState() {
    const video = videoElement.value
    if (!video) return
    currentTime.value = video.currentTime || 0
    duration.value = Number.isFinite(video.duration) ? video.duration : 0
    paused.value = video.paused
    volume.value = video.volume
    muted.value = video.muted
    playbackRate.value = video.playbackRate
    bufferedRanges.value =
      duration.value > 0
        ? Array.from({ length: video.buffered.length }, (_, index) => ({
            start: Math.min(100, Math.max(0, (video.buffered.start(index) / duration.value) * 100)),
            end: Math.min(100, Math.max(0, (video.buffered.end(index) / duration.value) * 100)),
          }))
        : []
    if (video.paused) handleBufferingEnd()
  }

  function handlePlaybackPlay() {
    updatePlaybackState()
  }

  function handlePlaybackPlaying() {
    handleBufferingEnd()
    markPlaybackSuccessful()
  }

  function handlePlaybackPause() {
    updatePlaybackState()
    pauseProgressUpdates()
    requestThrottledProgressUpdate()
  }

  function handlePlaybackRateChange() {
    updatePlaybackState()
    requestThrottledProgressUpdate()
  }

  function handlePlaybackSeeked() {
    updatePlaybackState()
    requestThrottledProgressUpdate()
  }

  function handleTimeUpdate() {
    const video = videoElement.value
    if (!video) return
    currentTime.value = video.currentTime
    persistContextProgress()
    updateMediaSessionPosition()
  }

  function seekTo(seconds: number) {
    const video = videoElement.value
    if (!video) return
    if (seconds < duration.value - 0.5) {
      playbackEnded.value = false
      endOverlayDismissed.value = false
      cancelNextCountdown()
    }
    video.currentTime = seconds
    currentTime.value = video.currentTime
    syncMediaSessionPosition()
    requestThrottledProgressUpdate()
  }

  async function toggleFullscreen() {
    if (!playerShell.value) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await playerShell.value.requestFullscreen()
  }

  async function togglePictureInPicture() {
    const video = videoElement.value
    if (!video || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
  }

  function handlePlaybackCanPlay() {
    handleBufferingEnd()
    loadSubtitlesWhenPlayable()
  }

  async function hydrateContext(details: MediaDetail[], playbackManifest: PlaybackManifest, expectedLoad: number) {
    if (context.value) return
    const expectedMediaId = mediaId.value
    const mediaDetail = details.find((item) => item.media_id === mediaId.value) ?? details[0]
    detail.value = mediaDetail
    if (!mediaDetail?.todb_id) {
      dataWarning.value = '资源缺少 TODB 关联，影片信息无法恢复。'
      return
    }
    try {
      const [info, versions] = await Promise.all([
        getVideo(mediaDetail.todb_id),
        requestPlaybackVersions(mediaDetail.video_id, mediaId.value, mediaDetail.season_number, mediaDetail.episode_number, mediaDetail.part_number).catch(() => []),
      ])
      videoInfo.value = info
      let episodeTitle = mediaDetail.episode_title
      if (info.video_type === 'tv') {
        if (mediaDetail.season_number == null || mediaDetail.episode_number == null) {
          dataWarning.value = '剧集资源缺少季集编号，关联数据异常。'
        } else if (!episodeTitle) {
          episodeTitle = (await getEpisode(mediaDetail.todb_id, mediaDetail.season_number, mediaDetail.episode_number).catch(() => undefined))?.episode_title ?? null
        }
      }
      if (expectedLoad !== loadSequence || mediaId.value !== expectedMediaId) return
      const restored: PlayerContext = {
        mediaId: mediaId.value,
        forgeReelUuid: playbackManifest.forge_reel_uuid,
        todbId: mediaDetail.todb_id,
        videoListId: mediaDetail.video_id,
        videoType: info.video_type,
        videoTitle: info.video_title,
        logo: imageUrl(info.image_logo, 'w500') ?? null,
        backdrop: imageUrl(info.image_backdrop) ?? null,
        seasonNumber: mediaDetail.season_number,
        episodeNumber: mediaDetail.episode_number,
        episodeTitle,
        partNumber: mediaDetail.part_number,
        mediaName: mediaDetail.media_name,
        versions,
        resumeSeconds: null,
      }
      playbackVersions.value = versions
      if (!versions.length && !dataWarning.value) dataWarning.value = '当前资源未返回可切换的播放版本。'
      context.value = restored
      cachePlayerContext(restored)
    } catch {
      dataWarning.value = '影片元数据暂时无法恢复。'
    }
  }

  async function destroyPlayer() {
    ready.value = false
    resetSubtitles()
    resetProgressUpdates()
    handleBufferingEnd()
    cancelNextCountdown()
    await destroyShakaPlayer()
  }

  async function loadPlayback() {
    const currentLoad = ++loadSequence
    await destroyPlayer()
    manifestReady.value = false
    context.value = getPlayerContext(mediaId.value)
    playbackVersions.value = context.value?.versions ?? []
    detail.value = undefined
    videoInfo.value = undefined
    manifest.value = undefined
    bufferedRanges.value = []
    playbackEnded.value = false
    endOverlayDismissed.value = false
    endNextResolving.value = false
    endNextEpisode.value = undefined
    errorMessage.value = ''
    latestPlaybackErrorMessage.value = ''
    latestPlaybackErrorUserMessage.value = ''
    manifestNotFound.value = false
    dataWarning.value = ''
    loading.value = true
    if (!signStore.isSignedIn) {
      loading.value = false
      return
    }
    try {
      const supportedCodecs = await getSupportedPlaybackCodecs()
      if (currentLoad !== loadSequence) return
      if (!hasRequiredPlaybackCodecs(supportedCodecs)) {
        errorMessage.value = '暂不支持此设备'
        return
      }
      const playbackManifest = await getPlaybackManifest(mediaId.value, supportedCodecs)
      if (currentLoad !== loadSequence) return
      manifestReady.value = true
      manifest.value = playbackManifest
      if (context.value?.logo === undefined) {
        void restoreContextLogo(context.value, currentLoad)
      }
      if (context.value && !playbackVersions.value.length) {
        void restorePlaybackVersions(context.value, currentLoad)
      }
      const details = context.value ? [] : await getMediaDetails(mediaId.value)
      if (currentLoad !== loadSequence) return
      if (!context.value) void hydrateContext(details, playbackManifest, currentLoad)
      await nextTick()
      const video = videoElement.value
      if (!video) throw new Error('Video element is unavailable')
      const requestedTime = Number(route.query.t)
      const resumeTime = Number.isFinite(requestedTime) && requestedTime >= 0 ? requestedTime : (context.value?.resumeSeconds ?? 0)
      await loadShakaPlayer({
        manifestText: playbackManifest.m3u8_master,
        startTime: resumeTime,
        preferredAudioId: nextAudioPreference,
      })
      nextAudioPreference = ''
      video.playbackRate = playbackRate.value
      ready.value = true
      updatePlaybackState()
      syncMediaSessionMetadata()
      syncMediaSessionPosition()
      const subtitlePreference = nextSubtitlePreference
      nextSubtitlePreference = undefined
      queueSubtitleLoad(playbackManifest, subtitlePreference)
      const shouldAutoplay = nextLoadShouldAutoplay
      nextLoadShouldAutoplay = true
      if (shouldAutoplay) await video.play().catch(() => undefined)
      else video.pause()
      if (currentLoad !== loadSequence) return
    } catch (error) {
      if (currentLoad !== loadSequence) return
      console.error('[EMOS REEL] Playback load failed', error)
      if (error instanceof PlaybackManifestError) {
        if (error.status === 404) {
          manifestNotFound.value = true
          errorMessage.value = '视频地址错误'
          latestPlaybackErrorMessage.value = ''
          return
        }
        errorMessage.value = error.status === 422 && error.responseMessage ? error.responseMessage : `加载播放清单失败 请进行反馈 ${mediaId.value}`
        latestPlaybackErrorMessage.value = ''
        return
      }
      errorMessage.value = latestPlaybackErrorUserMessage.value || fallbackPlaybackErrorMessage
      if (!latestPlaybackErrorMessage.value) latestPlaybackErrorMessage.value = formatUnknownPlaybackError(error, mediaId.value)
    } finally {
      if (currentLoad === loadSequence) {
        loading.value = false
        versionSwitching.value = false
        nextLoadShouldAutoplay = true
      }
    }
  }

  function back() {
    if (context.value?.forgeReelUuid) {
      void router.push({ name: 'video', params: { forgeReelUuid: context.value.forgeReelUuid } })
    } else {
      router.back()
    }
  }

  function returnHome() {
    void router.push({ name: 'home' })
  }

  function handleKeydown(event: KeyboardEvent) {
    if (overlayOpen.value || ['INPUT', 'BUTTON'].includes((event.target as HTMLElement)?.tagName)) return
    if (event.code === 'Space') {
      event.preventDefault()
      showControls()
      togglePlayback()
    } else if (event.key === 'ArrowRight' && videoElement.value) {
      showControls()
      seekTo(Math.min(duration.value, currentTime.value + 10))
    } else if (event.key === 'ArrowLeft' && videoElement.value) {
      showControls()
      seekTo(Math.max(0, currentTime.value - 10))
    } else if (event.key.toLowerCase() === 'm') {
      showControls()
      toggleMute()
    } else if (event.key.toLowerCase() === 'f') {
      showControls()
      void toggleFullscreen()
    }
  }

  useEventListener(document, 'fullscreenchange', () => {
    fullscreen.value = Boolean(document.fullscreenElement)
  })
  useEventListener(document, 'keydown', handleKeydown)
  useEventListener(window, 'pagehide', () => {
    updatePlayerProgress(mediaId.value, currentTime.value)
    submitLatestPlaybackProgress(true)
  })
  watch(mediaId, () => {
    episodeSwitcherOpen.value = false
    void loadPlayback()
  })
  watch(debugVisible, (visible) => {
    if (visible) {
      updateDebugSnapshot()
      resumeDebugUpdates()
    } else {
      pauseDebugUpdates()
    }
  })
  watch(errorMessage, (message) => {
    if (message) debugVisible.value = false
  })
  watch(paused, (isPaused) => {
    if (isPaused) {
      stopHideTimer()
      controlsVisible.value = true
    } else {
      startHideTimer()
    }
  })
  watch(overlayOpen, (open) => setControlsLocked(open))

  onMounted(() => {
    canPictureInPicture.value = Boolean(document.pictureInPictureEnabled)
    void loadPlayback()
  })
  onBeforeUnmount(() => {
    updatePlayerProgress(mediaId.value, currentTime.value)
    pauseProgressUpdates()
    submitLatestPlaybackProgress(true)
    stopHideTimer()
    stopBufferingNotice()
    pauseNextCountdown()
    pauseDebugUpdates()
    void destroyPlayer()
  })
</script>

<template>
  <main ref="playerShell" :class="{ 'controls-hidden': !controlsVisible && ready }" class="player-page" @mousemove="showControls">
    <img v-if="!ready && context?.backdrop" :alt="title" :src="context.backdrop" class="player-backdrop" />
    <div v-if="!ready" class="player-backdrop-shade"></div>

    <video
      ref="videoElement"
      :class="[`subtitle-size-${subtitleFontSize}`, { 'subtitle-background-custom': subtitleBackgroundMode === 'custom' }]"
      :style="{ '--subtitle-background-opacity': String(subtitleBackgroundOpacity) }"
      class="video-surface"
      playsinline
      @canplay="handlePlaybackCanPlay"
      @click="togglePlayback"
      @durationchange="updatePlaybackState"
      @ended="handlePlaybackEnded"
      @loadedmetadata="updatePlaybackState"
      @pause="handlePlaybackPause"
      @play="handlePlaybackPlay"
      @playing="handlePlaybackPlaying"
      @progress="updatePlaybackState"
      @ratechange="handlePlaybackRateChange"
      @seeked="handlePlaybackSeeked"
      @stalled="handleBufferingStart"
      @timeupdate="handleTimeUpdate"
      @volumechange="updatePlaybackState"
      @waiting="handleBufferingStart"></video>

    <div aria-hidden="true" class="player-danmaku-layer"></div>
    <div aria-hidden="true" class="player-chapter-track"></div>

    <header v-if="!manifestNotFound" :class="{ visible: controlsVisible || !ready }" class="player-topbar">
      <div class="player-topbar-leading">
        <button aria-label="返回" class="player-icon" type="button" @click="back"><ChevronLeft :size="24" /></button>
        <img v-if="isSeries && playerLogo" :alt="baseTitle" :src="playerLogo" class="player-series-logo" />
        <strong v-else class="player-title-fallback">{{ baseTitle }}</strong>
        <strong v-if="isSeries && playerLogo" class="player-mobile-title">{{ baseTitle }}</strong>
      </div>
      <div class="player-topbar-actions">
        <button
          v-if="ready && !errorMessage"
          :aria-pressed="debugVisible"
          :class="{ active: debugVisible }"
          aria-label="播放信息"
          class="player-icon"
          type="button"
          @click="debugVisible = !debugVisible">
          <Activity :size="20" />
        </button>
        <button v-if="isSeries && context" aria-label="选集" class="player-icon" type="button" @click="openEpisodeSwitcher"><ListVideo :size="21" /></button>
        <button aria-label="分享" class="player-icon" type="button" @click="shareOpen = true"><Share2 :size="20" /></button>
      </div>
    </header>

    <PlayerDebugPanel v-if="debugVisible && ready && !errorMessage" :snapshot="debugSnapshot" @close="debugVisible = false" />
    <div v-if="bufferingVisible" :class="{ 'above-now-playing': showNowPlaying }" class="buffering-notice">
      <LoaderCircle :size="15" class="animate-spin" />
      <span>缓冲中</span>
      <small v-if="segmentDownloadBitsPerSecond > 0 && Date.now() - lastSegmentDownloadAt <= 12_000">最近 {{ formatTransferSpeed(segmentDownloadBitsPerSecond) }}</small>
    </div>

    <section v-if="!signStore.isSignedIn" class="player-message">
      <LockKeyhole :size="28" />
      <h1>请登录后再进行观看</h1>
      <button class="primary-button" type="button" @click="beginLogin">登录</button>
    </section>
    <section v-else-if="loading" class="player-message">
      <LoaderCircle :size="26" class="animate-spin" />
      <span>正在打开放映厅</span>
    </section>
    <section v-else-if="errorMessage" class="player-message player-error">
      <div class="player-error-heading">
        <AlertCircle :size="27" />
        <h1>{{ errorMessage }}</h1>
      </div>
      <p v-if="latestPlaybackErrorMessage" class="player-error-cause">{{ latestPlaybackErrorMessage }}</p>
      <div v-if="manifestNotFound" class="player-error-actions">
        <button class="primary-button" type="button" @click="returnHome">
          <House :size="17" />
          返回主页
        </button>
      </div>
      <div v-else :class="{ 'has-version-switcher': playbackVersions.length > 1 }" class="player-error-actions">
        <button class="primary-button" type="button" @click="loadPlayback">
          <RotateCw :size="17" />
          重新载入
        </button>
        <PlayerErrorVersionPicker v-if="playbackVersions.length > 1" :selected-media-id="mediaId" :switching="versionSwitching" :versions="playbackVersions" @select="switchPlaybackVersion" />
        <a class="secondary-button" href="https://voice.somebyte.org/project/250823" rel="noopener noreferrer" target="_blank">
          <ExternalLink :size="17" />
          反馈问题
        </a>
      </div>
    </section>

    <button
      v-if="ready && !errorMessage && paused && (!playbackEnded || endOverlayDismissed)"
      :aria-label="playbackEnded ? '重新播放' : '播放'"
      class="center-play"
      type="button"
      @click="togglePlayback">
      <RotateCw v-if="playbackEnded" :size="28" />
      <Play v-else :size="30" fill="currentColor" />
    </button>

    <PlayerEndOverlay
      v-if="!errorMessage && playbackEnded && !endOverlayDismissed"
      :countdown="nextEpisodeCountdown"
      :episode-label="endNextEpisodeLabel"
      :episode-title="endNextEpisode?.episode_title || ''"
      :has-next="Boolean(endNextEpisode)"
      :resolving="endNextResolving"
      @close="closeEndOverlay"
      @next="playNextEpisode"
      @replay="replayCurrent" />

    <PlayerControls
      v-if="ready && !errorMessage"
      :audio-tracks="audioOptions"
      :buffered-ranges="bufferedRanges"
      :can-next-episode="canNextEpisode"
      :can-picture-in-picture="canPictureInPicture"
      :can-previous-episode="canPreviousEpisode"
      :current-time="currentTime"
      :duration="duration"
      :fullscreen="fullscreen"
      :muted="muted"
      :now-playing-meta="nowPlayingMeta"
      :now-playing-title="nowPlayingTitle"
      :paused="paused"
      :playback-rate="playbackRate"
      :selected-audio="selectedAudioId"
      :selected-media-id="mediaId"
      :selected-subtitle="selectedSubtitle"
      :show-episode-navigation="isSeries"
      :show-now-playing="showNowPlaying"
      :sprites="manifest?.sprites ?? []"
      :subtitle-background-mode="subtitleBackgroundMode"
      :subtitle-background-opacity="subtitleBackgroundOpacity"
      :subtitle-font-size="subtitleFontSize"
      :subtitle-position="subtitlePosition"
      :subtitles="subtitleOptions"
      :switching-version="versionSwitching"
      :versions="playbackVersions"
      :visible="controlsVisible"
      :volume="volume"
      @fullscreen="toggleFullscreen"
      @interact="showControls"
      @seek="seekTo"
      @lock-controls="setControlsLocked"
      @toggle-playback="togglePlayback"
      @previous-episode="switchAdjacentEpisode(-1)"
      @next-episode="switchAdjacentEpisode(1)"
      @toggle-mute="toggleMute"
      @change-volume="changeVolume"
      @select-subtitle="selectSubtitle"
      @change-subtitle-font-size="subtitleFontSize = $event"
      @change-subtitle-background-mode="subtitleBackgroundMode = $event"
      @change-subtitle-background="subtitleBackgroundOpacity = $event"
      @change-subtitle-position="subtitlePosition = $event"
      @select-media="switchPlaybackVersion"
      @select-rate="selectPlaybackRate"
      @select-audio="selectAudioTrack"
      @picture-in-picture="togglePictureInPicture" />

    <p v-if="dataWarning" class="data-warning">
      <AlertCircle :size="14" />
      {{ dataWarning }}
    </p>
    <ShareDialog :current-time="currentTime" :open="shareOpen" :title="shareTitle" @close="shareOpen = false" />
    <PlayerEpisodeSwitcher
      :active-episode-title="switcherSelectedEpisode?.episode_title || ''"
      :available-episode-numbers="availableEpisodeNumbers"
      :episode-loading="episodeSwitcherLoading"
      :episodes="switcherEpisodes"
      :open="episodeSwitcherOpen"
      :part-sources="switcherPartSources"
      :playing-episode-number="playingEpisodeNumber"
      :playing-season-number="playingSeasonNumber"
      :resource-error="episodeResourceError"
      :resource-loading="episodeResourceLoading"
      :resource-resolved="!episodeResourceLoading && !episodeResourceError"
      :seasons="switcherSeasons"
      :selected-episode-number="switcherEpisodeNumber"
      :selected-media-id="switcherMediaId"
      :selected-part-number="switcherPartNumber"
      :selected-season-number="switcherSeasonNumber"
      :sources="switcherSources"
      :switching="episodeSwitching"
      :title="baseTitle"
      :versions="switcherVersions"
      @close="episodeSwitcherOpen = false"
      @switch="switchSelectedEpisode"
      @select-season="loadSwitcherSeason($event)"
      @select-episode="selectSwitcherEpisode"
      @select-part="selectSwitcherPart"
      @select-media="switcherMediaId = $event" />
  </main>
</template>

<style scoped>
  .player-page {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #000;
    color: white;
    cursor: default;
  }
  .player-page.controls-hidden {
    cursor: none;
  }
  .video-surface {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #000;
    object-fit: contain;
  }
  .video-surface.subtitle-background-custom::cue {
    background-color: rgb(0 0 0 / var(--subtitle-background-opacity, 0.72));
    color: white;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }
  .video-surface.subtitle-size-small::cue {
    font-size: 20px;
  }
  .video-surface.subtitle-size-medium::cue {
    font-size: 28px;
  }
  .video-surface.subtitle-size-large::cue {
    font-size: 42px;
  }
  .player-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: saturate(0.55);
    opacity: 0.55;
  }
  .player-backdrop-shade {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(16px);
  }
  .player-danmaku-layer,
  .player-chapter-track {
    position: absolute;
    z-index: 2;
    inset: 0;
    pointer-events: none;
  }
  .player-topbar {
    position: absolute;
    z-index: 8;
    top: 0;
    right: 0;
    left: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 22px;
    padding: 22px clamp(14px, 3vw, 38px) 72px;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.84), transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
  }
  .player-topbar.visible {
    opacity: 1;
    pointer-events: auto;
  }
  .player-topbar-leading {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: flex-start;
    gap: 14px;
  }
  .player-series-logo {
    display: block;
    width: min(300px, 32vw);
    height: auto;
    max-height: 110px;
    object-fit: contain;
    object-position: left top;
    filter: drop-shadow(0 7px 24px rgba(0, 0, 0, 0.72));
  }
  .player-title-fallback,
  .player-mobile-title {
    min-width: 0;
    overflow: hidden;
    margin-top: 8px;
    font-size: 20px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .player-mobile-title {
    display: none;
  }
  .player-topbar-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
  }
  .player-icon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: white;
  }
  .player-icon:hover,
  .player-icon.active {
    background: rgba(255, 255, 255, 0.12);
  }
  .player-message {
    position: absolute;
    z-index: 5;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    padding: 24px;
    color: rgba(255, 255, 255, 0.68);
    text-align: center;
  }
  .player-message h1 {
    margin: 0;
    color: white;
    font-size: 24px;
  }
  .player-error {
    z-index: 7;
    background: rgba(0, 0, 0, 0.66);
    backdrop-filter: blur(8px);
  }
  .player-error-heading {
    display: flex;
    width: min(900px, 92vw);
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .player-error-heading svg {
    flex: 0 0 auto;
  }
  .player-error-heading h1 {
    min-width: 0;
    overflow-wrap: anywhere;
    line-height: 1.45;
  }
  .player-error-cause {
    width: min(760px, 88vw);
    margin: -3px 0 1px;
    color: rgba(255, 255, 255, 0.62);
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .player-error-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .center-play {
    position: absolute;
    z-index: 6;
    top: 50%;
    left: 50%;
    display: grid;
    width: 66px;
    height: 66px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.32);
    border-radius: 50%;
    background: rgba(10, 10, 12, 0.56);
    color: white;
    transform: translate(-50%, -50%);
    backdrop-filter: blur(12px);
  }
  .center-play:hover {
    background: rgba(57, 130, 125, 0.86);
  }
  .buffering-notice {
    position: absolute;
    z-index: 7;
    bottom: 92px;
    left: clamp(13px, 3vw, 36px);
    display: flex;
    min-height: 34px;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 4px;
    background: rgba(14, 15, 17, 0.78);
    color: rgba(255, 255, 255, 0.82);
    backdrop-filter: blur(8px);
    font-size: 12px;
    line-height: 1;
    pointer-events: none;
  }
  .buffering-notice.above-now-playing {
    bottom: 164px;
  }
  .buffering-notice small {
    padding-left: 3px;
    color: var(--reel-accent-soft);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .data-warning {
    position: absolute;
    z-index: 10;
    right: 18px;
    top: 94px;
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid rgba(220, 138, 132, 0.32);
    border-radius: 4px;
    background: var(--reel-danger-surface);
    color: rgba(255, 255, 255, 0.92);
    font-size: 13px;
  }
  @media (max-width: 620px) {
    .video-surface.subtitle-size-small::cue {
      font-size: 16px;
    }
    .video-surface.subtitle-size-medium::cue {
      font-size: 22px;
    }
    .video-surface.subtitle-size-large::cue {
      font-size: 30px;
    }
    .player-topbar {
      gap: 8px;
      padding: 12px 8px 48px;
    }
    .player-topbar-leading {
      min-width: 0;
      align-items: center;
      gap: 5px;
    }
    .player-series-logo {
      display: none;
    }
    .player-title-fallback,
    .player-mobile-title {
      display: block;
      margin-top: 0;
      font-size: 15px;
    }
    .player-message h1 {
      font-size: 20px;
    }
    .player-error-cause {
      font-size: 11px;
    }
    .player-error-actions {
      display: grid;
      width: min(300px, 100%);
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .player-error-actions > .primary-button {
      grid-column: 1 / -1;
      width: 100%;
    }
    .player-error-actions > .secondary-button {
      grid-column: 1 / -1;
      width: 100%;
    }
    .player-error-actions.has-version-switcher > .secondary-button {
      grid-column: auto;
    }
    .data-warning {
      font-size: 11px;
    }
    .buffering-notice,
    .buffering-notice.above-now-playing {
      bottom: 120px;
      left: 8px;
      min-height: 30px;
      font-size: 11px;
    }
    .player-icon {
      width: 40px;
      height: 40px;
    }
  }
</style>
