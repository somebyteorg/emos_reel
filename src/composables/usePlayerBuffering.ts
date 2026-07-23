import { useNow, useTimeoutFn } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { PlaybackReadSource } from '@/types/player'
import { formatTransferSpeed } from '@/utils/player-metrics'

interface UsePlayerBufferingOptions {
  ready: Readonly<Ref<boolean>>
  paused: Readonly<Ref<boolean>>
  seeking: Readonly<Ref<boolean>>
  lastCacheReadAt: Readonly<Ref<number>>
  lastMediaReadAt: Readonly<Ref<number>>
  lastSegmentDownloadAt: Readonly<Ref<number>>
  mediaReadSource: Readonly<Ref<PlaybackReadSource | undefined>>
  segmentDownloadBitsPerSecond: Readonly<Ref<number>>
  bufferAhead?: Readonly<Ref<number>>
  streamCatchingUp: Readonly<Ref<boolean>>
  streamCatchUpSeconds: Readonly<Ref<number>>
}

const mediaReadActiveMs = 12_000
const bufferingShowBelowSeconds = 3
const bufferingHideAboveSeconds = 10

export function usePlayerBuffering(options: UsePlayerBufferingOptions) {
  const now = useNow({ interval: 1_000 })
  const waitingNoticeVisible = ref(false)
  const { start: startBufferingNotice, stop: stopBufferingNotice } = useTimeoutFn(
    () => {
      if (options.ready.value && !options.paused.value) waitingNoticeVisible.value = true
    },
    450,
    { immediate: false },
  )
  const bufferingVisible = computed(() => {
    if (!options.ready.value) return false
    if (options.seeking.value) return true
    if (options.paused.value) return false
    const bufferAhead = options.bufferAhead?.value ?? Number.POSITIVE_INFINITY
    if (waitingNoticeVisible.value) return true
    if (bufferAhead > bufferingHideAboveSeconds) return false
    return bufferAhead < bufferingShowBelowSeconds
  })
  const bufferingDetail = computed(() => {
    const currentTimestamp = now.value.getTime()
    const cacheReadActive = currentTimestamp - options.lastCacheReadAt.value <= mediaReadActiveMs
    const mediaReadActive = currentTimestamp - options.lastMediaReadAt.value <= mediaReadActiveMs
    const networkSpeed =
      options.segmentDownloadBitsPerSecond.value > 0 && currentTimestamp - options.lastSegmentDownloadAt.value <= mediaReadActiveMs
        ? formatTransferSpeed(options.segmentDownloadBitsPerSecond.value)
        : ''
    const bufferAhead = options.bufferAhead?.value ?? Number.POSITIVE_INFINITY
    if (options.streamCatchingUp.value) {
      const seconds = Math.max(1, Math.round(options.streamCatchUpSeconds.value))
      if (networkSpeed) return options.streamCatchUpSeconds.value > 0 ? `网络 ${networkSpeed}，还差约 ${seconds} 秒` : `网络 ${networkSpeed}`
      return options.streamCatchUpSeconds.value > 0 ? `网络还差约 ${seconds} 秒` : '网络正在追赶'
    }
    if (bufferAhead >= 0 && bufferAhead < bufferingShowBelowSeconds && networkSpeed) return `网络 ${networkSpeed}`
    if (mediaReadActive && options.mediaReadSource.value === 'network') return networkSpeed ? `网络 ${networkSpeed}` : '正在通过网络读取'
    if (cacheReadActive) return ''
    if (!mediaReadActive) return ''
    return ''
  })

  function handleBufferingStart() {
    if (!options.ready.value) return
    if (options.seeking.value) {
      stopBufferingNotice()
      waitingNoticeVisible.value = true
      return
    }
    if (options.paused.value) return
    stopBufferingNotice()
    startBufferingNotice()
  }

  function handleBufferingEnd() {
    stopBufferingNotice()
    waitingNoticeVisible.value = false
  }

  onBeforeUnmount(stopBufferingNotice)

  return {
    bufferingDetail,
    bufferingVisible,
    handleBufferingEnd,
    handleBufferingStart,
    stopBufferingNotice,
  }
}
