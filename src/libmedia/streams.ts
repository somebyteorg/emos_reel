import type AVPlayer from '@libmedia/avplayer'
import { AVCodecID, AVMediaType } from '@libmedia/avutil/enum'
import { codecLabel, decoderWasmNames, isTextSubtitleCodec } from '@/libmedia/codecs'
import type { PlaybackAudioOption } from '@/types/player'

export type LibmediaStream = ReturnType<AVPlayer['getStreams']>[number]

const DEFAULT_DISPOSITION = 1
const ATTACHED_PICTURE_DISPOSITION = 1024
const AUTO_AUDIO_CODEC_PREFERENCE = [AVCodecID.AV_CODEC_ID_AAC, AVCodecID.AV_CODEC_ID_MP3, AVCodecID.AV_CODEC_ID_OPUS, AVCodecID.AV_CODEC_ID_VORBIS, AVCodecID.AV_CODEC_ID_FLAC] as const

function isMediaType(stream: LibmediaStream, mediaType: AVMediaType) {
  return Number(stream.codecparProxy.codecType) === mediaType
}

function isDefaultStream(stream: LibmediaStream) {
  return Boolean(stream.disposition & DEFAULT_DISPOSITION) && !Boolean(stream.disposition & ATTACHED_PICTURE_DISPOSITION)
}

function isChineseStream(stream: LibmediaStream) {
  const language = typeof stream.metadata.language === 'string' ? stream.metadata.language.trim() : ''
  const title = typeof stream.metadata.title === 'string' ? stream.metadata.title : ''
  return /^(chi|zho|zh|cmn|yue)([-_]|$)/i.test(language) || /中文|国语|普通话|粤语|简体|繁体|chinese/i.test(title)
}

export function isPlayableLibmediaStream(stream: LibmediaStream) {
  return decoderWasmNames.has(Number(stream.codecparProxy.codecId))
}

export function getLibmediaVideoStreams(streams: LibmediaStream[]) {
  return streams.filter((stream) => isMediaType(stream, AVMediaType.AVMEDIA_TYPE_VIDEO) && !Boolean(stream.disposition & ATTACHED_PICTURE_DISPOSITION))
}

export function getLibmediaAudioStreams(streams: LibmediaStream[]) {
  return streams.filter((stream) => isMediaType(stream, AVMediaType.AVMEDIA_TYPE_AUDIO))
}

export function getLibmediaTextSubtitleStreams(streams: LibmediaStream[]) {
  return streams.filter((stream) => isMediaType(stream, AVMediaType.AVMEDIA_TYPE_SUBTITLE) && isTextSubtitleCodec(Number(stream.codecparProxy.codecId)))
}

export function getPlayableLibmediaStreams(streams: LibmediaStream[]) {
  return streams.filter(isPlayableLibmediaStream)
}

export function pickLibmediaVideoStream(streams: LibmediaStream[]) {
  const playable = getPlayableLibmediaStreams(getLibmediaVideoStreams(streams))
  return playable.find(isDefaultStream) ?? playable[0]
}

export function pickLibmediaAudioStream(streams: LibmediaStream[], preferredId?: number) {
  // 有些片源的 default 音轨是浏览器/wasm 解不了的格式，自动选择时只能在可播放音轨里挑。
  const playable = getPlayableLibmediaStreams(getLibmediaAudioStreams(streams))
  if (!playable.length) return undefined
  if (preferredId != null) {
    const preferred = playable.find((stream) => stream.id === preferredId)
    if (preferred) return preferred
  }
  for (const codecId of AUTO_AUDIO_CODEC_PREFERENCE) {
    const candidates = playable.filter((stream) => Number(stream.codecparProxy.codecId) === codecId)
    const selected = candidates.find(isDefaultStream) ?? candidates.find(isChineseStream) ?? candidates[0]
    if (selected) return selected
  }
  return playable.find(isDefaultStream) ?? playable.find(isChineseStream) ?? playable[0]
}

export function findPlayableLibmediaAudioStream(streams: LibmediaStream[], streamId: number) {
  return getPlayableLibmediaStreams(getLibmediaAudioStreams(streams)).find((stream) => stream.id === streamId)
}

export function createLibmediaAudioOptions(streams: LibmediaStream[]): PlaybackAudioOption[] {
  return getPlayableLibmediaStreams(getLibmediaAudioStreams(streams)).map((stream, index) => {
    const title = typeof stream.metadata.title === 'string' ? stream.metadata.title : ''
    const language = typeof stream.metadata.language === 'string' ? stream.metadata.language : ''
    const codec = codecLabel(Number(stream.codecparProxy.codecId))
    const channelsCount = stream.codecparProxy.chLayout.nbChannels || null
    const channelLabel = channelsCount && channelsCount > 2 ? (channelsCount === 6 ? '5.1' : `${channelsCount} 声道`) : ''
    const baseLabel = title || language.toUpperCase() || `音轨 ${index + 1}`
    return {
      id: String(stream.id),
      label: [baseLabel, codec, channelLabel].filter(Boolean).join(' · '),
      language,
      channelsCount,
    }
  })
}

export class LibmediaStreamSelection {
  private readonly selectedIds = new Map<number, number>()

  clear() {
    this.selectedIds.clear()
  }

  set(mediaType: AVMediaType, stream?: Pick<LibmediaStream, 'id'>) {
    if (stream) this.selectedIds.set(mediaType, stream.id)
    else this.selectedIds.delete(mediaType)
  }

  has(mediaType: AVMediaType) {
    return this.selectedIds.has(mediaType)
  }

  find<T extends { id: number }>(streams: T[], mediaType: number): T {
    const selectedId = this.selectedIds.get(Number(mediaType))
    // AVPlayer accepts undefined when a media type has no selected stream.
    return streams.find((stream) => stream.id === selectedId) as T
  }
}
