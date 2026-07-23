import type { MediaMetadata, MediaMetadataStream, MediaVersion } from '@/api/types'
import type { PlaybackCodec } from '@/utils/media-codecs'

export interface MediaVersionPlaybackSupport {
  playable: boolean
  reason: string
  known: boolean
}

const DIRECT_VIDEO_CODECS = new Set(['h264', 'hevc', 'h265', 'av1', 'vp9'])
const DIRECT_AUDIO_CODECS = new Set(['aac', 'mp3', 'flac', 'opus', 'vorbis', 'ac3', 'eac3', 'dts'])
const DOLBY_VISION_MARKERS = [/dolby\s*vision/i, /\bdovi\b/i, /\bdvhe\b/i, /\bdvh1\b/i]

function metadataOf(version: MediaVersion): MediaMetadata | undefined {
  return version.media_metadata ?? undefined
}

function streamsOf(version: MediaVersion) {
  const streams = metadataOf(version)?.streams
  return Array.isArray(streams) ? streams : []
}

function codecName(stream?: MediaMetadataStream) {
  return typeof stream?.codec_name === 'string' ? stream.codec_name.trim().toLowerCase() : ''
}

function displayCodecName(codec: string) {
  switch (codec.toLowerCase()) {
    case 'hevc':
    case 'h265':
      return 'HEVC'
    case 'h264':
      return 'H.264'
    case 'av1':
      return 'AV1'
    case 'vp9':
      return 'VP9'
    case 'aac':
      return 'AAC'
    case 'eac3':
    case 'eac-3':
    case 'ec-3':
      return 'E-AC-3'
    case 'ac3':
    case 'ac-3':
      return 'AC-3'
    case 'dts':
      return 'DTS'
    case 'mp3':
      return 'MP3'
    case 'flac':
      return 'FLAC'
    case 'opus':
      return 'Opus'
    case 'vorbis':
      return 'Vorbis'
    case 'truehd':
      return 'TrueHD'
    default:
      return codec ? codec.toUpperCase() : ''
  }
}

function browserCodec(codec: string): PlaybackCodec | undefined {
  switch (codec.toLowerCase()) {
    case 'h264':
      return 'h264'
    case 'hevc':
    case 'h265':
      return 'h265'
    case 'aac':
      return 'aac'
    case 'eac3':
    case 'eac-3':
    case 'ec-3':
      return 'eac3'
    default:
      return undefined
  }
}

function isDefaultStream(stream: MediaMetadataStream) {
  return stream.disposition?.default === 1 || stream.disposition?.default === true
}

function isAttachedPicture(stream: MediaMetadataStream) {
  return stream.disposition?.attached_pic === 1 || stream.disposition?.attached_pic === true
}

function videoStreams(version: MediaVersion) {
  return streamsOf(version).filter((stream) => stream.codec_type === 'video' && !isAttachedPicture(stream))
}

function audioStreams(version: MediaVersion) {
  return streamsOf(version).filter((stream) => stream.codec_type === 'audio')
}

function formatName(version: MediaVersion) {
  return typeof version.media_metadata?.format?.format_name === 'string' ? version.media_metadata.format.format_name.toLowerCase() : ''
}

function isSegmentedFormat(version: MediaVersion) {
  const name = formatName(version)
  return name.includes('hls') || name.includes('dash')
}

function containerLabel(version: MediaVersion) {
  const name = formatName(version)
  if (name.includes('hls')) return 'HLS'
  if (name.includes('dash')) return 'DASH'
  if (name.includes('matroska') || name.includes('webm')) return 'MKV'
  if (name.includes('mov') || name.includes('mp4')) return 'MP4'
  return ''
}

function streamPixels(stream: MediaMetadataStream) {
  return (stream.width || stream.coded_width || 0) * (stream.height || stream.coded_height || 0)
}

function pickVideoStream(version: MediaVersion) {
  const streams = videoStreams(version)
  return streams.find(isDefaultStream) ?? [...streams].sort((left, right) => streamPixels(right) - streamPixels(left))[0]
}

function textHasDolbyVisionMarker(text: string) {
  return DOLBY_VISION_MARKERS.some((pattern) => pattern.test(text))
}

