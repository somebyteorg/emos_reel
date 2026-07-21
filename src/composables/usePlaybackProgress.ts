import { useIntervalFn, useThrottleFn } from '@vueuse/core'
import type { Ref } from 'vue'
import { updatePlaybackProgress } from '@/api/emos'
import { useSignStore } from '@/stores/sign'
import { updatePlayerProgress } from '@/utils/player-context'

interface UsePlaybackProgressOptions {
  mediaId: Readonly<Ref<string>>
  currentTime: Ref<number>
  playbackRate: Ref<number>
  ready: Readonly<Ref<boolean>>
  paused: Readonly<Ref<boolean>>
}

export function usePlaybackProgress(options: UsePlaybackProgressOptions) {
  const signStore = useSignStore()
  const lastSubmittedSeconds = new Map<string, number>()
  let successfulMediaId = ''
  let updateEpoch = 0
  let sessionEpoch = 0

  const persistContextThrottled = useThrottleFn((mediaId: string, seconds: number, epoch: number) => {
    if (epoch === sessionEpoch && options.ready.value) updatePlayerProgress(mediaId, seconds)
  }, 5000)

  function persistContext() {
    persistContextThrottled(options.mediaId.value, options.currentTime.value, sessionEpoch)
  }

  async function submit(keepalive = false, targetMediaId = options.mediaId.value, seconds = options.currentTime.value, rate = options.playbackRate.value) {
    if (!signStore.isSignedIn || !targetMediaId || targetMediaId !== successfulMediaId || !Number.isFinite(seconds) || seconds < 0) return

    const submittedSeconds = Math.max(0, Math.floor(seconds))
    if (lastSubmittedSeconds.get(targetMediaId) === submittedSeconds) return
    lastSubmittedSeconds.set(targetMediaId, submittedSeconds)
    try {
      await updatePlaybackProgress(
        {
          media_id: targetMediaId,
          play_speed: Math.max(1, Math.round(rate * 10)),
          play_seconds: submittedSeconds,
        },
        keepalive,
      )
    } catch {
      if (lastSubmittedSeconds.get(targetMediaId) === submittedSeconds) {
        lastSubmittedSeconds.delete(targetMediaId)
      }
    }
  }

  function submitLatest(keepalive = false, targetMediaId = options.mediaId.value, seconds = options.currentTime.value, rate = options.playbackRate.value) {
    updateEpoch += 1
    void submit(keepalive, targetMediaId, seconds, rate)
  }

  const submitThrottled = useThrottleFn(
    (targetMediaId: string, seconds: number, rate: number, epoch: number) => {
      if (epoch !== updateEpoch) return
      void submit(false, targetMediaId, seconds, rate)
    },
    5000,
    true,
    true,
  )
  const { pause, resume } = useIntervalFn(
    () => {
      if (options.ready.value && !options.paused.value) submitLatest()
    },
    60_000,
    { immediate: false },
  )

  function requestUpdate() {
    if (!options.ready.value) return
    submitThrottled(options.mediaId.value, options.currentTime.value, options.playbackRate.value, updateEpoch)
  }

  function markPlaybackSuccessful() {
    successfulMediaId = options.mediaId.value
    resume()
    requestUpdate()
  }

  function reset() {
    successfulMediaId = ''
    updateEpoch += 1
    sessionEpoch += 1
    pause()
  }

  return {
    markPlaybackSuccessful,
    pause,
    persistContext,
    requestUpdate,
    reset,
    submitLatest,
  }
}
