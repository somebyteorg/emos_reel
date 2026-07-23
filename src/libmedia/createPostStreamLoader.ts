import { IOError, IOFlags } from '@libmedia/avutil/enum'
import {
  type CachedMediaByteRange,
  type CachedMediaTimeRange,
  type MediaCacheSnapshot,
  type MediaCacheTimeline,
  OpfsMediaCache,
} from '@/libmedia/mediaCache'
import { type PersistentReadAheadSnapshot, PostStreamPrefetcher } from '@/libmedia/postStreamPrefetcher'
import { type NetworkTaskPriority, NetworkTaskScheduler } from '@/libmedia/networkTaskScheduler'
import type { PlaybackReadSource, PlaybackSeekDebugEntry } from '@/types/player'

type AVPlayerConstructor = typeof import('@libmedia/avplayer').default
type CustomIOLoaderConstructor = AVPlayerConstructor['IOLoader']['CustomIOLoader']
type CustomIOLoader = InstanceType<CustomIOLoaderConstructor>
type ReadBuffer = Parameters<CustomIOLoader['read']>[0]

interface PostStreamLoaderOptions {
  url: string
  /** Body payload from manifest play_data.data — POSTed as JSON as-is. */
  data: unknown
  extension: string
  headers?: Record<string, string>
  /** How many automatic reconnects after a stream failure (from current byte offset). */
  retryCount?: number
  /** Returns the media duration once the demuxer has discovered it. */
  getMediaDuration?: () => number
  /** Stable media_id used as the bounded OPFS cache namespace. */
  cacheKey: string
  onError?: (error: Error) => void
  /** Reports whether bytes were read from the network response or local cache. */
  onRead?: (source: PlaybackReadSource, bytes: number) => void
  /** Fired when a reconnect is about to start (for buffering UI). */
  onRetry?: (attempt: number, remaining: number, error: unknown) => void
  /** Reports when a retained response is consuming bytes to catch up with cached playback. */
  onStreamCatchUpChange?: (catchingUp: boolean, seconds?: number) => void
  onSeekDebug?: (entry: PlaybackSeekDebugEntry) => void
  onPrefetchRange?: (startSeconds: number, endSeconds: number) => void
  onPrefetchChange?: (snapshot: PersistentReadAheadSnapshot) => void
  onBytes?: (bytes: number, durationMs: number) => void
}

interface NetworkChunk {
  start: number
  bytes: Uint8Array
}

interface ActiveCacheFill {
  generation: number
  position: number
  promise: Promise<NetworkChunk | number | undefined>
}

const CACHE_READ_WINDOW_BYTES = 4 * 1024 * 1024
const CACHED_TIMELINE_MERGE_GAP_SECONDS = 1
const MAX_CACHED_ISLAND_OVERWRITE_SECONDS = 30
const SEEK_TRACE_SETTLE_TIMEOUT_MS = 5_000
const SEEK_TRACE_PUBLISH_INTERVAL_MS = 500
const PERSISTENT_READ_AHEAD_SECONDS = 180
const PERSISTENT_READ_AHEAD_RESUME_SECONDS = 60
const PERSISTENT_READ_AHEAD_START_SECONDS = 10
const PERSISTENT_READ_AHEAD_PAUSE_SECONDS = 3

interface ActiveSeekTrace extends Omit<PlaybackSeekDebugEntry, 'elapsedMs' | 'outcome'> {
  startedAt: number
}

export interface PostStreamLoaderControl {
  beginTimeSeek: (seconds: number, currentSeconds?: number) => void
  endTimeSeek: (seconds: number) => void
  markTimeSeekSettled: () => void
  updatePersistentReadAhead: (currentSeconds: number, playableAheadSeconds: number) => void
  getPersistentReadAhead: () => PostStreamReadAheadSnapshot | undefined
  getCachedTimeline: () => Promise<MediaCacheTimeline>
  getAverageBitrate: (durationSeconds?: number) => number | undefined
  getReadAheadSeconds: (currentSeconds: number, durationSeconds?: number) => number | undefined
  flushCache: () => Promise<void>
  releaseNetworkStream: () => Promise<void>
  rememberTimeRange: (startSeconds: number, endSeconds: number) => boolean
  resetCachedTimeline: () => void
}

export type PostStreamState = 'closed' | 'connecting' | 'reading' | 'retained' | 'overwriting'

export interface PostStreamReadAheadSnapshot extends PersistentReadAheadSnapshot {
  sessionState: PostStreamSessionState
  streamPosition: number
  streamState: PostStreamState
}

export type PostStreamSessionState = 'idle' | 'opening' | 'ready' | 'reading' | 'seeking' | 'stopping' | 'stopped' | 'failed'

export type ControlledPostStreamLoader = CustomIOLoader & PostStreamLoaderControl

export type PostStreamErrorCode = 'http' | 'network' | 'range-not-satisfiable' | 'range-ignored' | 'range-mismatch' | 'missing-body' | 'premature-eof'

export class PostStreamError extends Error {
  readonly code: PostStreamErrorCode
  readonly httpStatus?: number
  readonly retryable: boolean

  constructor(message: string, options: { code: PostStreamErrorCode; retryable: boolean; httpStatus?: number }) {
    super(message)
    this.name = 'PostStreamError'
    this.code = options.code
    this.retryable = options.retryable
    this.httpStatus = options.httpStatus
  }
}

