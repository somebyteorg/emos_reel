import type AVPlayer from '@libmedia/avplayer'
// Runtime enums from /enum (const enums from the package root are blocked by verbatimModuleSyntax).
import { AVMediaType } from '@libmedia/avutil/enum'
import { computed, onBeforeUnmount, ref, type Ref, watch } from 'vue'
import type { PlaybackManifest } from '@/api/types'
import type { PlaybackAudioOption, PlaybackDecoderMode, PlaybackReadSource, PlaybackSeekDebugEntry, PlayerBufferedRange } from '@/types/player'
import { useShakaPlayer } from '@/composables/useShakaPlayer'
import { codecLabel, compileLibmediaAudioWasm, getLocalWasm, LocalDecoderUnavailableError, preloadLibmediaAudioWasm, suggestedPreLoadTime } from '@/libmedia/codecs'
import { type ControlledPostStreamLoader, createPostStreamLoader, inferMediaExtension, PostStreamError } from '@/libmedia/createPostStreamLoader'
import { createLibmediaFramePoster, type LibmediaFramePreviewOptions } from '@/libmedia/framePreview'
import { requestPersistentMediaStorage } from '@/libmedia/mediaCache'
import {
  createLibmediaAudioOptions,
  findPlayableLibmediaAudioStream,
  getLibmediaAudioStreams,
  getLibmediaTextSubtitleStreams,
  getLibmediaVideoStreams,
  getPlayableLibmediaStreams,
  isPlayableLibmediaStream,
  LibmediaStreamSelection,
  pickLibmediaAudioStream,
  pickLibmediaVideoStream,
} from '@/libmedia/streams'
import { concretePlaybackErrorMessage, isAudioContextGestureBlocked, playbackErrorUserMessage } from '@/utils/player-errors'

export type PlaybackEngineKind = 'shaka' | 'libmedia'

export interface PlaybackEngineError {
  error: unknown
  technicalMessage: string
  userMessage: string
  critical: boolean
}

export interface PlaybackDebugStats {
  showLibmediaDiagnostics: boolean
  bufferDiagnostics: string
  persistentReadAhead: string
  streamState: string
  downloadSpeed: number
  estimatedBandwidth: number
  streamBandwidth: number
  width: number
  height: number
  decodedFrames: number
  droppedFrames: number
  codecs: string
  seekLogs: PlaybackSeekDebugEntry[]
}

interface UsePlaybackEngineOptions {
  videoElement: Ref<HTMLVideoElement | undefined>
  libmediaContainer: Ref<HTMLDivElement | undefined>
  decoderMode: Readonly<Ref<PlaybackDecoderMode>>
  getToken: () => string | undefined
  onCanPlay: () => void
  onEnded: () => void
  onError: (details: PlaybackEngineError) => void
  onLoadStatus: (status: string) => void
  onPause: () => void
  onPlaying: () => void
  onSeeked: () => void
  onStatsChanged: () => void
  onTimeUpdate: () => void
  onWaiting: () => void
}

interface LoadPlaybackOptions {
  cacheKey: string
  manifest: PlaybackManifest
  preferredAudioId?: string
  startTime: number
}

const LIBMEDIA_LOAD_TIMEOUT_MS = 30_000
const LIBMEDIA_PLAYBACK_TIMEOUT_MS = 20_000
const LIBMEDIA_BUFFER_RANGE_MERGE_GAP_SECONDS = 1
const LIBMEDIA_BUFFER_SYNC_INTERVAL_MS = 200
const LIBMEDIA_BUFFER_SYNC_GRACE_MS = 1_500
const LIBMEDIA_STORED_RANGE_SYNC_INTERVAL_MS = 5_000
const LIBMEDIA_LOG_LEVEL_WARN = 3
const MEDIA_READ_STATUS_INTERVAL_MS = 250
const LIBMEDIA_AUDIO_CONTEXT_GESTURE_MESSAGE = 'AudioContext was not allowed to start. It must be resumed after a user gesture on the page.'
const LIBMEDIA_STATUS_LOADED = 4
const LIBMEDIA_STATUS_PLAYING = 5
const LIBMEDIA_STATUS_PLAYED = 6
const LIBMEDIA_STATUS_PAUSED = 8
const LIBMEDIA_STATUS_WAIT_MS = 80
const LIBMEDIA_STATUS_WAIT_TIMEOUT_MS = 3_000
const LIBMEDIA_FRAME_PREVIEW_TIMEOUT_MS = 3_000

interface BufferedTimeRange {
  start: number
  end: number
}

interface LibmediaPlayOptions {
  audio: boolean
  audioMasterForce: boolean
}

interface PendingLibmediaSeek {
  previousTime: number
  targetTime: number
}

type AVPlayerModule = typeof import('@libmedia/avplayer')
type AVPlayerConstructor = AVPlayerModule['default']

interface LibmediaAudioGesture {
  pipelineReady: Promise<void>
  resumeReady: Promise<void>
  getError: () => unknown
}

function shouldAttachToken(url: string) {
  const parsed = new URL(url, window.location.origin)
  return parsed.origin === 'https://emos.best' || (parsed.origin === window.location.origin && parsed.pathname.startsWith('/emos/'))
}

function numberFromCounter(value: number | bigint | undefined) {
  const result = Number(value ?? 0)
  return Number.isFinite(result) ? result : 0
}

