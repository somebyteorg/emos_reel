import { AVMediaType } from '@libmedia/avutil/enum'
import { DEFAULT_MEDIA_CACHE_TTL_MS } from '@/libmedia/cache/mediaCacheTypes'
import { opfsCacheClient } from '@/libmedia/cache/opfsCacheClient'
import { createPostStreamLoader } from '@/libmedia/createPostStreamLoader'

type AVPlayerModule = typeof import('@libmedia/avplayer')
type AVPlayerConstructor = AVPlayerModule['default']
type AVPlayerOptions = ConstructorParameters<AVPlayerConstructor>[0]

const FRAME_POSTER_BUCKET_SECONDS = 5
const FRAME_POSTER_MAX_WIDTH = 1_280
const FRAME_POSTER_CACHE_READ_TIMEOUT_MS = 650

interface LibmediaFramePreviewOptions {
  AVPlayer: AVPlayerConstructor
  Events: AVPlayerModule['Events']
  cacheKey: string
  data: unknown
  durationSeconds: number
  extension: string
  getWasm: NonNullable<AVPlayerOptions['getWasm']>
  headers?: Record<string, string>
  host: HTMLDivElement
  signal: AbortSignal
  targetSeconds: number
  timeoutMs: number
  url: string
  useWebCodecs: boolean
  videoStreamId: number
}

function abortError() {
  return new DOMException('Frame preview aborted', 'AbortError')
}

function waitForAbort(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function posterKey(targetSeconds: number) {
  return String(Math.max(0, Math.round(targetSeconds / FRAME_POSTER_BUCKET_SECONDS)))
}

function createPosterCanvas(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, FRAME_POSTER_MAX_WIDTH / width)
  const poster = document.createElement('canvas')
  poster.width = Math.max(1, Math.round(width * scale))
  poster.height = Math.max(1, Math.round(height * scale))
  poster.className = 'libmedia-frame-poster'
  Object.assign(poster.style, {
    background: '#000',
    height: '100%',
    inset: '0',
    objectFit: 'contain',
    pointerEvents: 'none',
    position: 'absolute',
    width: '100%',
    zIndex: '1',
  })
  const context = poster.getContext('2d')
  if (!context) throw new Error('浏览器无法创建首帧画布')
  context.drawImage(source, 0, 0, poster.width, poster.height)
  return poster
}

async function readCachedPoster(cacheKey: string, targetSeconds: number) {
  let timeoutId: number | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timeoutId = window.setTimeout(resolve, FRAME_POSTER_CACHE_READ_TIMEOUT_MS)
  })
  const data = await Promise.race([opfsCacheClient.readPoster(cacheKey, posterKey(targetSeconds)), timeout]).finally(() => {
    if (timeoutId != null) window.clearTimeout(timeoutId)
  })
  if (!data?.byteLength) return undefined
  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/webp' }))
  try {
    return createPosterCanvas(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

function persistPoster(cacheKey: string, targetSeconds: number, poster: HTMLCanvasElement) {
  poster.toBlob(
    (blob) => {
      if (!blob) return
      void blob
        .arrayBuffer()
        .then((data) => opfsCacheClient.writePoster(cacheKey, posterKey(targetSeconds), data, DEFAULT_MEDIA_CACHE_TTL_MS))
        .catch((error) => console.warn('[EMOS REEL] 保存当前进度首帧失败', error))
    },
    'image/webp',
    0.82,
  )
}

async function capturePreviewSurface(container: HTMLDivElement) {
  await nextPaint()
  const surfaces = [...container.querySelectorAll('canvas, video')]
  const surface = surfaces.find((candidate) => {
    if (candidate instanceof HTMLCanvasElement) return candidate.width > 0 && candidate.height > 0
    return candidate.videoWidth > 0 && candidate.videoHeight > 0
  })
  if (!surface) throw new Error('libmedia 未创建可截图的视频画布')
  const bitmap = await createImageBitmap(surface)
  try {
    return createPosterCanvas(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export async function createLibmediaFramePoster(options: LibmediaFramePreviewOptions) {
  let timedOut = false
  let timeoutId: number | undefined
  if (options.signal.aborted) throw abortError()
  try {
    const cachedPoster = await readCachedPoster(options.cacheKey, options.targetSeconds)
    if (cachedPoster) {
      if (options.signal.aborted) {
        cachedPoster.remove()
        throw abortError()
      }
      options.host.append(cachedPoster)
      return cachedPoster
    }
  } catch (error) {
    if (options.signal.aborted) throw abortError()
    console.warn('[EMOS REEL] 读取当前进度首帧缓存失败，将重新生成', error)
  }
  const previewContainer = document.createElement('div')
  Object.assign(previewContainer.style, {
    height: '100%',
    inset: '0',
    pointerEvents: 'none',
    position: 'absolute',
    width: '100%',
    zIndex: '1',
  })
  options.host.append(previewContainer)

  const player = new options.AVPlayer({
    container: previewContainer,
    getWasm: options.getWasm,
    checkUseMSE: () => false,
    enableHardware: options.useWebCodecs,
    enableWebCodecs: options.useWebCodecs,
    enableWorker: true,
    enableAudioWorklet: false,
    enableWebGPU: true,
    preLoadTime: 1,
    findBestStream: (streams, mediaType) => {
      if (Number(mediaType) !== AVMediaType.AVMEDIA_TYPE_VIDEO) return undefined as never
      return (streams.find((stream) => stream.id === options.videoStreamId) ?? streams[0])!
    },
  })
  let sourceError: Error | undefined
  const source = createPostStreamLoader(options.AVPlayer.IOLoader.CustomIOLoader, {
    url: options.url,
    data: options.data,
    extension: options.extension,
    cacheKey: options.cacheKey,
    headers: options.headers,
    getMediaDuration: () => options.durationSeconds,
    retryCount: 1,
    onError: (error) => {
      sourceError = error
    },
  })

  const frameRendered = new Promise<void>((resolve, reject) => {
    player.on(options.Events.FIRST_VIDEO_RENDERED, resolve)
    player.on(options.Events.ERROR, (error) => reject(sourceError ?? error))
  })
  const previewTask = (async () => {
    try {
      await player.load(source, { ext: options.extension, maxProbeDuration: 10 })
    } catch (error) {
      throw sourceError ?? error
    }
    if (options.signal.aborted) throw abortError()
    const target = Math.min(options.durationSeconds, Math.max(0, options.targetSeconds))
    if (target > 0) await player.seek(BigInt(Math.round(target * 1000)))
    if (options.signal.aborted) throw abortError()
    await player.play({ audio: false, video: true, subtitle: false })
    await frameRendered
    if (options.signal.aborted) throw abortError()
    const poster = await capturePreviewSurface(previewContainer)
    if (options.signal.aborted || timedOut) {
      poster.remove()
      throw options.signal.aborted ? abortError() : new Error(`首帧生成超过 ${options.timeoutMs} ms`)
    }
    options.host.append(poster)
    persistPoster(options.cacheKey, options.targetSeconds, poster)
    return poster
  })()
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true
      reject(new Error(`首帧生成超过 ${options.timeoutMs} ms`))
    }, options.timeoutMs)
  })

  try {
    return await Promise.race([previewTask, waitForAbort(options.signal), timeout])
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId)
    await source.stop().catch(() => undefined)
    await player.destroy().catch(() => undefined)
    previewContainer.remove()
  }
}

export type { LibmediaFramePreviewOptions }
