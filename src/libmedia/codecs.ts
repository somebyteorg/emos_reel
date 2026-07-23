import { AVCodecID } from '@libmedia/avutil/enum'

const WASM_BASE_URL = `${import.meta.env.BASE_URL}libmedia/wasm`
type AVPlayerConstructor = typeof import('@libmedia/avplayer').default
type LocalWasmType = 'decoder' | 'resampler' | 'stretchpitcher'
type AudioRuntimeWasmType = Extract<LocalWasmType, 'resampler' | 'stretchpitcher'>
type WasmCompiler = AVPlayerConstructor['Util']['compile']
type LocalWasmResource = Awaited<ReturnType<WasmCompiler>>

const audioRuntimeWasmTypes: AudioRuntimeWasmType[] = ['resampler', 'stretchpitcher']
const audioRuntimeWasmBuffers = new Map<AudioRuntimeWasmType, ArrayBuffer>()
const audioRuntimeWasmResources = new Map<AudioRuntimeWasmType, LocalWasmResource>()
let audioRuntimeWasmPreload: Promise<void> | undefined
let audioRuntimeWasmCompile: Promise<void> | undefined

/** WASM file stem under public/libmedia/wasm/decode/{name}-simd.wasm */
export const decoderWasmNames = new Map<number, string>([
  [AVCodecID.AV_CODEC_ID_AAC, 'aac'],
  [AVCodecID.AV_CODEC_ID_MP3, 'mp3'],
  [AVCodecID.AV_CODEC_ID_FLAC, 'flac'],
  [AVCodecID.AV_CODEC_ID_OPUS, 'opus'],
  [AVCodecID.AV_CODEC_ID_VORBIS, 'vorbis'],
  [AVCodecID.AV_CODEC_ID_AC3, 'ac3'],
  [AVCodecID.AV_CODEC_ID_EAC3, 'eac3'],
  // FFmpeg / libmedia name the DTS decoder "dca".
  [AVCodecID.AV_CODEC_ID_DTS, 'dca'],
  [AVCodecID.AV_CODEC_ID_H264, 'h264'],
  [AVCodecID.AV_CODEC_ID_HEVC, 'hevc'],
  [AVCodecID.AV_CODEC_ID_AV1, 'av1'],
  [AVCodecID.AV_CODEC_ID_VP9, 'vp9'],
])

const codecLabels: Record<number, string> = {
  [AVCodecID.AV_CODEC_ID_AAC]: 'AAC',
  [AVCodecID.AV_CODEC_ID_MP3]: 'MP3',
  [AVCodecID.AV_CODEC_ID_FLAC]: 'FLAC',
  [AVCodecID.AV_CODEC_ID_OPUS]: 'Opus',
  [AVCodecID.AV_CODEC_ID_VORBIS]: 'Vorbis',
  [AVCodecID.AV_CODEC_ID_AC3]: 'AC-3',
  [AVCodecID.AV_CODEC_ID_EAC3]: 'E-AC-3',
  [AVCodecID.AV_CODEC_ID_DTS]: 'DTS',
  [AVCodecID.AV_CODEC_ID_TRUEHD]: 'TrueHD',
  [AVCodecID.AV_CODEC_ID_H264]: 'H.264',
  [AVCodecID.AV_CODEC_ID_HEVC]: 'HEVC',
  [AVCodecID.AV_CODEC_ID_AV1]: 'AV1',
  [AVCodecID.AV_CODEC_ID_VP9]: 'VP9',
  [AVCodecID.AV_CODEC_ID_VP8]: 'VP8',
  [AVCodecID.AV_CODEC_ID_MPEG4]: 'MPEG-4',
  [AVCodecID.AV_CODEC_ID_ASS]: 'ASS',
  [AVCodecID.AV_CODEC_ID_SSA]: 'SSA',
  [AVCodecID.AV_CODEC_ID_SRT]: 'SRT',
  [AVCodecID.AV_CODEC_ID_WEBVTT]: 'WebVTT',
  [AVCodecID.AV_CODEC_ID_MOV_TEXT]: 'Timed Text',
}

/** Codecs we label clearly but do not ship a local wasm for. */
const unsupportedButKnownCodecIds = new Set<number>([AVCodecID.AV_CODEC_ID_TRUEHD, AVCodecID.AV_CODEC_ID_VP8, AVCodecID.AV_CODEC_ID_MPEG4])

/** Text subtitle codecs that AVPlayer's SubtitleDecoder supports natively. */
export const textSubtitleCodecIds = new Set<number>([
  AVCodecID.AV_CODEC_ID_ASS,
  AVCodecID.AV_CODEC_ID_SSA,
  AVCodecID.AV_CODEC_ID_SRT,
  AVCodecID.AV_CODEC_ID_SUBRIP,
  AVCodecID.AV_CODEC_ID_WEBVTT,
  AVCodecID.AV_CODEC_ID_MOV_TEXT,
  AVCodecID.AV_CODEC_ID_TEXT,
  AVCodecID.AV_CODEC_ID_HDMV_TEXT_SUBTITLE,
])

