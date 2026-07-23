import { useIntervalFn } from '@vueuse/core'
import { onBeforeUnmount, ref, type Ref, watch } from 'vue'
import type { PlaybackDebugStats } from '@/composables/usePlaybackEngine'
import { clearMediaCache, getMediaCacheStats } from '@/libmedia/mediaCache'
import type { PlaybackReadSource, PlayerDebugSnapshot } from '@/types/player'
import { formatFileSize } from '@/utils/file-size'
import { formatBitrate, formatTransferSpeed } from '@/utils/player-metrics'

interface UsePlayerDebugOptions {
  visible: Ref<boolean>
  playerShell: Ref<HTMLElement | undefined>
  mediaId: Readonly<Ref<string>>
  mediaName: Readonly<Ref<string>>
  storageLocation: Readonly<Ref<string>>
  lastCacheReadAt: Readonly<Ref<number>>
  lastMediaReadAt: Readonly<Ref<number>>
  lastSegmentDownloadAt: Readonly<Ref<number>>
  mediaReadSource: Readonly<Ref<PlaybackReadSource | undefined>>
  segmentDownloadBitsPerSecond: Readonly<Ref<number>>
  streamCatchingUp: Readonly<Ref<boolean>>
  streamCatchUpSeconds: Readonly<Ref<number>>
  getDebugStats: () => PlaybackDebugStats | undefined
  resetStoredMediaRanges: () => void
}

const mediaReadActiveMs = 12_000

function initialDebugSnapshot(): PlayerDebugSnapshot {
  return {
    showLibmediaDiagnostics: false,
    readStatus: '暂无读取',
    bufferDiagnostics: '--',
    persistentReadAhead: '--',
    streamState: '--',
    estimatedBandwidth: '--',
    streamBandwidth: '--',
    viewport: '--',
    resolution: '--',
    droppedFrames: '--',
    codecs: '--',
    mediaCache: '读取中',
    mediaId: '',
    mediaName: '',
    storageLocation: '',
    seekLogs: [],
  }
}

function readStatus(options: UsePlayerDebugOptions, stats: PlaybackDebugStats) {
  const currentTimestamp = Date.now()
  const cacheReadActive = currentTimestamp - options.lastCacheReadAt.value <= mediaReadActiveMs
  const readActive = currentTimestamp - options.lastMediaReadAt.value <= mediaReadActiveMs

  if (options.streamCatchingUp.value) {
    const seconds = Math.max(1, Math.round(options.streamCatchUpSeconds.value))
    return options.streamCatchUpSeconds.value > 0 ? `本机缓存，网络还差约 ${seconds} 秒` : '本机缓存，网络追赶中'
  }
  if (cacheReadActive && readActive && options.mediaReadSource.value === 'network') return '本机缓存 + 网络'
  if (cacheReadActive || (readActive && options.mediaReadSource.value === 'cache')) return '本机缓存'
  if (readActive && options.mediaReadSource.value === 'network') {
    return stats.downloadSpeed > 0 ? `网络 ${formatTransferSpeed(stats.downloadSpeed)}` : '网络读取中'
  }
  return '暂无读取'
}

export function usePlayerDebug(options: UsePlayerDebugOptions) {
  const debugSnapshot = ref<PlayerDebugSnapshot>(initialDebugSnapshot())
  const cacheClearing = ref(false)

  function updateDebugSnapshot() {
    const shell = options.playerShell.value
    const stats = options.getDebugStats()
    if (!stats) return
    const droppedPercent = stats.decodedFrames > 0 ? (stats.droppedFrames / stats.decodedFrames) * 100 : 0
    debugSnapshot.value = {
      showLibmediaDiagnostics: stats.showLibmediaDiagnostics,
      readStatus: readStatus(options, stats),
      bufferDiagnostics: stats.bufferDiagnostics,
      persistentReadAhead: stats.persistentReadAhead,
      streamState: stats.streamState,
      estimatedBandwidth: formatTransferSpeed(stats.estimatedBandwidth),
      streamBandwidth: formatBitrate(stats.streamBandwidth),
      viewport: shell ? `${shell.clientWidth} × ${shell.clientHeight}` : '--',
      resolution: stats.width > 0 && stats.height > 0 ? `${stats.width} × ${stats.height}` : '--',
      droppedFrames: `${stats.droppedFrames} / ${stats.decodedFrames} (${droppedPercent.toFixed(2)}%)`,
      codecs: stats.codecs,
      mediaCache: debugSnapshot.value.mediaCache,
      mediaId: options.mediaId.value,
      mediaName: options.mediaName.value || '--',
      storageLocation: options.storageLocation.value || '',
      seekLogs: stats.seekLogs,
    }
  }

  async function refreshMediaCacheStats() {
    if (!debugSnapshot.value.showLibmediaDiagnostics) return
    const stats = await getMediaCacheStats()
    debugSnapshot.value = {
      ...debugSnapshot.value,
      mediaCache: `${formatFileSize(stats.bytes) || '0 MB'} / ${formatFileSize(stats.limitBytes) || '--'} · ${stats.chunks} 块`,
    }
  }

  async function clearDebugMediaCache() {
    if (cacheClearing.value) return
    cacheClearing.value = true
    try {
      await clearMediaCache()
      options.resetStoredMediaRanges()
      await refreshMediaCacheStats()
    } catch (error) {
      console.warn('[EMOS REEL] 清除媒体缓存失败', error)
      debugSnapshot.value = { ...debugSnapshot.value, mediaCache: '清除失败' }
    } finally {
      cacheClearing.value = false
    }
  }

  const { pause: pauseDebugUpdates, resume: resumeDebugUpdates } = useIntervalFn(updateDebugSnapshot, 1000, { immediate: false })
  const { pause: pauseCacheStatsUpdates, resume: resumeCacheStatsUpdates } = useIntervalFn(() => void refreshMediaCacheStats(), 10_000, { immediate: false })

  function stop() {
    pauseDebugUpdates()
    pauseCacheStatsUpdates()
  }

  function handleStatsChanged() {
    if (options.visible.value) updateDebugSnapshot()
  }

  watch(options.visible, (visible) => {
    if (visible) {
      updateDebugSnapshot()
      if (debugSnapshot.value.showLibmediaDiagnostics) void refreshMediaCacheStats()
      resumeDebugUpdates()
      resumeCacheStatsUpdates()
    } else {
      stop()
    }
  })
  onBeforeUnmount(stop)

  return {
    cacheClearing,
    clearDebugMediaCache,
    debugSnapshot,
    handleStatsChanged,
    stop,
  }
}
