import { useSessionStorage } from '@vueuse/core'
import { nextTick, ref, type Ref, watch } from 'vue'
import type shaka from 'shaka-player'
import type { PlaybackManifest } from '@/api/types'
import type { SubtitleBackgroundMode, SubtitleFontSize, SubtitleOption, SubtitlePosition } from '@/types/player'

export type SubtitlePreference = Pick<SubtitleOption, 'title' | 'language'> | 'off' | undefined

interface UsePlayerSubtitlesOptions {
  videoElement: Ref<HTMLVideoElement | undefined>
  getPlayer: () => shaka.Player | undefined
}

export function usePlayerSubtitles({ videoElement, getPlayer }: UsePlayerSubtitlesOptions) {
  const selectedSubtitle = ref<string | number>('off')
  const subtitleOptions = ref<SubtitleOption[]>([])
  const subtitleFontSize = useSessionStorage<SubtitleFontSize>('emos_reel.player.subtitle.font_size.v2', 'system')
  const subtitleBackgroundMode = useSessionStorage<SubtitleBackgroundMode>('emos_reel.player.subtitle.background_mode', 'system')
  const subtitleBackgroundOpacity = useSessionStorage('emos_reel.player.subtitle.background_opacity', 0.72)
  const subtitlePosition = useSessionStorage<SubtitlePosition>('emos_reel.player.subtitle.position.v2', 'system')
  const boundNativeTextTracks = new WeakSet<TextTrack>()
  const originalCuePositions = new WeakMap<TextTrackCue, Pick<VTTCue, 'line' | 'lineAlign' | 'snapToLines'>>()
  let boundPlayer: shaka.Player | undefined
  let pendingLoad:
    | {
        manifest: PlaybackManifest
        preference: SubtitlePreference
        player: shaka.Player
      }
    | undefined

  function syncSelectedSubtitle(player = boundPlayer) {
    if (!player || player !== getPlayer()) return
    selectedSubtitle.value = player.getTextTracks().find((track) => track.active)?.id ?? 'off'
  }

  function refreshSubtitleOptions(player = boundPlayer) {
    if (!player || player !== getPlayer()) return
    const currentOptions = new Map(subtitleOptions.value.map((option) => [option.track.id, option]))
    subtitleOptions.value = player.getTextTracks().map((track, index) => {
      const current = currentOptions.get(track.id)
      return {
        track,
        title: current?.title || track.label || track.language || `字幕 ${index + 1}`,
        language: current?.language || track.language,
      }
    })
    syncSelectedSubtitle(player)
  }

  function handleTextChanged() {
    syncSelectedSubtitle()
  }

  function handleTracksChanged() {
    refreshSubtitleOptions()
  }

  function unbindPlayer() {
    if (!boundPlayer) return
    boundPlayer.removeEventListener('textchanged', handleTextChanged)
    boundPlayer.removeEventListener('trackschanged', handleTracksChanged)
    boundPlayer = undefined
  }

  function bindPlayer(player: shaka.Player) {
    if (boundPlayer === player) return
    unbindPlayer()
    boundPlayer = player
    player.addEventListener('textchanged', handleTextChanged)
    player.addEventListener('trackschanged', handleTracksChanged)
    refreshSubtitleOptions(player)
  }

  function selectSubtitle(option?: SubtitleOption) {
    const player = getPlayer()
    if (!player) return
    try {
      player.selectTextTrack(option?.track ?? null)
      syncSelectedSubtitle(player)
    } catch {
      syncSelectedSubtitle(player)
    }
  }

  function applySubtitlePosition(track: TextTrack) {
    if (!track.cues) return
    for (const cue of Array.from(track.cues)) {
      if (!('line' in cue)) continue
      const videoCue = cue as VTTCue
      if (!originalCuePositions.has(cue)) {
        originalCuePositions.set(cue, {
          line: videoCue.line,
          lineAlign: videoCue.lineAlign,
          snapToLines: videoCue.snapToLines,
        })
      }
      if (subtitlePosition.value === 'system') {
        const original = originalCuePositions.get(cue)
        if (original) {
          videoCue.line = original.line
          videoCue.lineAlign = original.lineAlign
          videoCue.snapToLines = original.snapToLines
        }
        continue
      }
      const line = subtitlePosition.value === 'bottom' ? 92 : subtitlePosition.value === 'raised' ? 80 : 65
      videoCue.snapToLines = false
      videoCue.line = line
      videoCue.lineAlign = 'end'
    }
  }

  function syncNativeTracks() {
    const video = videoElement.value
    if (!video) return
    for (const track of Array.from(video.textTracks)) {
      if (!boundNativeTextTracks.has(track)) {
        boundNativeTextTracks.add(track)
        track.addEventListener('cuechange', () => applySubtitlePosition(track))
      }
      applySubtitlePosition(track)
    }
  }

  async function addSubtitles(manifest: PlaybackManifest, preference: SubtitlePreference) {
    const player = getPlayer()
    if (!player) return
    const results = await Promise.all(
      manifest.subtitles.map(async (subtitle) => {
        try {
          const track = await player.addTextTrackAsync(subtitle.url, subtitle.language, 'subtitles', subtitle.type === 'webvtt' ? 'text/vtt' : subtitle.type, undefined, subtitle.title)
          return { track, title: subtitle.title, language: subtitle.language }
        } catch {
          return undefined
        }
      }),
    )
    if (player !== getPlayer()) return

    const options = results.filter((option): option is SubtitleOption => Boolean(option))
    subtitleOptions.value = options
    refreshSubtitleOptions(player)
    syncNativeTracks()
    if (preference === 'off') {
      selectSubtitle()
      return
    }
    const preferredSubtitle = preference
      ? (subtitleOptions.value.find((option) => option.title === preference.title && option.language === preference.language) ??
        subtitleOptions.value.find((option) => option.language === preference.language))
      : undefined
    const simplifiedChinese =
      preferredSubtitle ??
      subtitleOptions.value.find((option) => /简体|簡體/.test(option.title)) ??
      subtitleOptions.value.find((option) => /^(chi|zho|zh)/i.test(option.language) && !/繁/.test(option.title))
    if (simplifiedChinese) selectSubtitle(simplifiedChinese)
    else syncSelectedSubtitle(player)
  }

  function loadWhenPlayable() {
    const pending = pendingLoad
    const video = videoElement.value
    if (!pending || !video || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return
    pendingLoad = undefined
    if (pending.player !== getPlayer()) return
    void addSubtitles(pending.manifest, pending.preference)
  }

  function queueLoad(manifest: PlaybackManifest, preference: SubtitlePreference) {
    const player = getPlayer()
    if (!player) return
    bindPlayer(player)
    pendingLoad = { manifest, preference, player }
    loadWhenPlayable()
  }

  function capturePreference(): SubtitlePreference {
    if (selectedSubtitle.value === 'off') return 'off'
    const selected = subtitleOptions.value.find((option) => option.track.id === selectedSubtitle.value)
    return selected ? { title: selected.title, language: selected.language } : undefined
  }

  function reset() {
    pendingLoad = undefined
    unbindPlayer()
    subtitleOptions.value = []
    selectedSubtitle.value = 'off'
  }

  watch(subtitlePosition, () => {
    void nextTick(syncNativeTracks)
  })

  return {
    capturePreference,
    loadWhenPlayable,
    queueLoad,
    reset,
    selectSubtitle,
    selectedSubtitle,
    subtitleBackgroundMode,
    subtitleBackgroundOpacity,
    subtitleFontSize,
    subtitleOptions,
    subtitlePosition,
  }
}
