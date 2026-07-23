import { useEventListener } from '@vueuse/core'

interface PlayerKeyboardShortcutsOptions {
  currentTime: () => number
  duration: () => number
  isOverlayOpen: () => boolean
  isReady: () => boolean
  seekTo: (seconds: number) => void
  showControls: () => void
  toggleFullscreen: () => void | Promise<void>
  toggleMute: () => void
  togglePlayback: () => void
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function usePlayerKeyboardShortcuts(options: PlayerKeyboardShortcutsOptions) {
  useEventListener(document, 'keydown', (event) => {
    if (options.isOverlayOpen() || isEditableTarget(event.target)) return
    const target = event.target instanceof HTMLElement ? event.target : undefined

    if (event.code === 'Space') {
      if (target?.tagName === 'BUTTON') return
      event.preventDefault()
      options.showControls()
      options.togglePlayback()
      return
    }

    if (event.key === 'ArrowRight' && options.isReady()) {
      event.preventDefault()
      options.showControls()
      options.seekTo(Math.min(options.duration(), options.currentTime() + 10))
      return
    }

    if (event.key === 'ArrowLeft' && options.isReady()) {
      event.preventDefault()
      options.showControls()
      options.seekTo(Math.max(0, options.currentTime() - 10))
      return
    }

    if (event.key.toLowerCase() === 'm') {
      options.showControls()
      options.toggleMute()
      return
    }

    if (event.key.toLowerCase() === 'f') {
      options.showControls()
      void options.toggleFullscreen()
    }
  })
}
