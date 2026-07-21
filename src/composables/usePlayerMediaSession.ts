import { useDocumentVisibility, useThrottleFn } from '@vueuse/core'
import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue'

interface UsePlayerMediaSessionOptions {
  videoElement: Ref<HTMLVideoElement | undefined>
  ready: Readonly<Ref<boolean>>
  paused: Readonly<Ref<boolean>>
  title: Readonly<Ref<string>>
  artist: Readonly<Ref<string>>
  artwork: Readonly<Ref<string | null | undefined>>
  canPrevious: Readonly<Ref<boolean>>
  canNext: Readonly<Ref<boolean>>
  seekTo: (seconds: number) => void
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
    const artwork = options.artwork.value ? [{ src: options.artwork.value }] : undefined
    navigator.mediaSession.metadata = new MediaMetadata({
      title: options.title.value,
      artist: options.artist.value,
      album: 'EMOS REEL',
      artwork,
    })
  }

  function syncPosition() {
    if (!('mediaSession' in navigator)) return
    const video = options.videoElement.value
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: video.duration,
        playbackRate: video.playbackRate || 1,
        position: Math.min(video.duration, Math.max(0, video.currentTime)),
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
    setHandler('play', () => {
      void options.videoElement.value?.play()
    })
    setHandler('pause', () => options.videoElement.value?.pause())
    setHandler('seekbackward', (details) => {
      const video = options.videoElement.value
      if (video) options.seekTo(Math.max(0, video.currentTime - (details.seekOffset || 10)))
    })
    setHandler('seekforward', (details) => {
      const video = options.videoElement.value
      if (!video) return
      const target = video.currentTime + (details.seekOffset || 10)
      options.seekTo(Number.isFinite(video.duration) ? Math.min(video.duration, target) : target)
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

  watch([options.title, options.artist, options.artwork], syncMetadata)
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