function finitePositive(value: number | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : undefined
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isLibmediaPlayableStatus(status: number) {
  return status === LIBMEDIA_STATUS_LOADED || status === LIBMEDIA_STATUS_PAUSED || status === LIBMEDIA_STATUS_PLAYED
}

function mergeBufferedTimeRange(ranges: BufferedTimeRange[], nextRange: BufferedTimeRange) {
  if (!Number.isFinite(nextRange.start) || !Number.isFinite(nextRange.end) || nextRange.end <= nextRange.start) return ranges
  const sorted = [...ranges, nextRange].sort((left, right) => left.start - right.start)
  const merged: BufferedTimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end + LIBMEDIA_BUFFER_RANGE_MERGE_GAP_SECONDS) {
      merged.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

export function usePlaybackEngine(options: UsePlaybackEngineOptions) {
  const engineKind = ref<PlaybackEngineKind>()
  const audioOptions = ref<PlaybackAudioOption[]>([])
  const bufferedRanges = ref<PlayerBufferedRange[]>([])
  const currentTime = ref(0)
  const duration = ref(0)
  const bufferAhead = ref(0)
  const playableBufferAhead = ref(0)
  const muted = ref(false)
  const paused = ref(true)
  const playbackRate = ref(1)
  const seeking = ref(false)
  const selectedAudioId = ref('')
  const volume = ref(1)
  const canPictureInPicture = computed(() => engineKind.value === 'shaka' && Boolean(document.pictureInPictureEnabled))
  const libmediaCacheReadAt = ref(0)
  const libmediaReadSource = ref<PlaybackReadSource>()
  const libmediaReadAt = ref(0)
  const libmediaStreamCatchingUp = ref(false)
  const libmediaStreamCatchUpSeconds = ref(0)
  let lastAudibleVolume = 1
  let libmediaPlayer: AVPlayer | undefined
  let libmediaConstructor: AVPlayerConstructor | undefined
  let libmediaSource: ControlledPostStreamLoader | undefined
  let libmediaFramePoster: HTMLCanvasElement | undefined
  let libmediaFramePreviewAbortController: AbortController | undefined
  let libmediaFramePreviewPromise: Promise<void> | undefined
  let libmediaStarted = false
  let libmediaAudioStarted = false
  let libmediaPlayRequested = false
  let libmediaPlayInProgress = false
  let selectedLibmediaAudioId: number | undefined
  let pendingLibmediaStartTime = 0
  let pendingLibmediaSeek: PendingLibmediaSeek | undefined
  let rejectPendingLibmediaOperation: ((error: unknown) => void) | undefined
  let libmediaCommandQueue = Promise.resolve()
  let libmediaCleanupQueue = Promise.resolve()
  let libmediaSeekFlush: Promise<void> | undefined
  let reportedLibmediaError: unknown
  let resizeObserver: ResizeObserver | undefined
  let videoEventController: AbortController | undefined
  let libmediaBufferAheadSeconds = 0
  let libmediaBufferSyncTimer: number | undefined
  let libmediaStoredRangeSyncTimer: number | undefined
  let libmediaStoredTimeRanges: BufferedTimeRange[] = []
  let libmediaSeekLogs: PlaybackSeekDebugEntry[] = []
  let libmediaHasAudio = false
  let libmediaHasVideo = false
  let libmediaAudioContextBlocked = false
  let libmediaFirstAudioRendered = false
  let libmediaFirstVideoRendered = false
  let libmediaObservedPlaybackTime: number | undefined
  const libmediaStreamSelection = new LibmediaStreamSelection()
  let libmediaSeeking = false
  let libmediaPreLoadTime = suggestedPreLoadTime()

  const {
    audioOptions: shakaAudioOptions,
    destroy: destroyShakaPlayer,
    getPlayer: getShakaPlayer,
    getStats: getShakaStats,
    lastCacheReadAt: shakaCacheReadAt,
    lastSegmentDownloadAt,
    lastSegmentReadAt: shakaReadAt,
    lastSegmentSource: shakaReadSource,
    load: loadShakaPlayer,
    segmentDownloadBitsPerSecond,
    selectAudioTrack: selectShakaAudioTrack,
    selectedAudioId: shakaSelectedAudioId,
  } = useShakaPlayer({
    videoElement: options.videoElement,
    getToken: options.getToken,
    onError: (error, critical) => {
      options.onError({
        error,
        technicalMessage: error.message || `Shaka Error ${error.code}`,
        userMessage: playbackErrorUserMessage(error as Parameters<typeof playbackErrorUserMessage>[0]),
        critical,
      })
    },
    onStatsChanged: options.onStatsChanged,
  })
  const lastCacheReadAt = computed(() => (engineKind.value === 'shaka' ? shakaCacheReadAt.value : libmediaCacheReadAt.value))
  const mediaReadSource = computed(() => (engineKind.value === 'shaka' ? shakaReadSource.value : libmediaReadSource.value))
  const lastMediaReadAt = computed(() => (engineKind.value === 'shaka' ? shakaReadAt.value : libmediaReadAt.value))
  const streamCatchingUp = computed(() => engineKind.value === 'libmedia' && libmediaStreamCatchingUp.value)

  function enqueueLibmediaCommand<T>(player: AVPlayer, command: () => Promise<T>): Promise<T> {
    const result = libmediaCommandQueue.then(() => {
      if (libmediaPlayer !== player) throw new Error('libmedia command superseded')
      return command()
    })
    libmediaCommandQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function reportLibmediaError(error: unknown) {
    if (reportedLibmediaError !== undefined) return
    if (isAudioContextGestureBlocked(error)) return
    reportedLibmediaError = error
    paused.value = true
    void stopLibmediaSource(libmediaSource, 'libmedia error')
    rejectPendingLibmediaOperation?.(error)
    const technicalMessage = error instanceof Error ? error.message : 'libmedia playback error'
    let userMessage = concretePlaybackErrorMessage(error) || '这个视频暂时无法播放'
    if (error instanceof LocalDecoderUnavailableError) {
      userMessage = '当前设备无法播放这个视频使用的声音或画面格式，请切换版本'
    } else if (error instanceof PostStreamError) {
      switch (error.httpStatus) {
        case 401:
          userMessage = '登录状态已经失效，请重新登录'
          break
        case 403:
          userMessage = '请刷新后重试'
          break
        case 404:
          userMessage = '这个视频不存在或暂时不能观看'
          break
        default:
          break
      }
    }
    options.onError({
      error,
      technicalMessage,
      userMessage,
      critical: true,
    })
  }

  async function runLibmediaOperation<T>(operation: Promise<T>, timeoutMessage: string, timeoutMs: number) {
    let timeoutId: number | undefined
    let rejectFailure!: (error: unknown) => void
    const failure = new Promise<never>((_, reject) => {
      rejectFailure = reject
      rejectPendingLibmediaOperation = reject
    })
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        const error = new Error(timeoutMessage)
        void stopLibmediaSource(libmediaSource, timeoutMessage)
        reject(error)
      }, timeoutMs)
    })
    try {
      return await Promise.race([operation, failure, timeout])
    } finally {
      if (timeoutId != null) window.clearTimeout(timeoutId)
      if (rejectPendingLibmediaOperation === rejectFailure) rejectPendingLibmediaOperation = undefined
    }
  }

  async function stopLibmediaSource(source: ControlledPostStreamLoader | undefined, reason: string) {
    if (!source) return
    try {
      // libmedia 超时后底层 POST 流可能还在继续读；必须主动 stop，才能 abort fetch/reader。
      await source.stop()
    } catch (error) {
      console.warn(`[EMOS REEL] failed to stop POST media stream after ${reason}`, error)
    }
  }

  function removeLibmediaFramePoster() {
    libmediaFramePoster?.remove()
    libmediaFramePoster = undefined
  }

  async function prepareLibmediaFramePoster(previewOptions: Omit<LibmediaFramePreviewOptions, 'signal' | 'timeoutMs'>) {
    libmediaFramePreviewAbortController?.abort()
    const abortController = new AbortController()
    libmediaFramePreviewAbortController = abortController
    const operation = (async () => {
      try {
        const poster = await createLibmediaFramePoster({
          ...previewOptions,
          signal: abortController.signal,
          timeoutMs: LIBMEDIA_FRAME_PREVIEW_TIMEOUT_MS,
        })
        if (abortController.signal.aborted || libmediaPlayer == null) {
          poster.remove()
          return
        }
        removeLibmediaFramePoster()
        libmediaFramePoster = poster
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('[EMOS REEL] 当前进度首帧生成失败，继续显示默认背景', error)
        }
      }
    })()
    const settled = operation.finally(() => {
      if (libmediaFramePreviewAbortController === abortController) libmediaFramePreviewAbortController = undefined
      if (libmediaFramePreviewPromise === settled) libmediaFramePreviewPromise = undefined
    })
    libmediaFramePreviewPromise = settled
    await settled
  }

  function resetLibmediaPlaybackState(startTime = 0) {
    libmediaStarted = false
    libmediaAudioStarted = false
    libmediaPlayRequested = false
    libmediaPlayInProgress = false
    libmediaSeeking = false
    seeking.value = false
    libmediaCacheReadAt.value = 0
    libmediaReadSource.value = undefined
    libmediaReadAt.value = 0
    libmediaStreamCatchingUp.value = false
    libmediaStreamCatchUpSeconds.value = 0
    libmediaBufferAheadSeconds = 0
    bufferAhead.value = 0
    playableBufferAhead.value = 0
    libmediaStoredTimeRanges = []
    libmediaSeekLogs = []
    libmediaHasAudio = false
    libmediaHasVideo = false
    libmediaAudioContextBlocked = false
    libmediaFirstAudioRendered = false
    libmediaFirstVideoRendered = false
    libmediaObservedPlaybackTime = undefined
    reportedLibmediaError = undefined
    pendingLibmediaStartTime = Math.max(0, startTime)
    pendingLibmediaSeek = undefined
  }

  function requestLibmediaAudioGesture(player?: AVPlayer) {
    if (!libmediaHasAudio || !libmediaConstructor) return undefined
    let resumeError: unknown
    // 点击播放这一刻先创建并恢复 libmedia 自己的 AudioContext。
    // 否则等异步重载完成后再创建声音管线，浏览器会认为已经脱离用户手势。
    const instanceResumeReady = (player?.hasAudio() ? player.resume() : Promise.resolve()).catch((error: unknown) => {
      resumeError = error
    })
    const pipelineReady = libmediaConstructor.startAudioPipeline(true).catch((error: unknown) => {
      resumeError = error
    })
    const audioContext = libmediaConstructor.audioContext as AudioContext | undefined
    const resumeReady = Promise.all([
      instanceResumeReady,
      (audioContext?.resume() ?? Promise.resolve()).catch((error: unknown) => {
        resumeError = error
      }),
    ]).then(() => undefined)
    return {
      pipelineReady,
      resumeReady,
      getError: () => resumeError,
    } satisfies LibmediaAudioGesture
  }

  async function waitForLibmediaAudioGesture(gesture?: LibmediaAudioGesture) {
    if (!gesture) return
    await gesture.resumeReady
    if (gesture.getError()) throw gesture.getError()
    await gesture.pipelineReady
    if (gesture.getError()) throw gesture.getError()
  }

  function handleUnhandledRejection(event: PromiseRejectionEvent) {
    if (engineKind.value !== 'libmedia') return
    if (event.reason instanceof LocalDecoderUnavailableError) {
      event.preventDefault()
      reportLibmediaError(event.reason)
      return
    }
    if (!isAudioContextGestureBlocked(event.reason)) return
    event.preventDefault()
    const player = libmediaPlayer
    if (!player) return
    void pauseLibmediaForAudioGesture(player).catch((error: unknown) => {
      if (libmediaPlayer === player) reportLibmediaError(error)
    })
  }

  function finishLibmediaSeek(player: AVPlayer) {
    if (libmediaPlayer !== player || !libmediaStarted) return
    const wasSeeking = libmediaSeeking || seeking.value
    libmediaSeeking = false
    seeking.value = false
    libmediaObservedPlaybackTime = currentTime.value
    syncLibmediaBufferedRanges(player)
    if (wasSeeking) options.onSeeked()
  }

  function flushLibmediaSeek(player: AVPlayer) {
    if (libmediaSeekFlush) return libmediaSeekFlush
    const flush = enqueueLibmediaCommand(player, async () => {
      while (libmediaPlayer === player && libmediaStarted && pendingLibmediaSeek != null) {
        const request = pendingLibmediaSeek
        pendingLibmediaSeek = undefined
        await seekLibmediaPlayer(player, request.targetTime, request.previousTime)
      }
    })
    libmediaSeekFlush = flush.finally(() => {
      libmediaSeekFlush = undefined
      if (libmediaPlayer !== player || !libmediaStarted) return
      if (pendingLibmediaSeek != null) {
        void flushLibmediaSeek(player)
        return
      }
      finishLibmediaSeek(player)
    })
    return libmediaSeekFlush
  }

  function syncVideoState() {
    if (engineKind.value !== 'shaka') return
    const video = options.videoElement.value
    if (!video) return
    currentTime.value = video.currentTime || 0
    duration.value = Number.isFinite(video.duration) ? video.duration : 0
    const nextBufferAhead = getVideoBufferAhead(video)
    bufferAhead.value = nextBufferAhead
    playableBufferAhead.value = nextBufferAhead
    paused.value = video.paused
    volume.value = video.volume
    muted.value = video.muted
    playbackRate.value = video.playbackRate
    if (video.volume > 0) lastAudibleVolume = video.volume
    bufferedRanges.value =
      duration.value > 0
        ? Array.from({ length: video.buffered.length }, (_, index) => ({
            start: Math.min(100, Math.max(0, (video.buffered.start(index) / duration.value) * 100)),
            end: Math.min(100, Math.max(0, (video.buffered.end(index) / duration.value) * 100)),
            kind: 'ready' as const,
          }))
        : []
  }

  function bindVideoEvents(video?: HTMLVideoElement) {
    videoEventController?.abort()
    videoEventController = undefined
    if (!video) return
    const controller = new AbortController()
    const listen = (event: keyof HTMLMediaElementEventMap, handler: () => void) => video.addEventListener(event, handler, { signal: controller.signal })
    for (const event of ['durationchange', 'loadedmetadata', 'progress', 'volumechange', 'ratechange'] as const) listen(event, syncVideoState)
    listen('canplay', () => {
      syncVideoState()
      options.onCanPlay()
    })
    listen('play', syncVideoState)
    listen('playing', () => {
      syncVideoState()
      options.onPlaying()
    })
    listen('pause', () => {
      syncVideoState()
      if (engineKind.value === 'shaka') options.onPause()
    })
    listen('ended', () => {
      seeking.value = false
      syncVideoState()
      options.onEnded()
    })
    listen('seeking', () => {
      seeking.value = true
      syncVideoState()
      options.onWaiting()
    })
    listen('seeked', () => {
      seeking.value = false
      syncVideoState()
      options.onSeeked()
    })
    listen('timeupdate', () => {
      syncVideoState()
      options.onTimeUpdate()
    })
    listen('stalled', options.onWaiting)
    listen('waiting', options.onWaiting)
    videoEventController = controller
  }

  function refreshLibmediaAudioOptions(player: AVPlayer) {
    audioOptions.value = createLibmediaAudioOptions(player.getStreams())
    const currentId = player.getSelectedAudioStreamId()
    selectedAudioId.value = currentId >= 0 ? String(currentId) : selectedLibmediaAudioId == null ? '' : String(selectedLibmediaAudioId)
  }

  function getLibmediaPacketBufferStats(player: AVPlayer) {
    const stats = player.getStats()
    const videoRate = stats.videoEncodeFramerate || stats.videoDecodeFramerate || stats.videoRenderFramerate || 0
    const audioFramesPerSecond = stats.sampleRate > 0 && stats.audioFrameSize > 0 ? stats.sampleRate / stats.audioFrameSize : 0
    const audioRate = stats.audioEncodeFramerate || stats.audioDecodeFramerate || stats.audioRenderFramerate || audioFramesPerSecond
    const videoPackets = numberFromCounter(stats.videoPacketQueueLength)
    const audioPackets = numberFromCounter(stats.audioPacketQueueLength)
    return {
      audioAhead: audioRate > 0 && audioPackets > 0 ? audioPackets / audioRate : undefined,
      audioPackets,
      audioRate,
      videoAhead: videoRate > 0 && videoPackets > 0 ? videoPackets / videoRate : undefined,
      videoPackets,
      videoRate,
    }
  }

  function estimateLibmediaPacketBufferAhead(player: AVPlayer) {
    if (libmediaSeeking) return undefined
    const estimate = getLibmediaPacketBufferStats(player)
    const active = [libmediaHasVideo ? estimate.videoAhead : undefined, libmediaHasAudio ? estimate.audioAhead : undefined].filter((value): value is number => value != null)
    return active.length ? Math.min(...active) : undefined
  }

  function estimateLibmediaBufferAhead(player: AVPlayer) {
    if (libmediaSeeking) return 0
    // A zero packet queue is often transient in WebCodecs mode because packets
    // have already moved into decoder/render queues. Packet duration is the
    // authoritative playable buffer; byte distance is only a fallback because
    // variable-bitrate MKV data cannot be converted to time precisely.
    const packetAhead = finitePositive(estimateLibmediaPacketBufferAhead(player))
    const readAhead = finitePositive(libmediaSource?.getReadAheadSeconds(currentTime.value, duration.value))
    return Math.min(packetAhead ?? readAhead ?? 0, libmediaPreLoadTime)
  }

  function syncLibmediaBufferedRanges(player?: AVPlayer) {
    if (engineKind.value !== 'libmedia' || duration.value <= 0) {
      if (engineKind.value === 'libmedia') {
        bufferAhead.value = 0
        playableBufferAhead.value = 0
        bufferedRanges.value = []
      }
      return
    }
    const active = player ?? libmediaPlayer
    if (active) {
      libmediaBufferAheadSeconds = estimateLibmediaBufferAhead(active)
      if (!libmediaSeeking) libmediaSource?.updatePersistentReadAhead(currentTime.value, libmediaBufferAheadSeconds)
    }
    playableBufferAhead.value = libmediaBufferAheadSeconds
    const persistentReadAhead = libmediaSource?.getPersistentReadAhead()?.cachedAheadSeconds
    bufferAhead.value = libmediaSeeking ? 0 : Math.max(0, Math.min(duration.value - currentTime.value, persistentReadAhead ?? libmediaBufferAheadSeconds))
    let readyRange: PlayerBufferedRange | undefined
    if (!libmediaSeeking && libmediaBufferAheadSeconds > 0) {
      rememberLibmediaBufferedTime(currentTime.value, currentTime.value + libmediaBufferAheadSeconds)
      readyRange = {
        start: Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100)),
        end: Math.min(100, Math.max(0, ((currentTime.value + libmediaBufferAheadSeconds) / duration.value) * 100)),
        kind: 'ready',
      }
    }
    bufferedRanges.value = libmediaStoredTimeRanges.map((range) => ({
      start: Math.min(100, Math.max(0, (range.start / duration.value) * 100)),
      end: Math.min(100, Math.max(0, (range.end / duration.value) * 100)),
      kind: 'stored' as const,
    }))
    if (readyRange && readyRange.end > readyRange.start) bufferedRanges.value.push(readyRange)
  }

  function stopLibmediaBufferSync() {
    if (libmediaBufferSyncTimer != null) window.clearTimeout(libmediaBufferSyncTimer)
    libmediaBufferSyncTimer = undefined
    if (libmediaStoredRangeSyncTimer != null) window.clearTimeout(libmediaStoredRangeSyncTimer)
    libmediaStoredRangeSyncTimer = undefined
  }

  function scheduleLibmediaBufferSync(player: AVPlayer) {
    if (libmediaBufferSyncTimer != null || libmediaPlayer !== player) return
    libmediaBufferSyncTimer = window.setTimeout(() => {
      libmediaBufferSyncTimer = undefined
      if (libmediaPlayer !== player || engineKind.value !== 'libmedia') return
      syncLibmediaBufferedRanges(player)
      if (Date.now() - lastSegmentDownloadAt.value <= LIBMEDIA_BUFFER_SYNC_GRACE_MS) scheduleLibmediaBufferSync(player)
    }, LIBMEDIA_BUFFER_SYNC_INTERVAL_MS)
  }

  function rememberLibmediaBufferedTime(start: number, end: number) {
    if (duration.value <= 0) return
    const range = {
      start: Math.min(duration.value, Math.max(0, start)),
      end: Math.min(duration.value, Math.max(0, end)),
    }
    if (!libmediaSource?.rememberTimeRange(range.start, range.end)) return
    libmediaStoredTimeRanges = mergeBufferedTimeRange(libmediaStoredTimeRanges, range)
    scheduleLibmediaStoredRangeSync()
  }

  function scheduleLibmediaStoredRangeSync() {
    if (libmediaStoredRangeSyncTimer != null) return
    const source = libmediaSource
    const player = libmediaPlayer
    if (!source || !player) return
    libmediaStoredRangeSyncTimer = window.setTimeout(() => {
      libmediaStoredRangeSyncTimer = undefined
      void source.getCachedTimeline().then((timeline) => {
        if (source !== libmediaSource || player !== libmediaPlayer) return
        libmediaStoredTimeRanges = timeline.ranges.reduce(
          (ranges, range) =>
            mergeBufferedTimeRange(ranges, {
              start: Math.min(duration.value, Math.max(0, range.start)),
              end: Math.min(duration.value, Math.max(0, range.end)),
            }),
          [] as BufferedTimeRange[],
        )
        syncLibmediaBufferedRanges(player)
      })
    }, LIBMEDIA_STORED_RANGE_SYNC_INTERVAL_MS)
  }

  async function seekLibmediaPlayer(player: AVPlayer, seconds: number, previousSeconds?: number) {
    const source = libmediaSource
    source?.beginTimeSeek(seconds, previousSeconds)
    try {
      await player.seek(BigInt(Math.round(seconds * 1000)))
    } finally {
      source?.endTimeSeek(seconds)
    }
  }

  function markLibmediaCanPlay() {
    const audioReady = !libmediaHasAudio || !libmediaAudioStarted || libmediaFirstAudioRendered || libmediaAudioContextBlocked
    if ((!libmediaHasVideo || libmediaFirstVideoRendered) && audioReady) {
      options.onCanPlay()
    }
  }

  async function pauseLibmediaForAudioGesture(player: AVPlayer) {
    if (libmediaPlayer !== player) return
    libmediaStarted ||= player.hasAudio() || player.hasVideo()
    libmediaAudioContextBlocked = true
    libmediaPlayRequested = false
    if (libmediaStarted) await player.pause()
    paused.value = true
    options.onLoadStatus('点击播放以启用声音')
    markLibmediaCanPlay()
  }

  async function seekLibmediaToPendingStart(player: AVPlayer) {
    if (libmediaStarted || pendingLibmediaStartTime <= 0) return
    const startTime = pendingLibmediaStartTime
    await seekLibmediaPlayer(player, startTime)
    libmediaSeeking = false
    seeking.value = false
    pendingLibmediaStartTime = 0
    currentTime.value = startTime
  }

  async function waitForLibmediaPlayableStatus(player: AVPlayer) {
    const startedAt = performance.now()
    while (libmediaPlayer === player && player.getStatus() === LIBMEDIA_STATUS_PLAYING) {
      if (performance.now() - startedAt >= LIBMEDIA_STATUS_WAIT_TIMEOUT_MS) break
      await delay(LIBMEDIA_STATUS_WAIT_MS)
    }
    return player.getStatus()
  }

  async function startLibmediaPlayback(player: AVPlayer, playOptions: LibmediaPlayOptions, audioGesture?: LibmediaAudioGesture) {
    const playAudio = playOptions.audio && libmediaHasAudio
    const previousStarted = libmediaStarted
    const previousAudioStarted = libmediaAudioStarted
    const previousAudioBlocked = libmediaAudioContextBlocked
    const previousPlayRequested = libmediaPlayRequested
    libmediaStarted = true
    libmediaPlayRequested = true
    libmediaAudioStarted = previousAudioStarted || playAudio
    libmediaAudioContextBlocked = false
    try {
      if (playAudio) await waitForLibmediaAudioGesture(audioGesture)
      const status = await waitForLibmediaPlayableStatus(player)
      if (status === LIBMEDIA_STATUS_PLAYED) {
        player.setSubtitleEnable(false)
        if (playAudio && player.isSuspended()) libmediaAudioContextBlocked = true
        refreshLibmediaAudioOptions(player)
        markLibmediaCanPlay()
        return
      }
      if (!isLibmediaPlayableStatus(status)) {
        throw new Error(`libmedia 播放器还没准备好，请稍后重试（状态 ${status}）`)
      }
      await runLibmediaOperation(
        player.play({
          audio: playAudio,
          video: true,
          subtitle: playAudio && libmediaStreamSelection.has(AVMediaType.AVMEDIA_TYPE_SUBTITLE),
          audioMasterForce: playAudio && playOptions.audioMasterForce,
        }),
        'libmedia 启动播放超时',
        LIBMEDIA_PLAYBACK_TIMEOUT_MS,
      )
    } catch (error) {
      if (libmediaPlayer === player) {
        libmediaStarted = previousStarted
        libmediaAudioStarted = previousAudioStarted
        libmediaAudioContextBlocked = previousAudioBlocked
        libmediaPlayRequested = previousPlayRequested
      }
      throw error
    }
    // libmedia 只有在 play() 后才会创建 SubtitleRender，所以文本字幕管线创建后再关掉内置显示。
    player.setSubtitleEnable(false)
    if (playAudio && player.isSuspended()) libmediaAudioContextBlocked = true
    refreshLibmediaAudioOptions(player)
    markLibmediaCanPlay()
  }

  function updateLibmediaPlayingState(player: AVPlayer) {
    if (libmediaPlayer !== player || engineKind.value !== 'libmedia') return false
    if (!libmediaPlayRequested) {
      paused.value = true
      syncLibmediaBufferedRanges(player)
      return false
    }
    const seekInProgress = libmediaSeeking || pendingLibmediaSeek != null || libmediaSeekFlush != null
    const audioBlocked = libmediaHasAudio && (!libmediaAudioStarted || libmediaAudioContextBlocked || player.isSuspended())
    paused.value = audioBlocked
    syncLibmediaBufferedRanges(player)
    if (audioBlocked) {
      options.onLoadStatus('点击播放以启用声音')
      markLibmediaCanPlay()
      return false
    }
    if (!seekInProgress) options.onPlaying()
    return true
  }

  function bindLibmediaEvents(player: AVPlayer, events: typeof import('@libmedia/avplayer').Events) {
    const isCurrent = () => libmediaPlayer === player && engineKind.value === 'libmedia'
    const markPlaying = () => updateLibmediaPlayingState(player)
    player.on(events.PLAYED, markPlaying)
    player.on(events.LOADING, () => {
      if (!isCurrent()) return
      options.onWaiting()
    })
    player.on(events.TIMEOUT, () => {
      if (!isCurrent()) return
      options.onWaiting()
    })
    player.on(events.FIRST_VIDEO_RENDERED, () => {
      if (!isCurrent()) return
      removeLibmediaFramePoster()
      libmediaFirstVideoRendered = true
      libmediaSeeking = false
      seeking.value = false
      refreshLibmediaAudioOptions(player)
      syncLibmediaBufferedRanges(player)
      markLibmediaCanPlay()
      options.onStatsChanged()
    })
    player.on(events.FIRST_AUDIO_RENDERED, () => {
      if (!isCurrent()) return
      libmediaFirstAudioRendered = true
      libmediaAudioContextBlocked = false
      markLibmediaCanPlay()
      markPlaying()
      options.onStatsChanged()
    })
    player.on(events.RESUME, () => {
      if (!isCurrent() || !libmediaHasAudio) return
      libmediaAudioContextBlocked = true
      libmediaPlayRequested = false
      paused.value = true
      rejectPendingLibmediaOperation?.(new Error(LIBMEDIA_AUDIO_CONTEXT_GESTURE_MESSAGE))
      options.onLoadStatus('点击播放以启用声音')
      markLibmediaCanPlay()
    })
    player.on(events.AUDIO_CONTEXT_RUNNING, () => {
      if (!isCurrent()) return
      libmediaAudioContextBlocked = false
      options.onLoadStatus('声音马上就好')
      markPlaying()
    })
    player.on(events.PAUSED, () => {
      if (!isCurrent()) return
      paused.value = true
      options.onPause()
    })
    player.on(events.ENDED, () => {
      if (!isCurrent()) return
      libmediaSeeking = false
      seeking.value = false
      paused.value = true
      currentTime.value = duration.value
      options.onEnded()
    })
    player.on(events.TIME, (milliseconds: bigint) => {
      if (!isCurrent()) return
      const nextTime = Number(milliseconds) / 1000
      if (!libmediaSeeking && libmediaObservedPlaybackTime != null && nextTime >= libmediaObservedPlaybackTime) {
        // Anything the playhead has crossed was necessarily read and is available in the local cache.
        rememberLibmediaBufferedTime(libmediaObservedPlaybackTime, nextTime)
      }
      libmediaObservedPlaybackTime = nextTime
      currentTime.value = nextTime
      syncLibmediaBufferedRanges(player)
      if (paused.value && libmediaPlayRequested) updateLibmediaPlayingState(player)
      options.onTimeUpdate()
    })
    player.on(events.SEEKING, () => {
      if (!isCurrent()) return
      libmediaSeeking = true
      seeking.value = true
      libmediaBufferAheadSeconds = 0
      bufferAhead.value = 0
      playableBufferAhead.value = 0
      libmediaObservedPlaybackTime = undefined
      options.onWaiting()
    })
    player.on(events.SEEKED, () => {
      if (!isCurrent()) return
      libmediaSource?.markTimeSeekSettled()
      const canFinishSeek = pendingLibmediaSeek == null && libmediaSeekFlush == null && (libmediaSeeking || seeking.value)
      if (canFinishSeek) finishLibmediaSeek(player)
      else {
        libmediaObservedPlaybackTime = currentTime.value
        syncLibmediaBufferedRanges(player)
      }
      options.onStatsChanged()
    })
    player.on(events.CHANGED, () => {
      if (!isCurrent()) return
      refreshLibmediaAudioOptions(player)
      syncLibmediaBufferedRanges(player)
      options.onStatsChanged()
    })
    player.on(events.VOLUME_CHANGE, (nextVolume: number) => {
      if (!isCurrent()) return
      volume.value = nextVolume
      muted.value = nextVolume === 0
    })
    player.on(events.ERROR, (error: Error) => {
      if (!isCurrent()) return
      if (isAudioContextGestureBlocked(error)) {
        void pauseLibmediaForAudioGesture(player).catch((followUpError: unknown) => {
          if (libmediaPlayer === player) reportLibmediaError(followUpError)
        })
        return
      }
      reportLibmediaError(error)
    })
  }

  async function loadLibmedia(loadOptions: LoadPlaybackOptions) {
    const { cacheKey, manifest, startTime, preferredAudioId } = loadOptions
    if (manifest.play_type !== 'proxy') throw new Error('libmedia 播放源类型错误')
    const sourceUrl = manifest.play_data.play_url
    const playDataBody = manifest.play_data.data
    const container = options.libmediaContainer.value
    if (!sourceUrl || !container) throw new Error('libmedia 播放源或渲染容器不可用')
    const audioRuntimeWasmDownloaded = preloadLibmediaAudioWasm()
      .then(() => true)
      .catch((error: unknown) => {
        console.warn('[EMOS REEL] libmedia audio WASM preload failed; falling back to on-demand loading', error)
        return false
      })
    const resolvedSourceUrl = new URL(sourceUrl, window.location.href)
    const extension = inferMediaExtension(sourceUrl) ?? inferMediaExtension(manifest.media_name) ?? 'mkv'
    const requestedAudioId = Number(preferredAudioId)
    selectedLibmediaAudioId = Number.isInteger(requestedAudioId) ? requestedAudioId : undefined
    container.replaceChildren()
    options.onLoadStatus('正在准备播放器')
    const { default: AVPlayer, Events } = await import('@libmedia/avplayer')
    libmediaConstructor = AVPlayer
    AVPlayer.setLogLevel(LIBMEDIA_LOG_LEVEL_WARN)
    const audioRuntimeWasmReady = audioRuntimeWasmDownloaded.then(async (downloaded) => {
      if (!downloaded) return
      await compileLibmediaAudioWasm((source, compileOptions) => AVPlayer.Util.compile(source, compileOptions)).catch((error: unknown) => {
        console.warn('[EMOS REEL] libmedia audio WASM compilation failed; falling back to raw buffers', error)
      })
    })
    let player: AVPlayer
    libmediaStreamSelection.clear()
    libmediaPreLoadTime = suggestedPreLoadTime()
    const useWebCodecs = options.decoderMode.value === 'webcodecs'
    player = new AVPlayer({
      container,
      getWasm: (type, codecId) => getLocalWasm(type, codecId) ?? '',
      // Direct-file playback must not depend on the browser accepting MKV in MSE.
      checkUseMSE: () => false,
      // WebCodecs 对部分 HEVC / Dolby Vision 配置会直接报 not support，所以保留手动切换入口。
      enableHardware: useWebCodecs,
      enableWebCodecs: useWebCodecs,
      enableWorker: true,
      enableAudioWorklet: true,
      audioWorkletBufferLength: 24,
      // WebGPU path is required for high bit-depth / HDR-friendly presentation.
      enableWebGPU: true,
      preLoadTime: libmediaPreLoadTime,
      findBestStream: (streams, mediaType) => libmediaStreamSelection.find(streams, mediaType),
    })
    libmediaPlayer = player
    resetLibmediaPlaybackState(startTime)
    bindLibmediaEvents(player, Events)
    player.on(Events.PROGRESS, (stage: number) => {
      if (libmediaPlayer !== player) return
      const status = ['正在连接视频', '正在读取视频内容', '正在准备声音', '正在准备画面'][stage]
      if (status) options.onLoadStatus(status)
    })
    const token = options.getToken()
    const transferSamples: { bytes: number; startedAt: number; endedAt: number }[] = []
    const source = createPostStreamLoader(AVPlayer.IOLoader.CustomIOLoader, {
      url: resolvedSourceUrl.href,
      data: playDataBody,
      extension,
      cacheKey,
      headers: token && shouldAttachToken(sourceUrl) ? { Authorization: `Bearer ${token}` } : undefined,
      retryCount: 3,
      getMediaDuration: () => duration.value,
      onError: (error) => {
        if (libmediaPlayer === player) reportLibmediaError(error)
      },
      onRetry: () => {
        if (libmediaPlayer === player) options.onWaiting()
      },
      onStreamCatchUpChange: (catchingUp, seconds = 0) => {
        if (libmediaPlayer !== player) return
        libmediaStreamCatchingUp.value = catchingUp
        libmediaStreamCatchUpSeconds.value = catchingUp ? seconds : 0
        options.onStatsChanged()
      },
      onSeekDebug: (entry) => {
        if (libmediaPlayer !== player) return
        libmediaSeekLogs = [entry, ...libmediaSeekLogs.filter((existing) => existing.id !== entry.id)].slice(0, 8)
        options.onStatsChanged()
      },
      onPrefetchRange: (startSeconds, endSeconds) => {
        if (libmediaPlayer !== player) return
        libmediaStoredTimeRanges = mergeBufferedTimeRange(libmediaStoredTimeRanges, {
          start: Math.min(duration.value, Math.max(0, startSeconds)),
          end: Math.min(duration.value, Math.max(0, endSeconds)),
        })
        syncLibmediaBufferedRanges(player)
        scheduleLibmediaStoredRangeSync()
        options.onStatsChanged()
      },
      onPrefetchChange: () => {
        if (libmediaPlayer !== player) return
        syncLibmediaBufferedRanges(player)
        scheduleLibmediaStoredRangeSync()
        options.onStatsChanged()
      },
      onRead: (source, bytes) => {
        if (libmediaPlayer !== player || bytes <= 0) return
        const readAt = Date.now()
        if (source === 'cache') libmediaCacheReadAt.value = readAt
        if (libmediaReadSource.value === source && readAt - libmediaReadAt.value < MEDIA_READ_STATUS_INTERVAL_MS) return
        libmediaReadSource.value = source
        libmediaReadAt.value = readAt
        options.onStatsChanged()
      },
      onBytes: (bytes, durationMs) => {
        if (libmediaPlayer !== player || bytes <= 0) return
        const endedAt = Date.now()
        const startedAt = durationMs > 0 ? endedAt - durationMs : endedAt
        transferSamples.push({ bytes, startedAt, endedAt })
        // Keep a short rolling window for network speed display.
        while (transferSamples.length > 32) transferSamples.shift()
        const windowStart = endedAt - 8_000
        const recent = transferSamples.filter((sample) => sample.endedAt >= windowStart)
        const totalBytes = recent.reduce((sum, sample) => sum + sample.bytes, 0)
        const earliest = recent[0]?.startedAt ?? endedAt
        const elapsed = Math.max(1, endedAt - earliest) / 1000
        segmentDownloadBitsPerSecond.value = (totalBytes * 8) / elapsed
        lastSegmentDownloadAt.value = endedAt
        syncLibmediaBufferedRanges(player)
        scheduleLibmediaBufferSync(player)
        options.onStatsChanged()
      },
    })
    libmediaSource = source
    try {
      // maxProbeDuration is in seconds; default 3s is too short for large remote POST opens.
      options.onLoadStatus('正在打开视频')
      await runLibmediaOperation(
        player.load(source, {
          maxProbeDuration: 20,
          ext: extension,
        }),
        'libmedia 加载视频源超时',
        LIBMEDIA_LOAD_TIMEOUT_MS,
      )
    } catch (error) {
      if (libmediaPlayer === player) reportLibmediaError(error)
      throw error
    }
    if (libmediaPlayer !== player) throw new Error('libmedia load superseded')
    options.onLoadStatus('正在准备画面和声音')
    duration.value = Number(player.getDuration()) / 1000
    currentTime.value = Math.min(duration.value, pendingLibmediaStartTime)
    libmediaObservedPlaybackTime = currentTime.value
    const cachedTimeline = await source.getCachedTimeline()
    if (libmediaPlayer !== player) throw new Error('libmedia load superseded')
    libmediaStoredTimeRanges = cachedTimeline.ranges.reduce(
      (ranges, range) =>
        mergeBufferedTimeRange(ranges, {
          start: Math.min(duration.value, Math.max(0, range.start)),
          end: Math.min(duration.value, Math.max(0, range.end)),
        }),
      [] as BufferedTimeRange[],
    )
    syncLibmediaBufferedRanges(player)
    player.setPlaybackRate(playbackRate.value)
    player.setVolume(muted.value ? 0 : volume.value)
    const streams = player.getStreams()
    const videoStreams = getLibmediaVideoStreams(streams)
    const audioStreams = getLibmediaAudioStreams(streams)
    if (!videoStreams.length && !audioStreams.length) {
      const error = new Error(`libmedia 未从 ${extension.toUpperCase()} 中解析到音视频流`)
      reportLibmediaError(error)
      throw error
    }
    if (videoStreams.length && !getPlayableLibmediaStreams(videoStreams).length) {
      const error = new LocalDecoderUnavailableError(Number(videoStreams[0]?.codecparProxy.codecId))
      reportLibmediaError(error)
      throw error
    }
    const selectedVideoStream = pickLibmediaVideoStream(streams)
    const selectedStream = pickLibmediaAudioStream(streams, selectedLibmediaAudioId)
    if (audioStreams.length && !selectedStream) {
      const error = new LocalDecoderUnavailableError(Number(audioStreams[0]?.codecparProxy.codecId))
      reportLibmediaError(error)
      throw error
    }
    // Soft-hint unsupported audio tracks in the console for debugging mixed rips.
    for (const stream of audioStreams) {
      if (!isPlayableLibmediaStream(stream)) {
        console.warn('[EMOS REEL] unsupported audio codec in source', codecLabel(Number(stream.codecparProxy.codecId)), stream.id)
      }
    }
    selectedLibmediaAudioId = selectedStream?.id
    libmediaHasVideo = Boolean(selectedVideoStream)
    libmediaHasAudio = Boolean(selectedStream)
    libmediaStreamSelection.set(AVMediaType.AVMEDIA_TYPE_VIDEO, selectedVideoStream)
    libmediaStreamSelection.set(AVMediaType.AVMEDIA_TYPE_AUDIO, selectedStream)
    libmediaStreamSelection.set(AVMediaType.AVMEDIA_TYPE_SUBTITLE, getLibmediaTextSubtitleStreams(streams)[0])
    refreshLibmediaAudioOptions(player)
    if (libmediaHasAudio) {
      options.onLoadStatus('正在准备声音组件')
      await audioRuntimeWasmReady
      if (libmediaPlayer !== player) throw new Error('libmedia load superseded')
    }
    const resize = () => {
      if (libmediaPlayer !== player) return
      player.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    }
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    const frameTargetSeconds = currentTime.value
    if (pendingLibmediaStartTime > 0) {
      options.onLoadStatus('正在定位上次播放进度')
      try {
        await seekLibmediaToPendingStart(player)
      } catch (error) {
        console.warn('[EMOS REEL] 自动定位上次播放进度失败，将在点击播放时重试', error)
      }
    }
    if (libmediaPlayer === player && selectedVideoStream) {
      options.onLoadStatus('正在生成当前进度画面')
      await source.flushCache()
      await source.releaseNetworkStream()
      if (libmediaPlayer !== player) return
      await prepareLibmediaFramePoster({
        AVPlayer,
        Events,
        cacheKey,
        data: playDataBody,
        durationSeconds: duration.value,
        extension,
        getWasm: (type, codecId) => getLocalWasm(type, codecId) ?? '',
        headers: token && shouldAttachToken(sourceUrl) ? { Authorization: `Bearer ${token}` } : undefined,
        host: container,
        targetSeconds: frameTargetSeconds,
        url: resolvedSourceUrl.href,
        useWebCodecs,
        videoStreamId: selectedVideoStream.id,
      })
    }
  }

  async function loadShaka({ manifest, startTime, preferredAudioId }: LoadPlaybackOptions) {
    if (manifest.play_type !== 'm3u8') throw new Error('Shaka 播放源类型错误')
    const video = options.videoElement.value
    if (!video) throw new Error('Video element is unavailable')
    video.volume = volume.value
    video.muted = muted.value
    video.playbackRate = playbackRate.value
    options.onLoadStatus('正在获取视频内容')
    await loadShakaPlayer({ manifestText: manifest.play_data.m3u8_master, startTime, preferredAudioId })
    options.onLoadStatus('正在准备播放')
    syncVideoState()
  }

  async function load(loadOptions: LoadPlaybackOptions) {
    await destroy()
    engineKind.value = loadOptions.manifest.play_type === 'proxy' ? 'libmedia' : 'shaka'
    if (engineKind.value === 'libmedia') await loadLibmedia(loadOptions)
    else await loadShaka(loadOptions)
  }

  async function play() {
    if (engineKind.value === 'shaka') {
      await options.videoElement.value?.play()
      return
    }
    const player = libmediaPlayer
    if (!player) return
    if (libmediaPlayInProgress) return
    libmediaPlayInProgress = true
    const audioGesture = requestLibmediaAudioGesture(player)
    void requestPersistentMediaStorage()
    try {
      await enqueueLibmediaCommand(player, async () => {
        libmediaPlayRequested = true
        options.onLoadStatus('正在开始播放')
        await seekLibmediaToPendingStart(player)
        if (libmediaHasAudio) libmediaFirstAudioRendered = false
        if (libmediaHasVideo) libmediaFirstVideoRendered = false
        await startLibmediaPlayback(player, { audio: libmediaHasAudio, audioMasterForce: libmediaHasAudio }, audioGesture)

        if (player.isSuspended() && libmediaHasAudio) {
          await pauseLibmediaForAudioGesture(player)
          return
        }
        libmediaAudioContextBlocked = false
        options.onLoadStatus(libmediaHasAudio ? '正在等待画面和声音' : '画面马上就好')
        updateLibmediaPlayingState(player)
      })
    } catch (error) {
      if (isAudioContextGestureBlocked(error)) {
        const currentPlayer = libmediaPlayer
        if (currentPlayer) await pauseLibmediaForAudioGesture(currentPlayer)
        return
      }
      if (engineKind.value === 'libmedia') {
        const currentPlayer = libmediaPlayer
        if (currentPlayer) reportLibmediaError(error)
      }
      throw error
    } finally {
      libmediaPlayInProgress = false
    }
  }

  function getLibmediaPlayer() {
    return libmediaPlayer
  }

  async function pause() {
    if (engineKind.value === 'shaka') {
      options.videoElement.value?.pause()
      return
    }
    const player = libmediaPlayer
    libmediaPlayRequested = false
    if (player && libmediaStarted) await enqueueLibmediaCommand(player, () => player.pause())
  }

  async function togglePlayback() {
    if (paused.value) await play()
    else await pause()
  }

  async function seek(seconds: number) {
    const target = Math.min(duration.value || seconds, Math.max(0, seconds))
    const previousTime = currentTime.value
    currentTime.value = target
    if (engineKind.value === 'shaka') {
      const video = options.videoElement.value
      if (!video || Math.abs(video.currentTime - target) < 0.01) {
        seeking.value = false
        return
      }
      seeking.value = true
      shakaReadSource.value = undefined
      shakaReadAt.value = 0
      video.currentTime = target
      return
    }
    if (!libmediaPlayer || !libmediaStarted) {
      pendingLibmediaStartTime = target
      seeking.value = false
      return
    }
    libmediaSeeking = true
    seeking.value = true
    libmediaReadSource.value = undefined
    libmediaReadAt.value = 0
    libmediaBufferAheadSeconds = 0
    bufferAhead.value = 0
    playableBufferAhead.value = 0
    options.onWaiting()
    pendingLibmediaSeek = { previousTime, targetTime: target }
    try {
      await flushLibmediaSeek(libmediaPlayer)
    } catch (error) {
      libmediaSeeking = false
      seeking.value = false
      throw error
    }
  }

  function resetStoredMediaRanges() {
    if (engineKind.value !== 'libmedia') return
    libmediaSource?.resetCachedTimeline()
    libmediaStoredTimeRanges = []
    syncLibmediaBufferedRanges(libmediaPlayer)
  }

  function setMuted(nextMuted: boolean) {
    muted.value = nextMuted
    if (engineKind.value === 'shaka') {
      const video = options.videoElement.value
      if (video) video.muted = nextMuted
    } else {
      libmediaPlayer?.setVolume(nextMuted ? 0 : volume.value)
      if (!nextMuted && libmediaPlayer && libmediaStarted && !paused.value) {
        void libmediaPlayer.resume()
      }
    }
  }

  function toggleMute() {
    if (muted.value || volume.value === 0) {
      if (volume.value === 0) volume.value = lastAudibleVolume
      setMuted(false)
    } else {
      setMuted(true)
    }
  }

  function setVolume(nextVolume: number) {
    const normalized = Math.min(1, Math.max(0, nextVolume))
    volume.value = normalized
    muted.value = normalized === 0
    if (normalized > 0) lastAudibleVolume = normalized
    if (engineKind.value === 'shaka') {
      const video = options.videoElement.value
      if (video) {
        video.volume = normalized
        video.muted = normalized === 0
      }
    } else {
      libmediaPlayer?.setVolume(normalized)
      if (normalized > 0 && libmediaPlayer && libmediaStarted && !paused.value) {
        void libmediaPlayer.resume()
      }
    }
  }

  function setPlaybackRate(rate: number) {
    if (engineKind.value === 'shaka') {
      const video = options.videoElement.value
      if (video) {
        video.playbackRate = rate
        playbackRate.value = video.playbackRate
        return
      }
    } else {
      const player = libmediaPlayer
      if (player) {
        player.setPlaybackRate(rate)
        playbackRate.value = player.getPlaybackRate()
        return
      }
    }
    playbackRate.value = rate
  }

  async function selectAudioTrack(id: string) {
    if (engineKind.value === 'shaka') return selectShakaAudioTrack(id)
    const player = libmediaPlayer
    const streamId = Number(id)
    if (!player || !Number.isInteger(streamId)) return false
    const stream = findPlayableLibmediaAudioStream(player.getStreams(), streamId)
    if (!stream) return false
    if (!libmediaAudioStarted) {
      selectedLibmediaAudioId = streamId
      libmediaStreamSelection.set(AVMediaType.AVMEDIA_TYPE_AUDIO, stream)
      selectedAudioId.value = id
      return true
    }
    if (player.getSelectedAudioStreamId() === streamId) return true
    libmediaSeeking = true
    libmediaFirstAudioRendered = false
    options.onWaiting()
    try {
      await enqueueLibmediaCommand(player, async () => {
        const switchTime = Math.min(duration.value || currentTime.value, Math.max(0, currentTime.value))
        await player.selectAudio(streamId)
        if (player.getSelectedAudioStreamId() !== streamId) throw new Error('libmedia 音轨切换未生效')
        await seekLibmediaPlayer(player, switchTime)
        currentTime.value = switchTime
      })
    } finally {
      finishLibmediaSeek(player)
    }
    if (player !== libmediaPlayer) return false
    selectedLibmediaAudioId = streamId
    libmediaStreamSelection.set(AVMediaType.AVMEDIA_TYPE_AUDIO, stream)
    selectedAudioId.value = id
    return true
  }

  async function togglePictureInPicture() {
    const video = options.videoElement.value
    if (engineKind.value !== 'shaka' || !video || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
  }

  function getVideoBufferAhead(video: HTMLVideoElement) {
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) >= video.currentTime) {
        return Math.max(0, video.buffered.end(index) - video.currentTime)
      }
    }
    return 0
  }

  function getDebugStats(): PlaybackDebugStats | undefined {
    if (engineKind.value === 'shaka') {
      const stats = getShakaStats()
      const video = options.videoElement.value
      if (!stats || !video) return undefined
      return {
        showLibmediaDiagnostics: false,
        bufferDiagnostics: '--',
        persistentReadAhead: '--',
        streamState: '--',
        downloadSpeed: Date.now() - lastSegmentDownloadAt.value <= 12_000 ? segmentDownloadBitsPerSecond.value : 0,
        estimatedBandwidth: stats.estimatedBandwidth,
        streamBandwidth: stats.streamBandwidth,
        width: Number.isFinite(stats.width) ? stats.width : video.videoWidth,
        height: Number.isFinite(stats.height) ? stats.height : video.videoHeight,
        decodedFrames: Number.isFinite(stats.decodedFrames) ? stats.decodedFrames : 0,
        droppedFrames: Number.isFinite(stats.droppedFrames) ? stats.droppedFrames : 0,
        codecs: stats.currentCodecs || '--',
        seekLogs: [],
      }
    }
    const stats = libmediaPlayer?.getStats()
    if (!stats) return undefined
    const recentDownloadSpeed = Date.now() - lastSegmentDownloadAt.value <= 12_000 ? segmentDownloadBitsPerSecond.value : 0
    const packetBuffer = getLibmediaPacketBufferStats(libmediaPlayer)
    const byteAhead = libmediaSource?.getReadAheadSeconds(currentTime.value, duration.value)
    syncLibmediaBufferedRanges(libmediaPlayer)
    const persistentReadAhead = libmediaSource?.getPersistentReadAhead()
    const persistentState = persistentReadAhead
      ? persistentReadAhead.state === 'filling'
        ? `补充中 · ${persistentReadAhead.cachedAheadSeconds.toFixed(1)} / ${persistentReadAhead.targetSeconds} 秒`
        : persistentReadAhead.state === 'holding'
          ? `已暂停 · ${persistentReadAhead.cachedAheadSeconds.toFixed(1)} 秒，降至 ${persistentReadAhead.resumeSeconds} 秒后继续`
          : `等待 · ${persistentReadAhead.cachedAheadSeconds.toFixed(1)} 秒`
      : '不可用'
    const streamState = persistentReadAhead
      ? {
          closed: '流未连接',
          connecting: '流连接中',
          reading: '流读取中',
          retained: '流已保留',
          overwriting: '流覆盖短缓存',
        }[persistentReadAhead.streamState]
      : undefined
    const sessionState = persistentReadAhead
      ? {
          idle: '会话空闲',
          opening: '会话打开',
          ready: '会话就绪',
          reading: '会话读取',
          seeking: '会话定位',
          stopping: '会话停止',
          stopped: '会话结束',
          failed: '会话失败',
        }[persistentReadAhead.sessionState]
      : undefined
    return {
      showLibmediaDiagnostics: true,
      bufferDiagnostics: [
        `V ${packetBuffer.videoPackets}/${packetBuffer.videoRate || '--'} fps`,
        `A ${packetBuffer.audioPackets}/${packetBuffer.audioRate ? packetBuffer.audioRate.toFixed(1) : '--'} fps`,
        `byte ${byteAhead == null ? '--' : `${byteAhead.toFixed(1)} s`}`,
      ].join(' · '),
      persistentReadAhead: persistentState,
      streamState: streamState && sessionState ? `${sessionState} · ${streamState} @ byte ${persistentReadAhead!.streamPosition.toLocaleString()}` : '--',
      downloadSpeed: recentDownloadSpeed,
      estimatedBandwidth: recentDownloadSpeed,
      streamBandwidth: Math.max(stats.videoBitrate + stats.audioBitrate, libmediaSource?.getAverageBitrate(duration.value) ?? 0),
      width: stats.width,
      height: stats.height,
      decodedFrames: numberFromCounter(stats.videoFrameDecodeCount),
      droppedFrames: numberFromCounter(stats.videoFrameDropCount),
      codecs: `${options.decoderMode.value === 'webcodecs' ? 'HW' : 'SW'} · ${[stats.videocodec, stats.audiocodec].filter(Boolean).join(' / ') || '--'}`,
      seekLogs: libmediaSeekLogs.map((entry) => ({
        ...entry,
        byteTargets: [...entry.byteTargets],
        rangeStarts: [...entry.rangeStarts],
        rangeTtfbMs: [...entry.rangeTtfbMs],
      })),
    }
  }

  async function destroy() {
    engineKind.value = undefined
    stopLibmediaBufferSync()
    libmediaFramePreviewAbortController?.abort()
    libmediaFramePreviewAbortController = undefined
    const framePreviewCleanup = libmediaFramePreviewPromise?.catch(() => undefined)
    libmediaFramePreviewPromise = undefined
    removeLibmediaFramePoster()
    resizeObserver?.disconnect()
    resizeObserver = undefined
    const currentLibmediaPlayer = libmediaPlayer
    const currentLibmediaSource = libmediaSource
    const rejectOperation = rejectPendingLibmediaOperation
    const previousLibmediaCleanup = libmediaCleanupQueue
    libmediaPlayer = undefined
    libmediaSource = undefined
    libmediaStarted = false
    libmediaAudioStarted = false
    libmediaPlayRequested = false
    libmediaPlayInProgress = false
    libmediaSeeking = false
    seeking.value = false
    libmediaCacheReadAt.value = 0
    libmediaReadSource.value = undefined
    libmediaReadAt.value = 0
    libmediaStreamCatchingUp.value = false
    libmediaStreamCatchUpSeconds.value = 0
    libmediaBufferAheadSeconds = 0
    libmediaStoredTimeRanges = []
    libmediaSeekLogs = []
    libmediaHasAudio = false
    libmediaHasVideo = false
    libmediaAudioContextBlocked = false
    libmediaFirstAudioRendered = false
    libmediaFirstVideoRendered = false
    libmediaObservedPlaybackTime = undefined
    libmediaStreamSelection.clear()
    selectedLibmediaAudioId = undefined
    rejectPendingLibmediaOperation = undefined
    reportedLibmediaError = undefined
    pendingLibmediaStartTime = 0
    pendingLibmediaSeek = undefined
    const sourceStop = stopLibmediaSource(currentLibmediaSource, 'libmedia destroy')
    const commandQueue = libmediaCommandQueue
    rejectOperation?.(new Error('libmedia operation superseded'))
    const currentCleanup = (async () => {
      await previousLibmediaCleanup
      await sourceStop
      await commandQueue
      await Promise.all([destroyShakaPlayer(), currentLibmediaPlayer?.destroy().catch(() => undefined), framePreviewCleanup])
    })()
    libmediaCleanupQueue = currentCleanup.catch(() => undefined)
    await currentCleanup
    libmediaCommandQueue = Promise.resolve()
    libmediaSeekFlush = undefined
    options.libmediaContainer.value?.replaceChildren()
    audioOptions.value = []
    bufferedRanges.value = []
    currentTime.value = 0
    duration.value = 0
    bufferAhead.value = 0
    playableBufferAhead.value = 0
    paused.value = true
    selectedAudioId.value = ''
    segmentDownloadBitsPerSecond.value = 0
    lastSegmentDownloadAt.value = 0
  }

  watch(options.videoElement, bindVideoEvents, { immediate: true, flush: 'post' })
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  watch([shakaAudioOptions, shakaSelectedAudioId], () => {
    if (engineKind.value !== 'shaka') return
    audioOptions.value = shakaAudioOptions.value
    selectedAudioId.value = shakaSelectedAudioId.value
  })
  onBeforeUnmount(() => {
    videoEventController?.abort()
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    void destroy()
  })

  return {
    audioOptions,
    bufferAhead,
    bufferedRanges,
    canPictureInPicture,
    currentTime,
    destroy,
    duration,
    engineKind,
    getDebugStats,
    getLibmediaPlayer,
    getShakaPlayer,
    lastCacheReadAt,
    lastSegmentDownloadAt,
    lastMediaReadAt,
    load,
    mediaReadSource,
    muted,
    pause,
    paused,
    play,
    playbackRate,
    playableBufferAhead,
    resetStoredMediaRanges,
    seek,
    seeking,
    segmentDownloadBitsPerSecond,
    selectAudioTrack,
    selectedAudioId,
    setMuted,
    setPlaybackRate,
    setVolume,
    streamCatchingUp,
    streamCatchUpSeconds: computed(() => (engineKind.value === 'libmedia' ? libmediaStreamCatchUpSeconds.value : 0)),
    toggleMute,
    togglePictureInPicture,
    togglePlayback,
    volume,
  }
}
