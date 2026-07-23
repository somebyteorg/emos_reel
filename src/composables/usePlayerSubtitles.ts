import { useSessionStorage } from '@vueuse/core'
import type AVPlayer from '@libmedia/avplayer'
import { nextTick, ref, type Ref, watch } from 'vue'
import type shaka from 'shaka-player/dist/shaka-player.hls'
import type { ManifestSubtitle, PlaybackManifest } from '@/api/types'
import type { PlaybackEngineKind } from '@/composables/usePlaybackEngine'
import { codecLabel } from '@/libmedia/codecs'
import { getLibmediaTextSubtitleStreams, type LibmediaStream } from '@/libmedia/streams'
import type { SubtitleBackgroundMode, SubtitleFontSize, SubtitleOption, SubtitlePosition } from '@/types/player'
import { isTextSubtitleSource, shakaSubtitleMimeType } from '@/utils/subtitles'

export type SubtitlePreference = Pick<SubtitleOption, 'title' | 'language'> | 'off' | undefined

interface UsePlayerSubtitlesOptions {
  videoElement: Ref<HTMLVideoElement | undefined>
  engineKind: Ref<PlaybackEngineKind | undefined>
  getShakaPlayer: () => shaka.Player | undefined
  getLibmediaPlayer: () => AVPlayer | undefined
}

