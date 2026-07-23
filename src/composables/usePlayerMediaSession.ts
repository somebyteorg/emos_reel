import { useDocumentVisibility, useThrottleFn } from '@vueuse/core'
import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue'

interface UsePlayerMediaSessionOptions {
  ready: Readonly<Ref<boolean>>
  paused: Readonly<Ref<boolean>>
  currentTime: Readonly<Ref<number>>
  duration: Readonly<Ref<number>>
  playbackRate: Readonly<Ref<number>>
  title: Readonly<Ref<string>>
  artist: Readonly<Ref<string>>
  canPrevious: Readonly<Ref<boolean>>
  canNext: Readonly<Ref<boolean>>
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
  playPrevious: () => void
  playNext: () => void
}

const mediaSessionActions: MediaSessionAction[] = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']

export function usePlayerMediaSession(options: UsePlayerMediaSessionOptions) {
  const documentVisibility = useDocumentVisibility()
  let wakeLock: WakeLockSentinel | undefined
  let wakeLockRequesting = false

  function syncMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: options.title.value,
      artist: options.artist.value,
      album: 'EMOS REEL',
    })
  }

  function syncPosition() {
    if (!('mediaSession' in navigator)) return
    if (!Number.isFinite(options.duration.value) || options.duration.value <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: options.duration.value,
        playbackRate: options.playbackRate.value || 1,
        position: Math.min(options.duration.value, Math.max(0, options.currentTime.value)),
      })
    } catch {
      // Metadata and duration can briefly be out of sync during media changes.
    }
  }

  const updatePosition = useThrottleFn(syncPosition, 1000)

  function setupActions() {
    if (!('mediaSession' in navigator)) return
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Some browsers expose Media Session without every action.
      }
    }
    setHandler('play', options.play)
    setHandler('pause', options.pause)
    setHandler('seekbackward', (details) => {
      options.seekTo(Math.max(0, options.currentTime.value - (details.seekOffset || 10)))
    })
    setHandler('seekforward', (details) => {
      const target = options.currentTime.value + (details.seekOffset || 10)
      options.seekTo(Number.isFinite(options.duration.value) ? Math.min(options.duration.value, target) : target)
    })
    setHandler('seekto', (details) => {
      if (details.seekTime != null) options.seekTo(details.seekTime)
    })
    setHandler('previoustrack', () => {
      if (options.canPrevious.value) options.playPrevious()
    })
    setHandler('nexttrack', () => {
      if (options.canNext.value) options.playNext()
    })
  }

  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return
    for (const action of mediaSessionActions) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      } catch {
        // Ignore actions unavailable in the current browser.
      }
    }
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  }

  async function releaseWakeLock() {
    const lock = wakeLock
    wakeLock = undefined
    if (lock) await lock.release().catch(() => undefined)
  }

  async function syncWakeLock() {
    const shouldHold = options.ready.value && !options.paused.value && documentVisibility.value === 'visible'
    if (!shouldHold) {
      await releaseWakeLock()
      return
    }
    if (wakeLock || wakeLockRequesting || !('wakeLock' in navigator)) return
    wakeLockRequesting = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (!options.ready.value || options.paused.value || documentVisibility.value !== 'visible') {
        await lock.release()
        return
      }
      wakeLock = lock
      lock.addEventListener(
        'release',
        () => {
          if (wakeLock === lock) wakeLock = undefined
        },
        { once: true },
      )
    } catch {
      wakeLock = undefined
    } finally {
      wakeLockRequesting = false
    }
  }

  function syncPlaybackState() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = options.ready.value ? (options.paused.value ? 'paused' : 'playing') : 'none'
  }

  watch([options.title, options.artist], syncMetadata)
  watch([options.ready, options.paused, documentVisibility], () => {
    syncPlaybackState()
    void syncWakeLock()
  })
  onMounted(() => {
    setupActions()
    syncMetadata()
  })
  onBeforeUnmount(() => {
    clearMediaSession()
    void releaseWakeLock()
  })

  return { syncMetadata, syncPosition, updatePosition }
}
