<script lang="ts" setup>
  import { Activity, AlertCircle, ChevronLeft, ListVideo, LoaderCircle, LockKeyhole, Play, RotateCw, Share2 } from '@lucide/vue'
  import { useEventListener, useIntervalFn, useSessionStorage, useTimeoutFn } from '@vueuse/core'
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import PlayerControls from '@/components/PlayerControls.vue'
  import PlayerDebugPanel from '@/components/PlayerDebugPanel.vue'
  import PlayerEndOverlay from '@/components/PlayerEndOverlay.vue'
  import PlayerErrorOverlay from '@/components/PlayerErrorOverlay.vue'
  import PlayerEpisodeSwitcher from '@/components/PlayerEpisodeSwitcher.vue'
  import ShareDialog from '@/components/ShareDialog.vue'
  import { usePlaybackEngine } from '@/composables/usePlaybackEngine'
  import { usePlaybackProgress } from '@/composables/usePlaybackProgress'
  import { usePlayerBuffering } from '@/composables/usePlayerBuffering'
  import { usePlayerContextHydration } from '@/composables/usePlayerContextHydration'
  import { usePlayerDebug } from '@/composables/usePlayerDebug'
  import { usePlayerKeyboardShortcuts } from '@/composables/usePlayerKeyboardShortcuts'
  import { usePlayerEpisodeSwitcher } from '@/composables/usePlayerEpisodeSwitcher'
  import { usePlayerMediaSession } from '@/composables/usePlayerMediaSession'
  import { usePlayerPresentation } from '@/composables/usePlayerPresentation'
  import { type SubtitlePreference, usePlayerSubtitles } from '@/composables/usePlayerSubtitles'
  import { getPlaybackManifest, PlaybackManifestError } from '@/api/emos'
  import type { EpisodeInfo, MediaDetail, MediaVersion, PlaybackManifest, VideoInfo } from '@/api/types'
  import { useSignStore } from '@/stores/sign'
  import type { PlaybackDecoderMode } from '@/types/player'
  import { getDolbyVisionPlaybackSupport, getSupportedPlaybackCodecs } from '@/utils/media-codecs'
  import { isDolbyVisionMediaVersion } from '@/utils/media-metadata'
  import { concretePlaybackErrorMessage, fallbackPlaybackErrorMessage, formatUnknownPlaybackError } from '@/utils/player-errors'
  import { cachePlayerContext, getPlayerContext, type PlayerContext, updatePlayerProgress } from '@/utils/player-context'

  const route = useRoute()
  const router = useRouter()
  const signStore = useSignStore()
  const mediaId = computed(() => String(route.params.mediaId || ''))
  const videoElement = ref<HTMLVideoElement>()
  const libmediaContainer = ref<HTMLDivElement>()
  const playerShell = ref<HTMLElement>()
  const context = ref<PlayerContext>()
  const detail = ref<MediaDetail>()
  const videoInfo = ref<VideoInfo>()
  const manifest = ref<PlaybackManifest>()
  const manifestReady = ref(false)
  const loading = ref(false)
  const loadingStatus = ref('正在准备播放器')
  const ready = ref(false)
  const errorMessage = ref('')
  const latestPlaybackErrorMessage = ref('')
  const latestPlaybackErrorUserMessage = ref('')
  const manifestNotFound = ref(false)
  const dataWarning = ref('')
  const decoderMode = useSessionStorage<PlaybackDecoderMode>('emos_reel.player.decoder_mode', 'webcodecs')
  const controlsVisible = ref(true)
  const controlsLocked = ref(false)
  const playbackVersions = ref<MediaVersion[]>([])
  const dolbyVisionPlaybackSupported = ref<boolean | null>(null)
  const hasDolbyVisionVersion = computed(() => playbackVersions.value.some(isDolbyVisionMediaVersion))
  const versionSwitching = ref(false)
  const debugVisible = ref(false)
  const playbackEnded = ref(false)
  const endOverlayDismissed = ref(false)
  const endNextResolving = ref(false)
  const endNextEpisode = ref<EpisodeInfo>()
  const nextEpisodeCountdown = ref(0)
  const shareOpen = ref(false)
  const fullscreen = ref(false)
  let loadSequence = 0
  let nextLoadShouldAutoplay = true
  let nextSubtitlePreference: SubtitlePreference
  let nextAudioPreference = ''
  let dolbyVisionSupportRequested = false
  const manifestFallbackMessage = '暂时无法获取视频地址，请稍后重试'
  let handleDebugStatsChanged = () => {}
  let handleBufferingStart = () => {}
  let handleBufferingEnd = () => {}
  let stopBufferingNotice = () => {}

  const {
    baseTitle,
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
  } = usePlayerPresentation({
    context,
    detail,
    mediaId,
    manifest,
    playbackVersions,
    videoInfo,
  })
  const endNextEpisodeLabel = computed(() => (endNextEpisode.value ? `第 ${endNextEpisode.value.episode_number} 集` : ''))
  const {
    audioOptions,
    bufferedRanges,
    canPictureInPicture,
    currentTime,
    destroy: destroyPlaybackEngine,
    duration,
    engineKind,
    getDebugStats,
    getLibmediaPlayer,
    getShakaPlayer,
    lastCacheReadAt,
    lastMediaReadAt,
    lastSegmentDownloadAt,
    load: loadPlaybackEngine,
    mediaReadSource,
    muted,
    pause: pauseMedia,
    paused,
    play: playMedia,
    playbackRate,
    playableBufferAhead,
    resetStoredMediaRanges,
    seek: seekMedia,
    seeking,
    segmentDownloadBitsPerSecond,
    selectAudioTrack: selectEngineAudioTrack,
    selectedAudioId,
    setPlaybackRate,
    setVolume,
    streamCatchingUp,
    streamCatchUpSeconds,
    toggleMute: toggleEngineMute,
    togglePictureInPicture: toggleEnginePictureInPicture,
    togglePlayback: toggleEnginePlayback,
    volume,
  } = usePlaybackEngine({
    videoElement,
    libmediaContainer,
    decoderMode,
    getToken: () => signStore.user_token,
    onCanPlay: handlePlaybackCanPlay,
    onEnded: () => {
      void handlePlaybackEnded()
    },
    onError: ({ technicalMessage, userMessage, critical }) => {
      latestPlaybackErrorMessage.value = technicalMessage
      latestPlaybackErrorUserMessage.value = userMessage
      if (!critical) return
      errorMessage.value = userMessage
      if (loading.value) {
        loading.value = false
        versionSwitching.value = false
      }
    },
    onLoadStatus: (status) => {
      loadingStatus.value = status
    },
    onPause: handlePlaybackPause,
    onPlaying: handlePlaybackPlaying,
    onSeeked: handlePlaybackSeeked,
    onStatsChanged: () => handleDebugStatsChanged(),
    onTimeUpdate: handleTimeUpdate,
    onWaiting: () => handleBufferingStart(),
  })
  const {
    cacheClearing,
    clearDebugMediaCache,
    debugSnapshot,
    handleStatsChanged,
    stop: stopDebugUpdates,
  } = usePlayerDebug({
    visible: debugVisible,
    playerShell,
    mediaId,
    mediaName,
    storageLocation,
    lastCacheReadAt,
    lastMediaReadAt,
    lastSegmentDownloadAt,
    mediaReadSource,
    segmentDownloadBitsPerSecond,
    streamCatchingUp,
    streamCatchUpSeconds,
    getDebugStats,
    resetStoredMediaRanges,
  })
  handleDebugStatsChanged = handleStatsChanged
  const {
    bufferingDetail,
    bufferingVisible,
    handleBufferingEnd: handleBufferingEndImpl,
    handleBufferingStart: handleBufferingStartImpl,
    stopBufferingNotice: stopBufferingNoticeImpl,
  } = usePlayerBuffering({
    ready,
    paused,
    seeking,
    bufferAhead: playableBufferAhead,
    lastCacheReadAt,
    lastMediaReadAt,
    lastSegmentDownloadAt,
    mediaReadSource,
    segmentDownloadBitsPerSecond,
    streamCatchingUp,
    streamCatchUpSeconds,
  })
  handleBufferingEnd = handleBufferingEndImpl
  handleBufferingStart = handleBufferingStartImpl
  stopBufferingNotice = stopBufferingNoticeImpl
  const {
    subtitleError,
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
  } = usePlayerSubtitles({
    videoElement,
    engineKind,
    getShakaPlayer,
    getLibmediaPlayer,
  })
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
    isSeries,
    playingSeasonNumber,
    playingEpisodeNumber,
    beforeOpen: () => {
      shareOpen.value = false
    },
    seekTo,
    play: () => {
      runPlaybackAction(playMedia(), '暂时无法播放，请重试')
    },
    submitProgress: submitLatestPlaybackProgress,
  })
  const overlayOpen = computed(() => shareOpen.value || episodeSwitcherOpen.value)
  const {
    syncMetadata: syncMediaSessionMetadata,
    syncPosition: syncMediaSessionPosition,
    updatePosition: updateMediaSessionPosition,
  } = usePlayerMediaSession({
    ready,
    paused,
    currentTime,
    duration,
    playbackRate,
    title,
    artist: mediaSessionArtist,
    canPrevious: canPreviousEpisode,
    canNext: canNextEpisode,
    seekTo,
    play: () => {
      runPlaybackAction(playMedia(), '暂时无法播放，请重试')
    },
    pause: () => {
      runPlaybackAction(pauseMedia(), '暂时无法暂停，请重试')
    },
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
  function isCurrentLoad(expectedLoad: number, expectedMediaId = mediaId.value) {
    return expectedLoad === loadSequence && mediaId.value === expectedMediaId
  }
  const { hydrateContext, needsArtworkRefresh, requestPlaybackDetails, restoreContextArtwork, restorePlaybackVersions } = usePlayerContextHydration({
    context,
    dataWarning,
    detail,
    isCurrentLoad,
    mediaId,
    playbackVersions,
    videoInfo,
  })

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

  async function switchPlaybackVersion(targetMediaId: string) {
    if (targetMediaId === mediaId.value || versionSwitching.value) return
    const targetVersion = playbackVersions.value.find((version) => version.media_id === targetMediaId)
    const currentContext = context.value
    if (!targetVersion || !currentContext) return

    updatePlayerProgress(mediaId.value, currentTime.value)
    submitLatestPlaybackProgress(false, mediaId.value, currentTime.value, playbackRate.value)
    nextLoadShouldAutoplay = Boolean(errorMessage.value) || !paused.value
    nextSubtitlePreference = captureSubtitlePreference()
    nextAudioPreference = engineKind.value === 'shaka' ? selectedAudioId.value : ''
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
    setPlaybackRate(rate)
    syncMediaSessionPosition()
    requestThrottledProgressUpdate()
  }

  function selectAudioTrack(id: string) {
    runPlaybackAction(
      selectEngineAudioTrack(id).then((selected) => {
        if (selected) showControls()
      }),
      '暂时无法切换声音，请重试',
    )
  }

  function selectDecoderMode(mode: PlaybackDecoderMode) {
    if (decoderMode.value === mode) return
    decoderMode.value = mode
    const shouldReload = engineKind.value === 'libmedia' || manifest.value?.play_type === 'proxy'
    dataWarning.value = mode === 'webcodecs' ? '已切到硬解' : '已切到软解'
    if (shouldReload) dataWarning.value += '，正在重新载入当前视频'
    if (shouldReload) {
      nextLoadShouldAutoplay = Boolean(errorMessage.value) || !paused.value
      void loadPlayback()
    }
  }

  async function ensureDolbyVisionPlaybackSupport() {
    if (dolbyVisionSupportRequested) return
    dolbyVisionSupportRequested = true
    dolbyVisionPlaybackSupported.value = await getDolbyVisionPlaybackSupport()
  }

  function handlePlaybackActionError(error: unknown, userMessage: string) {
    const technicalMessage = formatUnknownPlaybackError(error, mediaId.value)
    if (errorMessage.value && latestPlaybackErrorMessage.value === technicalMessage) return
    latestPlaybackErrorMessage.value = technicalMessage
    latestPlaybackErrorUserMessage.value = userMessage
    errorMessage.value = userMessage
  }

  function runPlaybackAction(action: Promise<unknown>, userMessage: string) {
    void action.catch((error) => {
      handlePlaybackActionError(error, userMessage)
    })
  }

  function cancelNextCountdown() {
    pauseNextCountdown()
    nextEpisodeCountdown.value = 0
  }

  async function handlePlaybackEnded() {
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
    runPlaybackAction(playMedia(), '暂时无法播放，请重试')
  }

  function togglePlayback() {
    if (!ready.value) return
    if (playbackEnded.value) {
      replayCurrent()
      return
    }
    runPlaybackAction(toggleEnginePlayback(), paused.value ? '暂时无法播放，请重试' : '暂时无法暂停，请重试')
  }

  function toggleMute() {
    toggleEngineMute()
  }

  function changeVolume(nextVolume: number) {
    setVolume(nextVolume)
  }

  function handlePlaybackPlaying() {
    handleBufferingEnd()
    markPlaybackSuccessful()
  }

  function handlePlaybackPause() {
    handleBufferingEnd()
    pauseProgressUpdates()
    requestThrottledProgressUpdate()
  }

  function handlePlaybackSeeked() {
    handleBufferingEnd()
    requestThrottledProgressUpdate()
  }

  function handleTimeUpdate() {
    persistContextProgress()
    updateMediaSessionPosition()
  }

  function seekTo(seconds: number) {
    if (seconds < duration.value - 0.5) {
      playbackEnded.value = false
      endOverlayDismissed.value = false
      cancelNextCountdown()
    }
    void seekMedia(seconds).catch((error) => {
      handleBufferingEnd()
      latestPlaybackErrorMessage.value = formatUnknownPlaybackError(error, mediaId.value)
    })
    syncMediaSessionPosition()
    requestThrottledProgressUpdate()
  }

  async function toggleFullscreen() {
    if (!playerShell.value) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await playerShell.value.requestFullscreen()
  }

  async function togglePictureInPicture() {
    await toggleEnginePictureInPicture()
  }

  function handlePlaybackCanPlay() {
    handleBufferingEnd()
    if (engineKind.value === 'shaka') loadSubtitlesWhenPlayable()
  }

  function manifestErrorMessage(error: PlaybackManifestError) {
    if (error.responseMessage) return error.responseMessage
    if (error.status === 404) return '没有找到这个视频'
    return manifestFallbackMessage
  }

  async function destroyPlayer() {
    ready.value = false
    resetSubtitles()
    resetProgressUpdates()
    handleBufferingEnd()
    cancelNextCountdown()
    await destroyPlaybackEngine()
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
    loadingStatus.value = '正在确认当前设备能否播放'
    if (!signStore.isSignedIn) {
      loading.value = false
      return
    }
    try {
      const detailsRequest = context.value ? Promise.resolve<MediaDetail[]>([]) : requestPlaybackDetails(currentLoad, mediaId.value)
      const supportedCodecs = await getSupportedPlaybackCodecs()
      if (currentLoad !== loadSequence) return
      loadingStatus.value = '正在获取视频地址'
      const playbackManifest = await getPlaybackManifest(mediaId.value, supportedCodecs)
      if (currentLoad !== loadSequence) return
      manifestReady.value = true
      manifest.value = playbackManifest
      if (context.value && needsArtworkRefresh(context.value)) {
        void restoreContextArtwork(context.value, currentLoad)
      }
      if (context.value && !playbackVersions.value.length) {
        void restorePlaybackVersions(context.value, currentLoad)
      }
      loadingStatus.value = '正在读取影片资料'
      const details = context.value ? [] : await detailsRequest
      if (currentLoad !== loadSequence) return
      if (!context.value) void hydrateContext(details, playbackManifest, currentLoad)
      await nextTick()
      const requestedTime = Number(route.query.t)
      const resumeTime = Number.isFinite(requestedTime) && requestedTime >= 0 ? requestedTime : (context.value?.resumeSeconds ?? 0)
      await loadPlaybackEngine({
        cacheKey: mediaId.value,
        manifest: playbackManifest,
        startTime: resumeTime,
        preferredAudioId: nextAudioPreference,
      })
      nextAudioPreference = ''
      loadingStatus.value = '马上就可以播放了'
      const subtitlePreference = nextSubtitlePreference
      nextSubtitlePreference = undefined
      queueSubtitleLoad(playbackManifest, subtitlePreference)
      const shouldAutoplay = nextLoadShouldAutoplay
      nextLoadShouldAutoplay = true
      if (engineKind.value === 'libmedia') loadingStatus.value = '点击播放'
      else if (shouldAutoplay) await playMedia()
      else await pauseMedia()
      if (currentLoad !== loadSequence) return
      ready.value = true
      syncMediaSessionMetadata()
      syncMediaSessionPosition()
      loadSubtitlesWhenPlayable()
    } catch (error) {
      if (currentLoad !== loadSequence) return
      console.error('[EMOS REEL] Playback load failed', error)
      if (error instanceof PlaybackManifestError) {
        if (error.status === 404) {
          manifestNotFound.value = true
        }
        errorMessage.value = manifestErrorMessage(error)
        latestPlaybackErrorMessage.value = ''
        loading.value = false
        versionSwitching.value = false
        return
      }
      const playbackErrorMessage = concretePlaybackErrorMessage(error) || latestPlaybackErrorUserMessage.value || fallbackPlaybackErrorMessage
      const technicalMessage = latestPlaybackErrorMessage.value || formatUnknownPlaybackError(error, mediaId.value)
      errorMessage.value = playbackErrorMessage
      latestPlaybackErrorMessage.value = technicalMessage
      loading.value = false
      versionSwitching.value = false
      void destroyPlayer().catch((destroyError: unknown) => {
        console.error('[EMOS REEL] Playback destroy failed after load error', destroyError)
      })
    } finally {
      if (currentLoad === loadSequence) {
        loading.value = false
        versionSwitching.value = false
        nextLoadShouldAutoplay = true
      }
    }
  }

  function back() {
    const videoRouteId = context.value?.forgeReelUuid ?? context.value?.videoRouteId
    if (videoRouteId) {
      void router.push({ name: 'video', params: { forgeReelUuid: videoRouteId } })
    } else {
      router.back()
    }
  }

  function returnHome() {
    void router.push({ name: 'home' })
  }

  usePlayerKeyboardShortcuts({
    currentTime: () => currentTime.value,
    duration: () => duration.value,
    isOverlayOpen: () => overlayOpen.value,
    isReady: () => ready.value,
    seekTo,
    showControls,
    toggleFullscreen,
    toggleMute,
    togglePlayback,
  })
  useEventListener(document, 'fullscreenchange', () => {
    fullscreen.value = Boolean(document.fullscreenElement)
  })
  useEventListener(window, 'pagehide', () => {
    updatePlayerProgress(mediaId.value, currentTime.value)
    submitLatestPlaybackProgress(true)
  })
  watch(mediaId, () => {
    episodeSwitcherOpen.value = false
    void loadPlayback()
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
  watch(
    hasDolbyVisionVersion,
    (hasDolbyVision) => {
      if (hasDolbyVision) void ensureDolbyVisionPlaybackSupport()
    },
    { immediate: true },
  )

  onMounted(() => {
    void loadPlayback()
  })
  onBeforeUnmount(() => {
    updatePlayerProgress(mediaId.value, currentTime.value)
    pauseProgressUpdates()
    submitLatestPlaybackProgress(true)
    stopHideTimer()
    stopBufferingNotice()
    pauseNextCountdown()
    stopDebugUpdates()
    void destroyPlayer()
  })
</script>

<template>
  <main ref="playerShell" :class="{ 'controls-hidden': !controlsVisible && ready }" class="player-page" @mousemove="showControls">
    <img v-if="!ready && playerBackdropSource" :alt="title" :src="playerBackdropSource" class="player-backdrop" />
    <div v-if="!ready" class="player-backdrop-shade"></div>

    <video
      v-show="engineKind === 'shaka'"
      ref="videoElement"
      :class="[`subtitle-size-${subtitleFontSize}`, { 'subtitle-background-custom': subtitleBackgroundMode === 'custom' }]"
      :style="{ '--subtitle-background-opacity': String(subtitleBackgroundOpacity) }"
      class="video-surface"
      playsinline
      @click="togglePlayback"></video>
    <div v-show="engineKind === 'libmedia'" ref="libmediaContainer" class="libmedia-surface" @click="togglePlayback"></div>

    <div aria-hidden="true" class="player-danmaku-layer"></div>
    <div aria-hidden="true" class="player-chapter-track"></div>

    <header v-if="!manifestNotFound" :class="{ visible: controlsVisible || !ready }" class="player-topbar">
      <div class="player-topbar-leading">
        <button aria-label="返回" class="player-icon" type="button" @click="back"><ChevronLeft :size="24" /></button>
        <img v-if="isSeries && playerLogoSource" :alt="baseTitle" :src="playerLogoSource" class="player-series-logo" />
        <strong v-else class="player-title-fallback">{{ baseTitle }}</strong>
        <strong v-if="isSeries && playerLogoSource" class="player-mobile-title">{{ baseTitle }}</strong>
      </div>
      <div class="player-topbar-actions">
        <button
          v-if="signStore.isSignedIn"
          :title="decoderMode === 'webcodecs' ? '当前：硬解 可点击切换软解' : '当前：软解 可点击切换硬解'"
          aria-label="切换解码方式"
          class="player-icon decoder-mode-button"
          type="button"
          @click="selectDecoderMode(decoderMode === 'webcodecs' ? 'wasm' : 'webcodecs')">
          {{ decoderMode === 'webcodecs' ? 'HW' : 'SW' }}
        </button>
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

    <PlayerDebugPanel v-if="debugVisible && ready && !errorMessage" :cache-clearing="cacheClearing" :snapshot="debugSnapshot" @close="debugVisible = false" @clear-cache="clearDebugMediaCache" />
    <div v-if="subtitleError" class="subtitle-error-notice" role="status">{{ subtitleError }}</div>
    <div v-if="bufferingVisible" :class="{ 'above-now-playing': showNowPlaying }" class="buffering-notice" role="status">
      <LoaderCircle :size="15" class="animate-spin" />
      <span>{{ seeking ? '正在加载所选位置' : '正在继续加载视频' }}</span>
      <small v-if="bufferingDetail">{{ bufferingDetail }}</small>
    </div>

    <section v-if="!signStore.isSignedIn" class="player-message">
      <LockKeyhole :size="28" />
      <h1>请登录后再进行观看</h1>
      <button class="primary-button" type="button" @click="beginLogin">登录</button>
    </section>
    <section v-else-if="loading" class="player-message">
      <LoaderCircle :size="26" class="animate-spin" />
      <span>正在打开放映厅</span>
      <small class="loading-status">{{ loadingStatus }}</small>
    </section>
    <PlayerErrorOverlay
      v-else-if="errorMessage"
      :manifest-not-found="manifestNotFound"
      :message="errorMessage"
      :selected-media-id="mediaId"
      :switching-version="versionSwitching"
      :technical-message="latestPlaybackErrorMessage"
      :versions="playbackVersions"
      @reload="loadPlayback"
      @return-home="returnHome"
      @select-version="switchPlaybackVersion" />

    <button
      v-if="ready && !errorMessage && paused && !seeking && (!playbackEnded || endOverlayDismissed)"
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
      :debug-mode="debugVisible"
      :dolby-vision-supported="dolbyVisionPlaybackSupported"
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
      :subtitle-appearance-enabled="engineKind === 'shaka'"
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
    isolation: isolate;
  }
  .player-page.controls-hidden {
    cursor: none;
  }
  .video-surface,
  .libmedia-surface {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #000;
    z-index: 0;
  }
  .video-surface {
    object-fit: contain;
  }
  .libmedia-surface :deep(canvas),
  .libmedia-surface :deep(video) {
    display: block;
    width: 100%;
    height: 100%;
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
    z-index: 1;
  }
  .player-backdrop-shade {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(16px);
    z-index: 2;
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
  .decoder-mode-button {
    margin-right: 2px;
    color: rgba(255, 255, 255, 0.82);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
  }
  .decoder-mode-button:hover {
    color: white;
  }
  .decoder-mode-button:focus-visible {
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 1px;
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
  .loading-status {
    min-height: 18px;
    color: rgba(255, 255, 255, 0.48);
    font-size: 12px;
    line-height: 1.5;
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
  .subtitle-error-notice {
    position: absolute;
    z-index: 8;
    bottom: 132px;
    left: 50%;
    max-width: min(90vw, 420px);
    transform: translateX(-50%);
    padding: 10px 14px;
    border: 1px solid rgba(220, 138, 132, 0.35);
    border-radius: 4px;
    background: rgba(40, 18, 16, 0.9);
    color: rgba(255, 236, 234, 0.95);
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
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
    .decoder-mode-button {
      margin-right: 2px;
      font-size: 12px;
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
