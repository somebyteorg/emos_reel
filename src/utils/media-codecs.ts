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