export function usePlayerSubtitles(options: UsePlayerSubtitlesOptions) {
  const selectedSubtitle = ref<string | number>('off')
  const subtitleOptions = ref<SubtitleOption[]>([])
  const subtitleError = ref('')
  const subtitleFontSize = useSessionStorage<SubtitleFontSize>('emos_reel.player.subtitle.font_size.v2', 'system')
  const subtitleBackgroundMode = useSessionStorage<SubtitleBackgroundMode>('emos_reel.player.subtitle.background_mode', 'system')
  const subtitleBackgroundOpacity = useSessionStorage('emos_reel.player.subtitle.background_opacity', 0.72)
  const subtitlePosition = useSessionStorage<SubtitlePosition>('emos_reel.player.subtitle.position.v2', 'system')
  const boundNativeTextTracks = new WeakSet<TextTrack>()
  const originalCuePositions = new WeakMap<TextTrackCue, Pick<VTTCue, 'line' | 'lineAlign' | 'snapToLines'>>()
  const shakaTracksById = new Map<string | number, shaka.extern.TextTrack>()
  const libmediaStreamsById = new Map<string | number, LibmediaStream>()
  const externalSubtitlesById = new Map<string, ManifestSubtitle>()
  const shakaExternalLoads = new Map<string, Promise<shaka.extern.TextTrack>>()
  const libmediaExternalLoads = new Map<string, Promise<LibmediaStream>>()
  let externalSubtitleOptions: SubtitleOption[] = []
  let boundShakaPlayer: shaka.Player | undefined
  let libmediaSubtitlesEnabled = false
  let pendingLoad: { preference: SubtitlePreference } | undefined

  function externalSubtitleId(index: number) {
    return `external:${index}`
  }

  function isExternalSubtitle(optionId: string | number) {
    return externalSubtitlesById.has(String(optionId))
  }

  function registerExternalSubtitles(manifest: PlaybackManifest) {
    externalSubtitlesById.clear()
    externalSubtitleOptions = manifest.subtitles.flatMap((subtitle, index) => {
      if (!isTextSubtitleSource(subtitle.url, subtitle.type)) return []
      const id = externalSubtitleId(index)
      const language = subtitle.language ?? ''
      externalSubtitlesById.set(id, subtitle)
      return [{ id, title: subtitle.title || language.toUpperCase() || `外挂字幕 ${index + 1}`, language }]
    })
  }

  function syncSelectedSubtitle(player = boundShakaPlayer) {
    if (options.engineKind.value === 'libmedia') {
      const libmedia = options.getLibmediaPlayer()
      const selectedId = libmedia?.getSelectedSubtitleStreamId() ?? -1
      const selectedOption = [...libmediaStreamsById].find(([, stream]) => stream.id === selectedId)?.[0]
      selectedSubtitle.value = libmediaSubtitlesEnabled && selectedId >= 0 ? (selectedOption ?? selectedId) : 'off'
      return
    }
    if (!player || player !== options.getShakaPlayer()) return
    const activeTrack = player.getTextTracks().find((track) => track.active)
    const selectedOption = activeTrack ? [...shakaTracksById].find(([, track]) => track.id === activeTrack.id)?.[0] : undefined
    selectedSubtitle.value = selectedOption ?? activeTrack?.id ?? 'off'
  }

  function refreshShakaOptions(player = boundShakaPlayer) {
    if (!player || player !== options.getShakaPlayer()) return
    const currentOptions = new Map(subtitleOptions.value.map((option) => [option.id, option]))
    const externalTrackIds = new Set([...shakaTracksById].filter(([optionId]) => isExternalSubtitle(optionId)).map(([, track]) => track.id))
    for (const optionId of shakaTracksById.keys()) {
      if (!isExternalSubtitle(optionId)) shakaTracksById.delete(optionId)
    }
    const embeddedOptions = player
      .getTextTracks()
      .filter((track) => !externalTrackIds.has(track.id))
      .map((track, index) => {
        shakaTracksById.set(track.id, track)
        const current = currentOptions.get(track.id)
        return {
          id: track.id,
          title: current?.title || track.label || track.language || `字幕 ${index + 1}`,
          language: current?.language || track.language,
        }
      })
    subtitleOptions.value = [...embeddedOptions, ...externalSubtitleOptions]
    syncSelectedSubtitle(player)
  }

  function refreshLibmediaOptions() {
    const player = options.getLibmediaPlayer()
    if (!player) return
    const externalStreamIds = new Set([...libmediaStreamsById].filter(([optionId]) => isExternalSubtitle(optionId)).map(([, stream]) => stream.id))
    for (const optionId of libmediaStreamsById.keys()) {
      if (!isExternalSubtitle(optionId)) libmediaStreamsById.delete(optionId)
    }
    const embeddedOptions = getLibmediaTextSubtitleStreams(player.getStreams())
      .filter((stream) => !externalStreamIds.has(stream.id))
      .map((stream, index) => {
        libmediaStreamsById.set(stream.id, stream)
        const codecId = Number(stream.codecparProxy.codecId)
        const language = typeof stream.metadata.language === 'string' ? stream.metadata.language : ''
        const title = (typeof stream.metadata.title === 'string' && stream.metadata.title) || language.toUpperCase() || `${codecLabel(codecId)} ${index + 1}`
        return { id: stream.id, title, language }
      })
    subtitleOptions.value = [...embeddedOptions, ...externalSubtitleOptions]
    syncSelectedSubtitle()
  }

  function handleTextChanged() {
    syncSelectedSubtitle()
  }

  function handleTracksChanged() {
    refreshShakaOptions()
  }

  function unbindShakaPlayer() {
    if (!boundShakaPlayer) return
    boundShakaPlayer.removeEventListener('textchanged', handleTextChanged)
    boundShakaPlayer.removeEventListener('trackschanged', handleTracksChanged)
    boundShakaPlayer = undefined
  }

  function bindShakaPlayer(player: shaka.Player) {
    if (boundShakaPlayer === player) return
    unbindShakaPlayer()
    boundShakaPlayer = player
    player.addEventListener('textchanged', handleTextChanged)
    player.addEventListener('trackschanged', handleTracksChanged)
    refreshShakaOptions(player)
  }

  async function loadShakaExternalSubtitle(option: SubtitleOption) {
    const optionId = String(option.id)
    const subtitle = externalSubtitlesById.get(optionId)
    const player = options.getShakaPlayer()
    if (!subtitle || !player) throw new Error('外挂字幕信息不可用')
    const existing = shakaExternalLoads.get(optionId)
    if (existing) return existing
    const load = (async () => {
      const track = await player.addTextTrackAsync(subtitle.url, subtitle.language ?? '', 'subtitles', shakaSubtitleMimeType(subtitle.type), undefined, subtitle.title)
      if (player !== options.getShakaPlayer()) throw new Error('播放器已经切换')
      shakaTracksById.set(optionId, track)
      refreshShakaOptions(player)
      syncNativeTracks()
      return track
    })()
    shakaExternalLoads.set(optionId, load)
    try {
      return await load
    } catch (error) {
      if (shakaExternalLoads.get(optionId) === load) shakaExternalLoads.delete(optionId)
      throw error
    }
  }

  async function loadLibmediaExternalSubtitle(option: SubtitleOption) {
    const optionId = String(option.id)
    const subtitle = externalSubtitlesById.get(optionId)
    const player = options.getLibmediaPlayer()
    if (!subtitle || !player) throw new Error('外挂字幕信息不可用')
    const existing = libmediaExternalLoads.get(optionId)
    if (existing) return existing
    const load = (async () => {
      const existingStreamIds = new Set(player.getStreams().map((stream) => stream.id))
      await player.loadExternalSubtitle({
        source: subtitle.url,
        lang: subtitle.language,
        title: subtitle.title,
      })
      if (player !== options.getLibmediaPlayer()) throw new Error('播放器已经切换')
      const stream = getLibmediaTextSubtitleStreams(player.getStreams()).find((item) => !existingStreamIds.has(item.id))
      if (!stream) throw new Error('没有读取到可用的文字字幕')
      libmediaStreamsById.set(optionId, stream)
      refreshLibmediaOptions()
      return stream
    })()
    libmediaExternalLoads.set(optionId, load)
    try {
      return await load
    } catch (error) {
      if (libmediaExternalLoads.get(optionId) === load) libmediaExternalLoads.delete(optionId)
      throw error
    }
  }

  async function selectLibmediaSubtitle(option?: SubtitleOption) {
    const player = options.getLibmediaPlayer()
    if (!player) return
    if (!option) {
      libmediaSubtitlesEnabled = false
      player.setSubtitleEnable(false)
      selectedSubtitle.value = 'off'
      return
    }
    const stream = libmediaStreamsById.get(option.id) ?? (isExternalSubtitle(option.id) ? await loadLibmediaExternalSubtitle(option) : undefined)
    if (!stream) return
    subtitleError.value = ''
    if (player.getSelectedSubtitleStreamId() !== stream.id) await player.selectSubtitle(stream.id)
    libmediaSubtitlesEnabled = true
    player.setSubtitleEnable(true)
    selectedSubtitle.value = option.id
  }

  async function selectSubtitle(option?: SubtitleOption) {
    try {
      subtitleError.value = ''
      if (options.engineKind.value === 'libmedia') {
        await selectLibmediaSubtitle(option)
        return
      }
      const player = options.getShakaPlayer()
      if (!player) return
      const track = option ? (shakaTracksById.get(option.id) ?? (isExternalSubtitle(option.id) ? await loadShakaExternalSubtitle(option) : undefined)) : undefined
      player.selectTextTrack(track ?? null)
      syncSelectedSubtitle(player)
    } catch (error) {
      console.warn('[EMOS REEL] select subtitle failed', error)
      subtitleError.value = '字幕切换失败，请重试'
      syncSelectedSubtitle()
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
      videoCue.snapToLines = false
      videoCue.line = subtitlePosition.value === 'bottom' ? 92 : subtitlePosition.value === 'raised' ? 80 : 65
      videoCue.lineAlign = 'end'
    }
  }

  function syncNativeTracks() {
    const video = options.videoElement.value
    if (!video) return
    for (const track of Array.from(video.textTracks)) {
      if (!boundNativeTextTracks.has(track)) {
        boundNativeTextTracks.add(track)
        track.addEventListener('cuechange', () => applySubtitlePosition(track))
      }
      applySubtitlePosition(track)
    }
  }

  async function applyPreference(preference: SubtitlePreference) {
    if (preference === 'off') {
      await selectSubtitle()
      return
    }
    const selectableOptions = subtitleOptions.value.filter((option) => !isExternalSubtitle(option.id))
    const preferred = preference
      ? (selectableOptions.find((option) => option.title === preference.title && option.language === preference.language) ??
        selectableOptions.find((option) => option.language === preference.language))
      : undefined
    const simplifiedChinese =
      preferred ?? selectableOptions.find((option) => /简体|簡體/.test(option.title)) ?? selectableOptions.find((option) => /^(chi|zho|zh)/i.test(option.language) && !/繁/.test(option.title))
    if (simplifiedChinese) await selectSubtitle(simplifiedChinese)
    else syncSelectedSubtitle()
  }

  async function initializeSubtitles(preference: SubtitlePreference) {
    if (options.engineKind.value === 'libmedia') refreshLibmediaOptions()
    else {
      refreshShakaOptions()
      syncNativeTracks()
    }
    await applyPreference(preference)
  }

  function loadWhenPlayable() {
    const pending = pendingLoad
    if (!pending) return
    if (options.engineKind.value === 'shaka') {
      const video = options.videoElement.value
      const player = options.getShakaPlayer()
      if (!video || !player || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return
      pendingLoad = undefined
      void initializeSubtitles(pending.preference)
      return
    }
    if (options.engineKind.value === 'libmedia' && options.getLibmediaPlayer()) {
      pendingLoad = undefined
      void initializeSubtitles(pending.preference)
    }
  }

  function queueLoad(manifest: PlaybackManifest, preference: SubtitlePreference) {
    registerExternalSubtitles(manifest)
    if (options.engineKind.value === 'shaka') {
      const player = options.getShakaPlayer()
      if (!player) return
      bindShakaPlayer(player)
    }
    pendingLoad = { preference }
  }

  function capturePreference(): SubtitlePreference {
    if (selectedSubtitle.value === 'off') return 'off'
    const selected = subtitleOptions.value.find((option) => option.id === selectedSubtitle.value)
    return selected ? { title: selected.title, language: selected.language } : undefined
  }

  function reset() {
    pendingLoad = undefined
    unbindShakaPlayer()
    shakaTracksById.clear()
    libmediaStreamsById.clear()
    externalSubtitlesById.clear()
    shakaExternalLoads.clear()
    libmediaExternalLoads.clear()
    externalSubtitleOptions = []
    libmediaSubtitlesEnabled = false
    subtitleOptions.value = []
    selectedSubtitle.value = 'off'
    subtitleError.value = ''
  }

  watch(subtitlePosition, () => void nextTick(syncNativeTracks))

  return {
    capturePreference,
    loadWhenPlayable,
    queueLoad,
    reset,
    selectSubtitle,
    selectedSubtitle,
    subtitleBackgroundMode,
    subtitleBackgroundOpacity,
    subtitleError,
    subtitleFontSize,
    subtitleOptions,
    subtitlePosition,
  }
}
