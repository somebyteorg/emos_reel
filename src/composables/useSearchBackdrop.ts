import { computed, type MaybeRefOrGetter, ref, toValue } from 'vue'
import { getVideoImages, imageUrl } from '@/api/todb'
import type { TodbVideoListItem } from '@/api/types'

export function useSearchBackdrop(previewDisabled: MaybeRefOrGetter<boolean>) {
  const backgroundImage = ref('')
  const outgoingBackgroundImage = ref('')
  let requestSequence = 0
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let fadeTimer: ReturnType<typeof setTimeout> | undefined

  const disabled = computed(() => toValue(previewDisabled))

  function clearHoverTimer() {
    if (!hoverTimer) return
    clearTimeout(hoverTimer)
    hoverTimer = undefined
  }

  function clearFadeTimer() {
    if (!fadeTimer) return
    clearTimeout(fadeTimer)
    fadeTimer = undefined
  }

  function preloadImage(source: string) {
    return new Promise<void>((resolve) => {
      const image = new Image()
      image.onload = () => resolve()
      image.onerror = () => resolve()
      image.src = source
    })
  }

  function applyBackgroundImage(nextBackground: string) {
    if (nextBackground === backgroundImage.value) return
    clearFadeTimer()
    outgoingBackgroundImage.value = backgroundImage.value
    backgroundImage.value = nextBackground
    fadeTimer = setTimeout(() => {
      outgoingBackgroundImage.value = ''
      fadeTimer = undefined
    }, 900)
  }

  async function resolveBackgroundImage(item: TodbVideoListItem) {
    try {
      const images = await getVideoImages(item.video_id, 1)
      const backdrop = imageUrl(images[0]?.image_path)
      if (backdrop) return backdrop
    } catch {
      // Fall back to the poster so the page still has a visual anchor.
    }
    return imageUrl(item.image_poster, 'w500') || imageUrl(item.image_poster, 'w300') || ''
  }

  async function setFromItem(item: TodbVideoListItem | undefined, clearWhenMissing = false) {
    if (!item) {
      requestSequence += 1
      applyBackgroundImage('')
      return
    }

    const currentRequest = ++requestSequence
    const nextBackground = await resolveBackgroundImage(item)
    if (!nextBackground || currentRequest !== requestSequence) {
      if (clearWhenMissing && currentRequest === requestSequence) applyBackgroundImage('')
      return
    }
    await preloadImage(nextBackground)
    if (currentRequest === requestSequence) applyBackgroundImage(nextBackground)
  }

  function schedulePreview(item: TodbVideoListItem) {
    if (disabled.value) return
    clearHoverTimer()
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined
      void setFromItem(item)
    }, 300)
  }

  function restoreDefault(item: TodbVideoListItem | undefined) {
    if (disabled.value) return
    clearHoverTimer()
    void setFromItem(item, true)
  }

  function dispose() {
    clearHoverTimer()
    clearFadeTimer()
    requestSequence += 1
  }

  return {
    backgroundImage,
    outgoingBackgroundImage,
    dispose,
    restoreDefault,
    schedulePreview,
    setFromItem,
  }
}
