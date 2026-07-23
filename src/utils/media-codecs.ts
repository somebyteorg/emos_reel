import { StorageSerializers, useSessionStorage } from '@vueuse/core'
import shaka from 'shaka-player/dist/shaka-player.hls.js'

export type PlaybackCodec = 'h265' | 'h264' | 'eac3' | 'aac'

const codecTests: ReadonlyArray<{
  codec: PlaybackCodec
  mediaTypes: readonly string[]
}> = [
  {
    codec: 'h265',
    mediaTypes: ['video/mp4; codecs="hvc1.1.6.L93.90"', 'video/mp4; codecs="hev1.1.6.L93.90"', 'video/mp2t; codecs="hvc1.1.6.L93.90"'],
  },
  {
    codec: 'h264',
    mediaTypes: ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc3.42E01E"', 'video/mp2t; codecs="avc1.42E01E"', 'video/mp2t; codecs="avc3.42E01E"'],
  },
  {
    codec: 'eac3',
    mediaTypes: ['audio/mp4; codecs="ec-3"', 'video/mp2t; codecs="ec-3"'],
  },
  {
    codec: 'aac',
    mediaTypes: ['audio/mp4; codecs="mp4a.40.2"', 'video/mp2t; codecs="mp4a.40.2"'],
  },
]

const playbackCodecs = codecTests.map(({ codec }) => codec)
const cachedCodecs = useSessionStorage<PlaybackCodec[] | null>('emos_reel.player.supported_codecs.v1', null, { serializer: StorageSerializers.object })
let codecDetection: Promise<PlaybackCodec[]> | undefined
let dolbyVisionSupport: boolean | null | undefined
let dolbyVisionDetection: Promise<boolean | null> | undefined

const dolbyVisionVideoTypes = ['video/mp4; codecs="dvh1.05.06"', 'video/mp4; codecs="dvhe.05.06"', 'video/mp4; codecs="dvh1.08.06"', 'video/mp4; codecs="dvhe.08.06"']
const dolbyVisionCodecStrings = ['dvh1.05.06', 'dvhe.05.06', 'dvh1.08.06', 'dvhe.08.06']

function isPlaybackCodec(value: unknown): value is PlaybackCodec {
  return typeof value === 'string' && playbackCodecs.includes(value as PlaybackCodec)
}

function readCachedCodecs() {
  const cached = cachedCodecs.value
  if (!Array.isArray(cached) || !cached.every(isPlaybackCodec)) return undefined
  return playbackCodecs.filter((codec) => cached.includes(codec))
}

async function detectPlaybackCodecs() {
  shaka.polyfill.installAll()
  if (!shaka.Player.isBrowserSupported()) return []
  const support = await shaka.Player.probeSupport(false)
  return codecTests.filter(({ mediaTypes }) => mediaTypes.some((type) => support.media[type])).map(({ codec }) => codec)
}

function probeDolbyVisionWithVideoElement() {
  if (typeof document === 'undefined') return null
  const video = document.createElement('video')
  const results = dolbyVisionVideoTypes.map((type) => video.canPlayType(type))
  if (results.includes('probably')) return true
  if (results.includes('maybe')) return null
  return false
}

async function probeDolbyVisionWithMediaCapabilities() {
  if (typeof navigator === 'undefined') return null
  const mediaCapabilities = (
    navigator as Navigator & {
      mediaCapabilities?: {
        decodingInfo?: (configuration: unknown) => Promise<{ supported?: boolean }>
      }
    }
  ).mediaCapabilities
  if (!mediaCapabilities?.decodingInfo) return null
  const results = await Promise.all(
    dolbyVisionVideoTypes.map(async (contentType) => {
      try {
        const result = await mediaCapabilities.decodingInfo({
          type: 'file',
          video: {
            contentType,
            width: 1920,
            height: 1080,
            bitrate: 8_000_000,
            framerate: 24,
          },
        })
        return result.supported === true
      } catch {
        return null
      }
    }),
  )
  if (results.includes(true)) return true
  return results.includes(null) ? null : false
}

async function probeDolbyVisionWithWebCodecs() {
  const videoDecoder = (
    globalThis as {
      VideoDecoder?: {
        isConfigSupported?: (configuration: unknown) => Promise<{ supported?: boolean }>
      }
    }
  ).VideoDecoder
  if (!videoDecoder?.isConfigSupported) return null
  const results = await Promise.all(
    dolbyVisionCodecStrings.map(async (codec) => {
      try {
        const result = await videoDecoder.isConfigSupported({
          codec,
          codedWidth: 1920,
          codedHeight: 1080,
        })
        return result.supported === true
      } catch {
        return null
      }
    }),
  )
  if (results.includes(true)) return true
  return results.includes(null) ? null : false
}

async function detectDolbyVisionPlaybackSupport() {
  const elementSupport = probeDolbyVisionWithVideoElement()
  if (elementSupport === true) return true
  const [mediaCapabilitiesSupport, webCodecsSupport] = await Promise.all([probeDolbyVisionWithMediaCapabilities(), probeDolbyVisionWithWebCodecs()])
  if (mediaCapabilitiesSupport === true || webCodecsSupport === true) return true
  if (elementSupport === false && mediaCapabilitiesSupport === false && webCodecsSupport === false) return false
  return null
}

export async function getSupportedPlaybackCodecs(): Promise<PlaybackCodec[]> {
  const cached = readCachedCodecs()
  if (cached) return cached
  if (codecDetection) return codecDetection
  codecDetection = detectPlaybackCodecs()
    .catch((error) => {
      console.error('[EMOS REEL] Codec capability detection failed', error)
      return []
    })
    .then((codecs) => {
      cachedCodecs.value = codecs
      return codecs
    })
    .finally(() => {
      codecDetection = undefined
    })
  return codecDetection
}

export function hasRequiredPlaybackCodecs(codecs: readonly PlaybackCodec[]) {
  const supportsVideo = codecs.includes('h265') || codecs.includes('h264')
  const supportsAudio = codecs.includes('eac3') || codecs.includes('aac')
  return supportsVideo && supportsAudio
}

export async function getDolbyVisionPlaybackSupport(): Promise<boolean | null> {
  if (dolbyVisionSupport !== undefined) return dolbyVisionSupport
  if (dolbyVisionDetection) return dolbyVisionDetection
  dolbyVisionDetection = detectDolbyVisionPlaybackSupport()
    .catch((error) => {
      console.warn('[EMOS REEL] Dolby Vision capability detection failed', error)
      return null
    })
    .then((supported) => {
      dolbyVisionSupport = supported
      return supported
    })
    .finally(() => {
      dolbyVisionDetection = undefined
    })
  return dolbyVisionDetection
}