function metadataHasDolbyVisionMarker(value: unknown, depth = 0): boolean {
  if (depth > 5 || value == null) return false
  if (typeof value === 'string') return textHasDolbyVisionMarker(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return false
  if (Array.isArray(value)) return value.some((item) => metadataHasDolbyVisionMarker(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => textHasDolbyVisionMarker(key) || metadataHasDolbyVisionMarker(item, depth + 1))
}

function isDolbyVisionStream(stream?: MediaMetadataStream) {
  return Boolean(stream && metadataHasDolbyVisionMarker(stream))
}

function resolutionLabel(stream?: MediaMetadataStream) {
  const width = stream?.width || stream?.coded_width || 0
  const height = stream?.height || stream?.coded_height || 0
  if (!width || !height) return ''
  return height >= 720 ? `${height}p` : `${width}x${height}`
}

function hdrLabel(stream?: MediaMetadataStream) {
  if (isDolbyVisionStream(stream)) return '杜比视界'
  const transfer = typeof stream?.color_transfer === 'string' ? stream.color_transfer.toLowerCase() : ''
  const primaries = typeof stream?.color_primaries === 'string' ? stream.color_primaries.toLowerCase() : ''
  if (transfer.includes('smpte2084')) return 'HDR10'
  if (transfer.includes('arib-std-b67')) return 'HLG'
  if (primaries.includes('bt2020')) return 'HDR'
  return ''
}

function fpsLabel(stream?: MediaMetadataStream) {
  const rate = typeof stream?.avg_frame_rate === 'string' && stream.avg_frame_rate !== '0/0' ? stream.avg_frame_rate : stream?.r_frame_rate
  if (!rate || typeof rate !== 'string' || rate === '0/0') return ''
  const [numerator, denominator] = rate.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return ''
  const fps = numerator / denominator
  if (!Number.isFinite(fps) || fps <= 0) return ''
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)}fps`
}

function profileLabel(stream?: MediaMetadataStream) {
  if (typeof stream?.profile !== 'string') return ''
  const profile = stream.profile.trim()
  if (!profile || /^unknown$/i.test(profile)) return ''
  return profile
}

function channelLabel(stream?: MediaMetadataStream) {
  const channels = Number(stream?.channels || 0)
  if (!Number.isFinite(channels) || channels <= 0) return ''
  if (channels === 8) return '7.1'
  if (channels === 6) return '5.1'
  if (channels === 2) return '2.0'
  if (channels === 1) return '1.0'
  return `${channels} 声道`
}

function uniqueLabels(labels: string[]) {
  return [...new Set(labels.filter(Boolean))]
}

function audioSummary(version: MediaVersion) {
  const labels = uniqueLabels(audioStreams(version).map((stream) => [displayCodecName(codecName(stream)), channelLabel(stream)].filter(Boolean).join(' ')))
  if (!labels.length) return ''
  if (labels.length <= 2) return labels.join(' / ')
  return `${labels.slice(0, 2).join(' / ')} +${labels.length - 2}`
}

function codecList(streams: MediaMetadataStream[]) {
  return uniqueLabels(streams.map((stream) => displayCodecName(codecName(stream)))).join(' / ')
}

export function getMediaVersionBestVideoHeight(version: MediaVersion) {
  return pickVideoStream(version)?.height ?? pickVideoStream(version)?.coded_height ?? 0
}

export function isDolbyVisionMediaVersion(version: MediaVersion) {
  return textHasDolbyVisionMarker(version.media_name) || metadataHasDolbyVisionMarker(version.media_metadata?.format) || videoStreams(version).some(isDolbyVisionStream)
}

export function getMediaVersionDolbyVisionWarning(version: MediaVersion | undefined, dolbyVisionSupported: boolean | null | undefined) {
  if (!version || !isDolbyVisionMediaVersion(version) || dolbyVisionSupported === true) return ''
  if (dolbyVisionSupported === false) {
    return '杜比视界，设备可能不支持，颜色可能异常。'
  }
  return '杜比视界，设备支持情况未知，颜色可能异常。'
}

export function formatMediaVersionSummary(version: MediaVersion) {
  const video = pickVideoStream(version)
  const videoCodec = displayCodecName(codecName(video))
  const videoProfile = profileLabel(video)
  const videoCodecLabel = [videoCodec, videoProfile].filter(Boolean).join(' ')
  return [resolutionLabel(video), hdrLabel(video), videoCodecLabel, fpsLabel(video), audioSummary(version), containerLabel(version)].filter(Boolean).join(' · ')
}

export function getMediaVersionPlaybackSupport(version: MediaVersion, supportedCodecs?: readonly PlaybackCodec[]): MediaVersionPlaybackSupport {
  const metadata = metadataOf(version)
  if (!metadata || !Array.isArray(metadata.streams)) return { playable: true, reason: '', known: false }

  const videos = videoStreams(version)
  const audios = audioStreams(version)
  if (!videos.length && !audios.length) return { playable: false, reason: '这个版本没有音视频流', known: true }

  if (isSegmentedFormat(version)) {
    if (!supportedCodecs) return { playable: true, reason: '', known: false }
    const playableVideo =
      !videos.length ||
      videos.some((stream) => {
        const codec = browserCodec(codecName(stream))
        return codec ? supportedCodecs.includes(codec) : false
      })
    if (!playableVideo) {
      return { playable: false, reason: `当前设备不支持这个版本的视频编码：${codecList(videos) || '未知编码'}`, known: true }
    }
    const playableAudio =
      !audios.length ||
      audios.some((stream) => {
        const codec = browserCodec(codecName(stream))
        return codec ? supportedCodecs.includes(codec) : false
      })
    if (!playableAudio) {
      return { playable: false, reason: `当前设备不支持这个版本的音频编码：${codecList(audios) || '未知编码'}`, known: true }
    }
    return { playable: true, reason: '', known: audios.length > 0 }
  }

  const playableVideo = !videos.length || videos.some((stream) => DIRECT_VIDEO_CODECS.has(codecName(stream)))
  if (!playableVideo) {
    return { playable: false, reason: `暂不支持这个版本的视频编码：${codecList(videos) || '未知编码'}`, known: true }
  }
  const playableAudio = !audios.length || audios.some((stream) => DIRECT_AUDIO_CODECS.has(codecName(stream)))
  if (!playableAudio) {
    return { playable: false, reason: `暂不支持这个版本的音频编码：${codecList(audios) || '未知编码'}`, known: true }
  }
  return { playable: true, reason: '', known: true }
}