class StreamSupersededError extends Error {
  constructor() {
    super('POST media stream was superseded')
    this.name = 'StreamSupersededError'
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isRetryableError(error: unknown) {
  return !(error instanceof PostStreamError) || error.retryable
}

function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function retryDelayMs(attemptIndex: number) {
  return Math.min(2_500, 250 * 2 ** Math.max(0, attemptIndex))
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Copy into libmedia's buffer view (may be a SAB-backed proxy Uint8Array). */
function writeIntoBuffer(buffer: ReadBuffer, source: Uint8Array, offset = 0) {
  const writeLength = Math.min(buffer.length - offset, source.length)
  if (writeLength <= 0) return 0
  try {
    buffer.set(source.subarray(0, writeLength), offset)
  } catch {
    for (let index = 0; index < writeLength; index += 1) {
      buffer[offset + index] = source[index]!
    }
  }
  return writeLength
}

/** Parse `Content-Range: bytes start-end/total`. */
function parseContentRange(header: string | null) {
  if (!header) return undefined
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header.trim())
  if (!match) return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  const total = match[3] === '*' ? undefined : Number(match[3])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return undefined
  if (total !== undefined && (!Number.isSafeInteger(total) || total <= end)) return undefined
  return { start, end, total }
}

function positiveInt(value: unknown) {
  const number = Math.trunc(Number(value))
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function mergeByteRange(ranges: CachedMediaByteRange[], nextRange: CachedMediaByteRange) {
  if (!Number.isSafeInteger(nextRange.start) || !Number.isSafeInteger(nextRange.end) || nextRange.start < 0 || nextRange.end <= nextRange.start) {
    return ranges
  }
  const sorted = [...ranges, nextRange].sort((left, right) => left.start - right.start)
  const merged: CachedMediaByteRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end) {
      merged.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

function cloneTimeline(timeline: MediaCacheTimeline): MediaCacheTimeline {
  return {
    ranges: timeline.ranges.map((range) => ({ ...range })),
    anchors: timeline.anchors.map((anchor) => ({ ...anchor })),
    seekPoints: timeline.seekPoints.map((point) => ({ ...point })),
  }
}

function mergeCachedTimeRange(ranges: CachedMediaTimeRange[], nextRange: CachedMediaTimeRange) {
  if (!Number.isFinite(nextRange.start) || !Number.isFinite(nextRange.end) || nextRange.end <= nextRange.start) return ranges
  const merged: CachedMediaTimeRange[] = []
  for (const range of [...ranges, nextRange].sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end + CACHED_TIMELINE_MERGE_GAP_SECONDS) {
      merged.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

export function inferMediaExtension(value: string) {
  let pathname = value
  try {
    pathname = new URL(value, window.location.href).pathname
  } catch {
    // A media name is also accepted as a fallback when the URL has no suffix.
  }
  const encodedFilename = pathname.split('/').pop() ?? ''
  let filename = encodedFilename
  try {
    filename = decodeURIComponent(encodedFilename)
  } catch {
    // Keep the encoded file name when the URL contains malformed escapes.
  }
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() || undefined : undefined
}

/**
 * Streams a full media file over POST.
 *
 * Backend contract:
 * - method: POST {play_url}
 * - Content-Type: application/json
 * - body: play_data.data serialized as JSON (e.g. { "data": "..." })
 * - request header Range: bytes={start}-   (seek / resume; do NOT send Content-Range)
 * - response: 200/206 raw media bytes from {start}
 * - response Content-Range total is the authoritative file size
 *
 * Important: AVPlayer maps any thrown error in read() to DATA_INVALID (-2).
 * This loader never throws from open/read/seek/stop — it returns IOError codes.
 */
export function createPostStreamLoader(CustomIOLoaderBase: CustomIOLoaderConstructor, options: PostStreamLoaderOptions): ControlledPostStreamLoader {
  const retryCount = Math.max(0, Math.floor(options.retryCount ?? 3))
  const requestUrl = options.url
  const requestBody = JSON.stringify(options.data)
  const persistentCache = new OpfsMediaCache(options.cacheKey)

  class PostStreamLoader extends CustomIOLoaderBase {
    private abortController: AbortController | undefined
    private fatalError: Error | undefined
    private operationGeneration = 0
    private pendingBuffer: Uint8Array | undefined
    private pendingStart = 0
    /** Byte position requested by libmedia. */
    private position = 0
    private reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    /** Next byte that can continue directly from the retained foreground response. */
    private foregroundNetworkEdgePosition: number | undefined
    private activeCacheFill: ActiveCacheFill | undefined
    private readonly networkScheduler = new NetworkTaskScheduler()
    /** Next unread byte in the currently open HTTP response. */
    private streamPosition = 0
    private streamGeneration = 0
    private streamCatchingUp = false
    private streamCatchUpSeconds = 0
    private requestStartedAt = 0
    private firstResponseChunk = false
    private retriesRemaining = retryCount
    private retryAttempt = 0
    private sessionState: PostStreamSessionState = 'idle'
    private stopped = true
    private resolvedSize = 0
    private deliveredByteRanges: CachedMediaByteRange[] = []
    private cachedTimeline: MediaCacheTimeline = { ranges: [], anchors: [], seekPoints: [] }
    private timeSeekPositions: number[] = []
    private timeSeekActive = false
    private seekTraceSequence = 0
    private activeSeekTrace: ActiveSeekTrace | undefined
    private seekTraceTimer: ReturnType<typeof setTimeout> | undefined
    private seekTracePublishTimer: ReturnType<typeof setTimeout> | undefined
    private readonly prefetcher = new PostStreamPrefetcher({
      cache: persistentCache,
      targetSeconds: PERSISTENT_READ_AHEAD_SECONDS,
      resumeSeconds: PERSISTENT_READ_AHEAD_RESUME_SECONDS,
      startAboveSeconds: PERSISTENT_READ_AHEAD_START_SECONDS,
      pauseBelowSeconds: PERSISTENT_READ_AHEAD_PAUSE_SECONDS,
      getMediaSize: () => this.resolvedSize,
      getMediaDuration: () => Number(options.getMediaDuration?.() ?? 0),
      getReadPosition: () => this.position,
      readNetworkRange: (start, end, signal, onProgress) => this.readNetworkRange(start, end, signal, onProgress),
      onRangeMapped: (startSeconds, endSeconds) => {
        this.rememberCachedTimelineRange(startSeconds, endSeconds)
        options.onPrefetchRange?.(startSeconds, endSeconds)
      },
      onSnapshotChange: options.onPrefetchChange,
    })

    get ext() {
      return options.extension
    }

    get flags() {
      return IOFlags.NETWORK | IOFlags.SEEKABLE
    }

    get name() {
      return `POST ${options.url}`
    }

    beginTimeSeek(seconds: number, currentSeconds?: number) {
      if (!Number.isFinite(seconds) || (currentSeconds != null && !Number.isFinite(currentSeconds))) return
      this.startSeekTrace(seconds, currentSeconds)
      this.timeSeekPositions = []
      this.timeSeekActive = true

      // The actual byte target arrives in seek(). Keep the reader until then so
      // the cache can decide whether its contiguous range makes reuse safe.
      this.operationGeneration += 1
      this.sessionState = 'seeking'
      this.networkScheduler.cancel('prefetch')
      this.pendingBuffer = undefined
      this.foregroundNetworkEdgePosition = undefined
      this.prefetcher.reset()
      this.setStreamCatchingUp(false)
    }

    endTimeSeek(seconds: number) {
      // At this point libmedia has scanned from the Cue to the requested frame.
      // The delivered cursor is a better time mapping than the original Cue byte.
      const position = this.position
      if (Number.isFinite(seconds) && Number.isSafeInteger(position) && position >= 0) {
        const time = Math.max(0, seconds)
        const anchor = { time, position }
        this.cachedTimeline.anchors = [...this.cachedTimeline.anchors.filter((item) => Math.abs(item.time - anchor.time) >= 5), anchor].sort((left, right) => left.time - right.time).slice(-4_096)
        persistentCache.rememberTimeAnchor(anchor.time, anchor.position)
        const seekPosition = this.timeSeekPositions.at(-1)
        if (seekPosition != null && seekPosition <= position) {
          const point = { time, position: seekPosition, readPosition: position }
          this.cachedTimeline.seekPoints = [...this.cachedTimeline.seekPoints.filter((item) => Math.abs(item.time - time) >= 1), point].sort((left, right) => left.time - right.time).slice(-4_096)
          persistentCache.rememberSeekPoint(point)
        }
      }
      this.timeSeekPositions = []
      this.timeSeekActive = false
      const trace = this.activeSeekTrace
      if (!trace) return
      trace.seekPromiseMs = performance.now() - trace.startedAt
      if (trace.settledMs != null) {
        this.emitSeekTrace('settled')
        return
      }
      if (this.seekTraceTimer) clearTimeout(this.seekTraceTimer)
      this.seekTraceTimer = setTimeout(() => this.emitSeekTrace('resolved'), SEEK_TRACE_SETTLE_TIMEOUT_MS)
    }

    markTimeSeekSettled() {
      const trace = this.activeSeekTrace
      if (!trace) return
      trace.settledMs = performance.now() - trace.startedAt
      if (trace.seekPromiseMs != null) this.emitSeekTrace('settled')
    }

    updatePersistentReadAhead(currentSeconds: number, playableAheadSeconds: number) {
      if (this.timeSeekActive || this.stopped) return
      this.prefetcher.update(currentSeconds, playableAheadSeconds)
    }

    getPersistentReadAhead() {
      const snapshot = this.prefetcher.getSnapshot()
      const streamState: PostStreamState = this.streamCatchingUp
        ? 'overwriting'
        : this.abortController && !this.reader
          ? 'connecting'
          : this.reader
            ? snapshot.state === 'holding'
              ? 'retained'
              : 'reading'
            : 'closed'
      return {
        ...snapshot,
        sessionState: this.sessionState,
        streamPosition: this.streamPosition,
        streamState,
      }
    }

    async getCachedTimeline() {
      const snapshot = await persistentCache.getTimeline()
      this.cachedTimeline = this.reconcileCachedTimeline(snapshot)
      return cloneTimeline(this.cachedTimeline)
    }

    getAverageBitrate(durationSeconds = Number(options.getMediaDuration?.() ?? 0)) {
      if (this.resolvedSize <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined
      return (this.resolvedSize * 8) / durationSeconds
    }

    getReadAheadSeconds(currentSeconds: number, durationSeconds = Number(options.getMediaDuration?.() ?? 0)) {
      if (this.resolvedSize <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds)) return undefined
      const bytesPerSecond = this.resolvedSize / durationSeconds
      if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return undefined
      const pendingEnd = this.pendingBuffer?.length ? this.pendingStart + this.pendingBuffer.length : 0
      const readEnd = Math.min(this.resolvedSize, Math.max(this.position, this.streamPosition, pendingEnd))
      const playbackByte = this.estimateBytePosition(currentSeconds, durationSeconds, bytesPerSecond)
      return Math.max(0, Math.min(durationSeconds - currentSeconds, (readEnd - playbackByte) / bytesPerSecond))
    }

    flushCache() {
      return persistentCache.flush()
    }

    releaseNetworkStream() {
      return this.closeReader()
    }

    rememberTimeRange(startSeconds: number, endSeconds: number) {
      const byteRanges = this.deliveredByteRanges.map((range) => ({ ...range }))
      if (!byteRanges.length) return false
      persistentCache.rememberTimeRange(startSeconds, endSeconds, byteRanges)
      this.rememberCachedTimelineRange(startSeconds, endSeconds)
      this.deliveredByteRanges = []
      return true
    }

    resetCachedTimeline() {
      this.cachedTimeline = { ranges: [], anchors: [], seekPoints: [] }
      this.deliveredByteRanges = []
      this.prefetcher.reset()
    }

    async open() {
      try {
        this.networkScheduler.reset()
        this.prefetcher.reset()
        this.operationGeneration += 1
        this.sessionState = 'opening'
        this.position = 0
        this.streamPosition = 0
        this.resolvedSize = 0
        this.pendingBuffer = undefined
        this.pendingStart = 0
        this.foregroundNetworkEdgePosition = undefined
        this.fatalError = undefined
        this.retriesRemaining = retryCount
        this.retryAttempt = 0
        this.setStreamCatchingUp(false)
        this.stopped = false
        this.deliveredByteRanges = []
        this.timeSeekPositions = []
        this.timeSeekActive = false
        await this.closeReader()

        const generation = this.operationGeneration
        persistentCache.markAccessed()
        const cachedSize = await persistentCache.getSize()
        if (cachedSize) this.resolvedSize = cachedSize
        const cached = await persistentCache.get(0, 2 * 1024 * 1024)
        if (generation !== this.operationGeneration || this.stopped) return 0
        if (cached?.length) {
          this.pendingBuffer = cached
          this.pendingStart = 0
          options.onRead?.('cache', cached.length)
          this.sessionState = 'ready'
          return 0
        }
        const result = await this.fillCacheAtPosition(0, generation)
        if (typeof result === 'number') return result === IOError.AGAIN ? 0 : result
        const value = await persistentCache.get(0, 2 * 1024 * 1024)
        if (!value?.length) return this.fail(new Error('媒体流未能写入本机缓存'))
        this.pendingBuffer = value
        this.pendingStart = 0
        options.onRead?.('cache', value.length)
        // EBML header 1A 45 DF A3 (matroska/webm) — soft check only.
        if (value[0] === 0x1a && value[1] === 0x45 && value[2] === 0xdf && value[3] === 0xa3) {
          this.sessionState = 'ready'
          return 0
        }
        // Still accept non-EBML prefixes (some gateways add wrappers); demux will decide.
        console.warn(
          '[EMOS REEL] POST media open: response does not start with EBML header',
          Array.from(value.subarray(0, 8))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(' '),
        )
        this.sessionState = 'ready'
        return 0
      } catch (error) {
        if (isAbortError(error) || error instanceof StreamSupersededError) return 0
        return this.fail(error)
      }
    }

    async read(buffer: ReadBuffer) {
      try {
        if (this.stopped) return IOError.END
        if (this.fatalError) return IOError.NETWORK_ERROR
        if (this.resolvedSize > 0 && this.position >= this.resolvedSize) {
          this.setStreamCatchingUp(false)
          return IOError.END
        }

        if (this.sessionState !== 'failed' && this.sessionState !== 'stopping' && this.sessionState !== 'stopped') this.sessionState = 'reading'
        const generation = this.operationGeneration
        while (!this.stopped && generation === this.operationGeneration) {
          const pendingLength = this.copyPendingBuffer(buffer)
          if (pendingLength > 0) return pendingLength

          if (this.shouldContinueForegroundNetwork()) {
            const result = await this.fillCacheAtPosition(this.position, generation)
            if (typeof result === 'number') {
              if (result === IOError.AGAIN) continue
              return result
            }
            if (!result) continue
            const networkLength = this.copyFilledNetworkChunk(buffer, result)
            if (networkLength > 0) return networkLength
            continue
          }

          const cachedLength = await this.copyPersistentBuffer(buffer, generation)
          if (cachedLength > 0) return cachedLength
          if (generation !== this.operationGeneration) return IOError.AGAIN

          const result = await this.fillCacheAtPosition(this.position, generation)
          if (typeof result === 'number') {
            if (result === IOError.AGAIN) continue
            return result
          }
          if (!result) continue
          const networkLength = this.copyFilledNetworkChunk(buffer, result)
          if (networkLength > 0) return networkLength
        }

        return this.stopped ? IOError.END : IOError.AGAIN
      } catch (error) {
        console.error('[EMOS REEL] POST media read exception', error)
        return this.fail(error)
      }
    }

    async seek(pos: bigint | number) {
      try {
        // Demuxer may pass fractional byte offsets; always truncate to integer.
        const raw = typeof pos === 'bigint' ? Number(pos) : Number(pos)
        if (!Number.isFinite(raw) || raw < 0) return IOError.INVALID_OPERATION
        let nextPosition = Math.trunc(raw)

        if (this.resolvedSize > 0 && nextPosition > this.resolvedSize) {
          // Treat demuxer probes beyond the discovered EOF as an EOF seek.
          nextPosition = this.resolvedSize
        }

        this.operationGeneration += 1
        this.sessionState = 'seeking'
        this.networkScheduler.cancel('prefetch')
        this.prefetcher.reset()
        const generation = this.operationGeneration
        this.position = nextPosition
        if (this.timeSeekActive) {
          this.timeSeekPositions.push(nextPosition)
          if (this.activeSeekTrace) this.activeSeekTrace.readPosition = nextPosition
          const byteTargets = this.activeSeekTrace?.byteTargets
          if (byteTargets && byteTargets.at(-1) !== nextPosition) byteTargets.push(nextPosition)
        }
        this.fatalError = undefined
        this.retriesRemaining = retryCount
        this.retryAttempt = 0
        this.stopped = false
        this.pendingBuffer = undefined
        this.pendingStart = nextPosition
        this.foregroundNetworkEdgePosition = undefined
        this.setStreamCatchingUp(false)

        const oldReader = this.reader
        const oldStreamPosition = this.streamPosition
        let reuseReader = false
        if (oldReader && nextPosition <= oldStreamPosition) {
          const distance = oldStreamPosition - nextPosition
          const contiguousLength = distance > 0 ? await persistentCache.getContiguousLength(nextPosition, distance) : 0
          reuseReader = distance === 0 || contiguousLength >= distance
        }
        if (generation !== this.operationGeneration || this.stopped) return 0
        const trace = this.activeSeekTrace
        if (trace && trace.readerDecision !== 'abort') {
          trace.readerDecision = reuseReader ? 'reuse' : oldReader || this.abortController ? 'abort' : 'none'
        }
        const readerClose = reuseReader ? undefined : this.reader || this.abortController ? this.closeReader() : undefined
        // Preserve the bytes already received, but never make seek latency depend
        // on OPFS flush speed. The hot cache is immediately readable meanwhile.
        void persistentCache.flushMedia()
        await readerClose
        if (generation !== this.operationGeneration || this.stopped) return 0
        return 0
      } catch (error) {
        console.error('[EMOS REEL] POST media seek exception', error)
        return IOError.INVALID_OPERATION
      }
    }

    async size() {
      return BigInt(this.resolvedSize > 0 ? this.resolvedSize : 0)
    }

    async stop() {
      this.operationGeneration += 1
      this.sessionState = 'stopping'
      this.stopped = true
      this.pendingBuffer = undefined
      this.foregroundNetworkEdgePosition = undefined
      this.emitSeekTrace('stopped')
      await this.closeReader()
      await this.prefetcher.stop()
      await persistentCache.close()
      this.networkScheduler.stop()
      this.sessionState = 'stopped'
    }

    private estimateBytePosition(currentSeconds: number, durationSeconds: number, fallbackBytesPerSecond: number) {
      const anchors = this.indexAnchors()
        .filter((anchor) => Number.isFinite(anchor.time) && Number.isSafeInteger(anchor.position) && anchor.time >= 0 && anchor.position >= 0)
        .sort((left, right) => left.time - right.time)
      let before: MediaCacheTimeline['anchors'][number] | undefined
      let after: MediaCacheTimeline['anchors'][number] | undefined
      for (const anchor of anchors) {
        if (anchor.time <= currentSeconds) before = anchor
        if (!after && anchor.time >= currentSeconds) after = anchor
      }
      let position: number
      if (before && after && after.time > before.time && after.position >= before.position) {
        const ratio = (currentSeconds - before.time) / (after.time - before.time)
        position = before.position + (after.position - before.position) * ratio
      } else if (before && currentSeconds >= before.time && durationSeconds > before.time && this.resolvedSize > before.position) {
        const bytesPerSecond = (this.resolvedSize - before.position) / (durationSeconds - before.time)
        position = before.position + (currentSeconds - before.time) * bytesPerSecond
      } else if (after && currentSeconds <= after.time && after.time > 0) {
        position = (currentSeconds / after.time) * after.position
      } else {
        position = currentSeconds * fallbackBytesPerSecond
      }
      return Math.min(this.resolvedSize, Math.max(0, position))
    }

    private indexAnchors() {
      return [...this.cachedTimeline.anchors, ...this.cachedTimeline.seekPoints.map((point) => ({ time: point.time, position: point.readPosition }))]
        .filter((anchor) => Number.isFinite(anchor.time) && Number.isSafeInteger(anchor.position) && anchor.time >= 0 && anchor.position >= 0)
        .sort((left, right) => left.time - right.time)
    }

    private rememberCachedTimelineRange(start: number, end: number) {
      this.cachedTimeline.ranges = mergeCachedTimeRange(this.cachedTimeline.ranges, { start, end })
    }

    private reconcileCachedTimeline(snapshot: MediaCacheSnapshot) {
      const timeline: MediaCacheTimeline = {
        ranges: snapshot.ranges.map((range) => ({ ...range })),
        anchors: snapshot.anchors.map((anchor) => ({ ...anchor })),
        seekPoints: snapshot.seekPoints.map((point) => ({ ...point })),
      }
      const anchors = [...timeline.anchors, ...timeline.seekPoints.map((point) => ({ time: point.time, position: point.readPosition }))]
        .filter((anchor) => Number.isFinite(anchor.time) && Number.isSafeInteger(anchor.position) && anchor.time >= 0 && anchor.position >= 0)
        .sort((left, right) => left.position - right.position)
      for (const byteRange of snapshot.byteRanges) {
        let previous: MediaCacheTimeline['anchors'][number] | undefined
        for (const anchor of anchors) {
          if (anchor.position < byteRange.start) continue
          if (anchor.position > byteRange.end) break
          if (previous && anchor.position > previous.position && anchor.time > previous.time) {
            timeline.ranges = mergeCachedTimeRange(timeline.ranges, { start: previous.time, end: anchor.time })
          }
          previous = anchor
        }
      }
      return timeline
    }

    private estimateTimeAtByte(position: number) {
      const duration = Number(options.getMediaDuration?.() ?? 0)
      if (this.resolvedSize <= 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(position) || position < 0) return undefined
      const anchors = this.indexAnchors()
        .filter(
          (anchor) =>
            Number.isFinite(anchor.time) && Number.isSafeInteger(anchor.position) && anchor.time >= 0 && anchor.time <= duration && anchor.position >= 0 && anchor.position <= this.resolvedSize,
        )
        .sort((left, right) => left.position - right.position)
      let before: MediaCacheTimeline['anchors'][number] | undefined
      let after: MediaCacheTimeline['anchors'][number] | undefined
      for (const anchor of anchors) {
        if (anchor.position <= position) before = anchor
        if (!after && anchor.position >= position) after = anchor
      }
      let time: number
      if (before?.position === position) {
        time = before.time
      } else if (after?.position === position) {
        time = after.time
      } else if (before && after && after.position > before.position && after.time >= before.time) {
        const ratio = (position - before.position) / (after.position - before.position)
        time = before.time + (after.time - before.time) * ratio
      } else if (before && this.resolvedSize > before.position && duration > before.time) {
        const ratio = (position - before.position) / (this.resolvedSize - before.position)
        time = before.time + (duration - before.time) * ratio
      } else if (after && after.position > 0) {
        time = (position / after.position) * after.time
      } else {
        time = (position / this.resolvedSize) * duration
      }
      return Math.min(duration, Math.max(0, time))
    }

    private cachedTimelineRangeAtByte(position: number) {
      const time = this.estimateTimeAtByte(position)
      if (time == null) return undefined
      const range = this.cachedTimeline.ranges.find((candidate) => time >= candidate.start && time < candidate.end)
      return range ? { range, time } : undefined
    }

    private hasGapAfterCachedRange(range: CachedMediaTimeRange) {
      const duration = Number(options.getMediaDuration?.() ?? 0)
      return Number.isFinite(duration) && duration > 0 && range.end < duration - CACHED_TIMELINE_MERGE_GAP_SECONDS
    }

    private shouldContinueForegroundNetwork() {
      if (!this.reader || this.foregroundNetworkEdgePosition !== this.position || this.streamPosition !== this.position) return false
      const cached = this.cachedTimelineRangeAtByte(this.position)
      if (!cached) return true
      return cached.range.end - cached.time <= MAX_CACHED_ISLAND_OVERWRITE_SECONDS && this.hasGapAfterCachedRange(cached.range)
    }

    private shouldOverwriteCachedInterval(start: number, end: number) {
      if (end <= start) return false
      const cached = this.cachedTimelineRangeAtByte(start)
      const endTime = this.estimateTimeAtByte(end)
      if (!cached || endTime == null || endTime <= cached.time) return false
      return (
        cached.range.end - cached.time <= MAX_CACHED_ISLAND_OVERWRITE_SECONDS && Math.abs(cached.range.end - endTime) <= CACHED_TIMELINE_MERGE_GAP_SECONDS && this.hasGapAfterCachedRange(cached.range)
      )
    }

    private copyPendingBuffer(buffer: ReadBuffer) {
      if (!this.pendingBuffer?.length) return 0
      if (this.position < this.pendingStart || this.position >= this.pendingStart + this.pendingBuffer.length) {
        this.pendingBuffer = undefined
        return 0
      }
      const offset = this.position - this.pendingStart
      if (offset > 0) {
        this.pendingBuffer = this.pendingBuffer.subarray(offset)
        this.pendingStart = this.position
      }
      const readStart = this.position
      const writeLength = writeIntoBuffer(buffer, this.pendingBuffer, 0)
      this.position += writeLength
      this.noteDeliveredBytes(readStart, writeLength)
      if (writeLength < this.pendingBuffer.length) {
        this.pendingBuffer = this.pendingBuffer.subarray(writeLength)
        this.pendingStart = this.position
      } else {
        this.pendingBuffer = undefined
        this.pendingStart = this.position
      }
      return writeLength
    }

    private copyFilledNetworkChunk(buffer: ReadBuffer, chunk: NetworkChunk) {
      const chunkEnd = chunk.start + chunk.bytes.length
      if (this.position < chunk.start || this.position >= chunkEnd) return 0
      const source = chunk.bytes.subarray(this.position - chunk.start)
      const readStart = this.position
      const writeLength = writeIntoBuffer(buffer, source)
      if (writeLength <= 0) return 0
      this.position += writeLength
      this.noteDeliveredBytes(readStart, writeLength)
      options.onRead?.('cache', source.length)
      if (this.activeSeekTrace) this.activeSeekTrace.cacheBytes += source.length
      if (writeLength < source.length) {
        this.pendingBuffer = source.subarray(writeLength)
        this.pendingStart = this.position
      }
      this.foregroundNetworkEdgePosition = chunkEnd
      return writeLength
    }

    private async copyPersistentBuffer(buffer: ReadBuffer, generation: number, maxLength = CACHE_READ_WINDOW_BYTES) {
      const activeFill = this.activeCacheFill
      if (activeFill?.generation === generation && activeFill.position === this.position) {
        await activeFill.promise.catch(() => undefined)
        if (generation !== this.operationGeneration || this.stopped) return 0
      }
      const lookupStartedAt = performance.now()
      const trace = this.activeSeekTrace
      const cached = await persistentCache.get(this.position, Math.min(CACHE_READ_WINDOW_BYTES, maxLength))
      const lookupMs = performance.now() - lookupStartedAt
      if (trace && trace === this.activeSeekTrace) {
        trace.cacheLookups += 1
        trace.cacheLookupMs += lookupMs
        trace.slowestCacheLookupMs = Math.max(trace.slowestCacheLookupMs, lookupMs)
        if (!cached?.length) trace.cacheMisses += 1
      }
      if (generation !== this.operationGeneration || this.stopped) return 0
      if (!cached?.length) return 0
      this.foregroundNetworkEdgePosition = undefined
      const readStart = this.position
      const writeLength = writeIntoBuffer(buffer, cached, 0)
      this.position += writeLength
      this.noteDeliveredBytes(readStart, writeLength)
      options.onRead?.('cache', cached.length)
      if (trace) trace.cacheBytes += cached.length
      if (writeLength < cached.length) {
        this.pendingBuffer = cached.subarray(writeLength)
        this.pendingStart = this.position
      }
      if (this.reader && this.position > this.streamPosition) {
        if (trace) trace.catchUpEntered = true
        this.setStreamCatchingUp(true)
      }
      return writeLength
    }

    private noteDeliveredBytes(start: number, length: number) {
      if (length <= 0) return
      if (this.activeSeekTrace) this.activeSeekTrace.readPosition = start + length
      this.deliveredByteRanges = mergeByteRange(this.deliveredByteRanges, {
        start,
        end: start + length,
      })
    }

    private async tryRetry(generation: number, error: unknown) {
      if (generation !== this.operationGeneration || this.stopped) return false
      if (!isRetryableError(error)) return false
      if (this.retriesRemaining <= 0) return false
      this.retriesRemaining -= 1
      const attempt = this.retryAttempt
      this.retryAttempt += 1
      options.onRetry?.(attempt + 1, this.retriesRemaining, error)
      await sleep(retryDelayMs(attempt))
      return generation === this.operationGeneration && !this.stopped
    }

    private applySizeFromResponse(response: Response, requestStart: number) {
      const contentRange = parseContentRange(response.headers.get('Content-Range'))
      if (contentRange?.total) {
        this.resolvedSize = contentRange.total
        persistentCache.setSize(contentRange.total)
        return
      }
      const fromLength = positiveInt(response.headers.get('Content-Length'))
      if (fromLength && (response.status === 200 || response.status === 206)) {
        // Content-Range is not readable cross-origin unless the server exposes it.
        // Requests are always open-ended, so offset + Content-Length is the total.
        const inferredSize = response.status === 206 ? requestStart + fromLength : fromLength
        this.resolvedSize = inferredSize
        persistentCache.setSize(inferredSize)
      }
    }

    private async getReader(requestStart: number) {
      if (this.reader) return this.reader

      const streamGeneration = ++this.streamGeneration
      const abortController = new AbortController()
      this.abortController = abortController
      this.streamPosition = requestStart
      const headers = new Headers(options.headers)
      headers.set('Content-Type', 'application/json')
      // Only Range — Content-Range is not used by the media service and confuses debugging.
      headers.set('Range', `bytes=${requestStart}-`)

      const startedAt = performance.now()
      const requestTrace = this.activeSeekTrace
      requestTrace?.rangeStarts.push(requestStart)
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: abortController.signal,
      })
      if (requestTrace && requestTrace === this.activeSeekTrace) requestTrace.rangeTtfbMs.push(performance.now() - startedAt)

      if (streamGeneration !== this.streamGeneration || this.stopped) {
        abortController.abort()
        await response.body?.cancel().catch(() => undefined)
        throw new StreamSupersededError()
      }

      if (!(response.status === 200 || response.status === 206)) {
        await response.body?.cancel().catch(() => undefined)
        const detail = response.statusText ? ` ${response.statusText}` : ''
        throw new PostStreamError(`POST media request failed with HTTP ${response.status}${detail}`.trim(), {
          code: response.status === 416 ? 'range-not-satisfiable' : 'http',
          httpStatus: response.status,
          retryable: isRetryableHttpStatus(response.status),
        })
      }
      if (!response.body) {
        throw new PostStreamError('POST media response has no readable body', {
          code: 'missing-body',
          retryable: true,
        })
      }

      const contentRange = parseContentRange(response.headers.get('Content-Range'))
      if (response.status === 206 && contentRange && contentRange.start !== requestStart) {
        await response.body.cancel().catch(() => undefined)
        throw new PostStreamError(`POST media Range 起点不匹配：请求 ${requestStart}，返回 ${contentRange.start}`, {
          code: 'range-mismatch',
          retryable: false,
        })
      }
      this.applySizeFromResponse(response, requestStart)

      // After seek, a 200 without Content-Range usually means the server ignored Range and restarted at 0.
      if (requestStart > 0 && response.status === 200 && !response.headers.get('Content-Range')) {
        await response.body.cancel().catch(() => undefined)
        throw new PostStreamError(`POST media seek 到 ${requestStart} 时服务端返回 200 全量（未识别 Range）。请确认支持 Range: bytes=${requestStart}-`, {
          code: 'range-ignored',
          retryable: false,
        })
      }

      this.reader = response.body.getReader()
      this.requestStartedAt = startedAt
      this.firstResponseChunk = true
      return this.reader
    }

    private enqueueNetworkTask<T>(task: () => Promise<T>, priority: NetworkTaskPriority, signal?: AbortSignal, key?: string) {
      return this.networkScheduler.schedule(priority, task, { key, signal })
    }

    private enqueueNetworkRead(generation: number, priority: NetworkTaskPriority, signal?: AbortSignal) {
      return this.enqueueNetworkTask(
        async () => {
          const abortActiveRead = () => {
            void this.closeReader()
          }
          signal?.addEventListener('abort', abortActiveRead, { once: true })
          try {
            return await this.readNetworkChunk(generation)
          } finally {
            signal?.removeEventListener('abort', abortActiveRead)
          }
        },
        priority,
        signal,
      )
    }

    private fillCacheAtPosition(position: number, generation: number) {
      const activeFill = this.activeCacheFill
      if (activeFill?.generation === generation && activeFill.position === position) return activeFill.promise
      const priority: NetworkTaskPriority = this.timeSeekActive ? 'seek' : 'playback'
      const operation = this.enqueueNetworkTask(
        async () => {
          if (generation !== this.operationGeneration || this.stopped) return IOError.AGAIN
          if (this.reader && this.streamPosition !== position) {
            const cached = await persistentCache.get(position, 1)
            if (cached?.length) return undefined
            await this.closeReader()
          }
          if (!this.reader) this.streamPosition = position
          return this.readNetworkChunk(generation)
        },
        priority,
        undefined,
        `fill:${generation}:${position}`,
      )
      const fill: ActiveCacheFill = {
        generation,
        position,
        promise: operation.finally(() => {
          if (this.activeCacheFill === fill) this.activeCacheFill = undefined
        }),
      }
      this.activeCacheFill = fill
      return fill.promise
    }

    private async readNetworkRange(start: number, end: number, signal: AbortSignal, onProgress: (start: number, end: number) => Promise<void>) {
      const generation = this.operationGeneration
      let cursor = start
      let overwritingCachedIsland = false
      try {
        const existingEnd = await this.enqueueNetworkTask(
          async () => {
            if (generation !== this.operationGeneration || this.stopped || signal.aborted) return cursor
            if (this.reader && this.streamPosition < start) {
              overwritingCachedIsland = this.shouldOverwriteCachedInterval(this.streamPosition, start)
              if (overwritingCachedIsland) {
                this.setStreamCatchingUp(true)
                if (this.activeSeekTrace) this.activeSeekTrace.catchUpEntered = true
              } else {
                await this.closeReader()
              }
            }
            if (!this.reader) this.streamPosition = start
            return Math.min(end, Math.max(start, this.streamPosition))
          },
          'prefetch',
          signal,
        )
        if (existingEnd > cursor) {
          await onProgress(cursor, existingEnd)
          cursor = existingEnd
        }

        while (cursor < end && !signal.aborted && !this.stopped && generation === this.operationGeneration) {
          const result = await this.enqueueNetworkRead(generation, 'prefetch', signal)
          if (typeof result === 'number') {
            if (result === IOError.AGAIN) continue
            if (result === IOError.END) break
            throw new Error(`后台缓存读取媒体流失败：${result}`)
          }
          const nextEnd = Math.min(end, result.start + result.bytes.length)
          if (nextEnd <= cursor) {
            if (overwritingCachedIsland) this.setStreamCatchingUp(true)
            continue
          }
          overwritingCachedIsland = false
          this.setStreamCatchingUp(false)
          await onProgress(cursor, nextEnd)
          cursor = nextEnd
        }
      } finally {
        this.setStreamCatchingUp(false)
      }
    }

    private async readNetworkChunk(generation: number): Promise<NetworkChunk | number> {
      while (!this.stopped && generation === this.operationGeneration) {
        try {
          const reader = await this.getReader(this.streamPosition)
          const readTrace = this.activeSeekTrace
          const { value, done } = await reader.read()
          if (generation !== this.operationGeneration) return this.stopped ? IOError.END : IOError.AGAIN
          if (done) {
            await this.closeReader()
            if (this.resolvedSize > 0 && this.streamPosition >= this.resolvedSize) return IOError.END
            if (this.resolvedSize <= 0 && this.streamPosition > 0) {
              this.resolvedSize = this.streamPosition
              persistentCache.setSize(this.resolvedSize)
              return IOError.END
            }
            const error = new PostStreamError(`POST media stream ended early at byte ${this.streamPosition}`, {
              code: 'premature-eof',
              retryable: true,
            })
            if (await this.tryRetry(generation, error)) {
              continue
            }
            return this.fail(error)
          }

          if (!value?.length) continue
          const start = this.streamPosition
          let chunk = value
          if (this.resolvedSize > 0) {
            const remaining = this.resolvedSize - start
            if (remaining <= 0) return IOError.END
            if (chunk.length > remaining) chunk = chunk.subarray(0, remaining)
          }
          this.streamPosition += chunk.length
          persistentCache.put(start, chunk)
          options.onRead?.('network', chunk.length)
          if (readTrace && readTrace === this.activeSeekTrace) readTrace.networkBytes += chunk.length
          if (options.onBytes) {
            const durationMs = this.firstResponseChunk ? Math.max(1, performance.now() - this.requestStartedAt) : 0
            this.firstResponseChunk = false
            options.onBytes(chunk.length, durationMs)
          }
          this.retriesRemaining = retryCount
          this.retryAttempt = 0
          return { start, bytes: chunk }
        } catch (error) {
          if (generation !== this.operationGeneration || error instanceof StreamSupersededError || isAbortError(error)) {
            return this.stopped ? IOError.END : IOError.AGAIN
          }
          const result = await this.handleNetworkError(generation, error)
          if (result < 0) return result
        }
      }
      return this.stopped ? IOError.END : IOError.AGAIN
    }

    private async handleNetworkError(generation: number, error: unknown) {
      if (generation !== this.operationGeneration) return IOError.AGAIN
      if (this.stopped) return IOError.END
      await this.closeReader()
      if (error instanceof PostStreamError && error.code === 'range-not-satisfiable') return IOError.END
      if (await this.tryRetry(generation, error)) return 0
      return this.fail(error)
    }

    private async closeReader() {
      const reader = this.reader
      const abortController = this.abortController
      this.streamGeneration += 1
      this.reader = undefined
      this.abortController = undefined
      this.foregroundNetworkEdgePosition = undefined
      this.setStreamCatchingUp(false)
      abortController?.abort()
      await reader?.cancel().catch(() => undefined)
    }

    private setStreamCatchingUp(catchingUp: boolean) {
      const seconds = catchingUp ? this.getStreamCatchUpSeconds() : 0
      if (this.streamCatchingUp === catchingUp && Math.abs(this.streamCatchUpSeconds - seconds) < 1) return
      this.streamCatchingUp = catchingUp
      this.streamCatchUpSeconds = seconds
      options.onStreamCatchUpChange?.(catchingUp, seconds)
    }

    private getStreamCatchUpSeconds() {
      const durationSeconds = Number(options.getMediaDuration?.() ?? 0)
      if (this.resolvedSize <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
      const bytesPerSecond = this.resolvedSize / durationSeconds
      return Math.max(0, (this.position - this.streamPosition) / bytesPerSecond)
    }

    private startSeekTrace(targetSeconds: number, previousSeconds?: number) {
      this.emitSeekTrace('superseded')
      this.activeSeekTrace = {
        id: ++this.seekTraceSequence,
        createdAt: Date.now(),
        targetSeconds,
        previousSeconds,
        startedAt: performance.now(),
        readerDecision: this.reader || this.abortController ? 'pending' : 'none',
        initialBytePosition: this.position,
        oldStreamPosition: this.streamPosition,
        byteTargets: [],
        readPosition: this.position,
        cacheBytes: 0,
        cacheLookups: 0,
        cacheLookupMs: 0,
        slowestCacheLookupMs: 0,
        cacheMisses: 0,
        networkBytes: 0,
        rangeStarts: [],
        rangeTtfbMs: [],
        discardedOldStreamBytes: 0,
        catchUpEntered: false,
      }
      this.publishActiveSeekTrace()
      this.scheduleSeekTracePublish()
    }

    private scheduleSeekTracePublish() {
      if (!options.onSeekDebug || this.seekTracePublishTimer || !this.activeSeekTrace) return
      this.seekTracePublishTimer = setTimeout(() => {
        this.seekTracePublishTimer = undefined
        this.publishActiveSeekTrace()
        this.scheduleSeekTracePublish()
      }, SEEK_TRACE_PUBLISH_INTERVAL_MS)
    }

    private publishActiveSeekTrace() {
      const trace = this.activeSeekTrace
      if (!trace) return
      options.onSeekDebug?.(this.seekTraceEntry(trace, 'active'))
    }

    private seekTraceEntry(trace: ActiveSeekTrace, outcome: PlaybackSeekDebugEntry['outcome']): PlaybackSeekDebugEntry {
      const { startedAt, ...entry } = trace
      return {
        ...entry,
        elapsedMs: performance.now() - startedAt,
        outcome,
      }
    }

    private emitSeekTrace(outcome: PlaybackSeekDebugEntry['outcome']) {
      const trace = this.activeSeekTrace
      if (!trace) return
      if (this.seekTraceTimer) clearTimeout(this.seekTraceTimer)
      this.seekTraceTimer = undefined
      if (this.seekTracePublishTimer) clearTimeout(this.seekTracePublishTimer)
      this.seekTracePublishTimer = undefined
      this.activeSeekTrace = undefined
      options.onSeekDebug?.(this.seekTraceEntry(trace, outcome))
    }

    private fail(error: unknown) {
      const streamError =
        error instanceof PostStreamError
          ? new PostStreamError(`POST media stream failed at byte ${this.position}: ${error.message}`, {
              code: error.code,
              httpStatus: error.httpStatus,
              retryable: error.retryable,
            })
          : new PostStreamError(`POST media stream failed at byte ${this.position}: ${errorMessage(error)}`, {
              code: 'network',
              retryable: true,
            })
      this.fatalError = streamError
      this.sessionState = 'failed'
      options.onError?.(streamError)
      return IOError.NETWORK_ERROR
    }
  }

  return new PostStreamLoader() as ControlledPostStreamLoader
}