// This queue is on the playback-critical path after open and seek. Keep it
// just above the UI's 10-second stable-buffer threshold; long read-ahead
// belongs in the persistent byte cache instead of libmedia's packet queue.
export const LIBMEDIA_PRELOAD_SECONDS = 12

export function codecLabel(codecId?: number) {
  if (codecId == null) return '未知编码'
  return codecLabels[codecId] || `codec ${codecId}`
}

function getLocalWasmUrl(type: LocalWasmType, codecId?: number) {
  if (type === 'resampler') return `${WASM_BASE_URL}/resample/resample-simd.wasm`
  if (type === 'stretchpitcher') return `${WASM_BASE_URL}/stretchpitch/stretchpitch-simd.wasm`
  if (codecId == null) return undefined
  const codecName = decoderWasmNames.get(codecId)
  return codecName ? `${WASM_BASE_URL}/decode/${codecName}-simd.wasm` : undefined
}

function cloneWasmResource(resource: LocalWasmResource): LocalWasmResource {
  return {
    ...resource,
    buffer: resource.buffer.slice(0),
  }
}

export function getLocalWasm(type: LocalWasmType, codecId?: number): string | ArrayBuffer | LocalWasmResource | undefined {
  if (type === 'resampler' || type === 'stretchpitcher') {
    const resource = audioRuntimeWasmResources.get(type)
    if (resource) return cloneWasmResource(resource)
    // AVPlayer may transfer the raw buffer to a worker, so each consumer gets its own copy.
    return audioRuntimeWasmBuffers.get(type)?.slice(0) ?? getLocalWasmUrl(type)
  }
  return getLocalWasmUrl(type, codecId)
}

export async function preloadLibmediaAudioWasm() {
  if (audioRuntimeWasmTypes.every((type) => audioRuntimeWasmBuffers.has(type))) return
  audioRuntimeWasmPreload ??= Promise.all(
    audioRuntimeWasmTypes.map(async (type) => {
      if (audioRuntimeWasmBuffers.has(type)) return
      const url = getLocalWasmUrl(type)
      if (!url) return
      const response = await fetch(url)
      if (!response.ok) throw new Error(`libmedia ${type} WASM preload failed (${response.status})`)
      audioRuntimeWasmBuffers.set(type, await response.arrayBuffer())
    }),
  ).then(() => undefined)
  try {
    await audioRuntimeWasmPreload
  } catch (error) {
    audioRuntimeWasmPreload = undefined
    throw error
  }
}

export async function compileLibmediaAudioWasm(compile: WasmCompiler) {
  if (audioRuntimeWasmTypes.every((type) => audioRuntimeWasmResources.has(type))) return
  await preloadLibmediaAudioWasm()
  audioRuntimeWasmCompile ??= Promise.all(
    audioRuntimeWasmTypes.map(async (type) => {
      if (audioRuntimeWasmResources.has(type)) return
      const buffer = audioRuntimeWasmBuffers.get(type)
      if (!buffer) throw new Error(`libmedia ${type} WASM is unavailable for compilation`)
      audioRuntimeWasmResources.set(type, await compile({ source: buffer.slice(0) }))
    }),
  ).then(() => undefined)
  try {
    await audioRuntimeWasmCompile
  } catch (error) {
    audioRuntimeWasmCompile = undefined
    throw error
  }
}

export function isTextSubtitleCodec(codecId: number) {
  return textSubtitleCodecIds.has(codecId)
}

export function suggestedPreLoadTime() {
  return LIBMEDIA_PRELOAD_SECONDS
}

export function unsupportedCodecHint(codecId?: number) {
  if (codecId == null) return '当前编码暂不支持'
  if (codecId === AVCodecID.AV_CODEC_ID_TRUEHD) {
    return 'TrueHD / Atmos 暂无浏览器软解，请切换 AAC / E-AC-3 音轨'
  }
  if (unsupportedButKnownCodecIds.has(codecId)) {
    return `暂不支持 ${codecLabel(codecId)} 编码，请切换其它音轨或版本`
  }
  if (!decoderWasmNames.has(codecId)) {
    return `暂不支持 ${codecLabel(codecId)} 编码`
  }
  return ''
}

export class LocalDecoderUnavailableError extends Error {
  readonly codecId?: number
  readonly codecName: string

  constructor(codecId?: number) {
    const name = codecLabel(codecId)
    const hint = unsupportedCodecHint(codecId)
    super(hint || `当前未提供编码 ${name} 的本地解码器`)
    this.name = 'LocalDecoderUnavailableError'
    this.codecId = codecId
    this.codecName = name
  }
}
