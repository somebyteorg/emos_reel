import { HotMediaCache } from '@/libmedia/cache/hotMediaCache'
import {
  type CachedMediaByteRange,
  type CachedMediaTimeRange,
  DEFAULT_MEDIA_CACHE_TTL_MS,
  type MediaCacheSnapshot,
  type MediaCacheStats,
  type MediaCacheTimeline,
  type MediaTimeMapping,
} from '@/libmedia/cache/mediaCacheTypes'
import { opfsCacheClient } from '@/libmedia/cache/opfsCacheClient'

export type { CachedMediaByteRange, CachedMediaTimeRange, MediaCacheSnapshot, MediaSeekPoint, MediaCacheStats, MediaCacheTimeline, MediaTimeByteAnchor } from '@/libmedia/cache/mediaCacheTypes'

export { DEFAULT_MEDIA_CACHE_TTL_MS } from '@/libmedia/cache/mediaCacheTypes'

const DISK_WRITE_BATCH_BYTES = 8 * 1024 * 1024
const DISK_READ_AHEAD_BYTES = 2 * 1024 * 1024
const TIMELINE_WRITE_DELAY_MS = 2_000

let cacheGeneration = 0
let persistenceRequest: Promise<boolean> | undefined

interface PendingWrite {
  start: number
  byteLength: number
  parts: Uint8Array[]
}

function normalizeByteRanges(ranges?: CachedMediaByteRange[]) {
  if (!ranges?.length) return []
  const merged: CachedMediaByteRange[] = []
  for (const range of ranges
    .map((item) => ({ start: Math.trunc(item.start), end: Math.trunc(item.end) }))
    .filter((item) => Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && item.start >= 0 && item.end > item.start)
    .sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end) merged.push({ ...range })
    else previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

/** A bounded in-memory hot cache backed by a chunked OPFS LRU cache. */
export class OpfsMediaCache {
  private generation = cacheGeneration
  private readonly sourceKey: string
  private readonly ttlMs: number
  private readonly hotCache = new HotMediaCache()
  private knownSize: number | undefined
  private pendingWrite: PendingWrite | undefined
  private pendingTimeMappings: MediaTimeMapping[] = []
  private mediaWriteQueue = Promise.resolve()
  private metadataWriteQueue = Promise.resolve()
  private timelineWriteTimer: ReturnType<typeof setTimeout> | undefined
  private accessTouchQueued = false
  private closed = false

  constructor(sourceKey: string, ttlMs = DEFAULT_MEDIA_CACHE_TTL_MS) {
    this.sourceKey = sourceKey
    this.ttlMs = ttlMs
  }

  async get(position: number, maxLength: number) {
    this.adoptCurrentGeneration()
    const generation = this.generation
    if (this.closed || !Number.isSafeInteger(position) || position < 0 || maxLength <= 0) return undefined
    const hot = this.hotCache.get(position, maxLength)
    if (hot?.length) return hot
    try {
      const readLength = Math.max(maxLength, DISK_READ_AHEAD_BYTES)
      const data = await opfsCacheClient.read(this.sourceKey, position, readLength)
      if (!this.isCurrentGeneration(generation) || !data?.byteLength) return undefined
      const bytes = new Uint8Array(data)
      this.hotCache.put(position, bytes)
      return bytes.subarray(0, Math.min(bytes.length, maxLength))
    } catch (error) {
      this.warnPersistenceFailure('读取 OPFS 媒体缓存失败', error)
      return undefined
    }
  }

  async getSize() {
    this.adoptCurrentGeneration()
    const generation = this.generation
    if (this.closed) return undefined
    if (this.knownSize) return this.knownSize
    try {
      const size = await opfsCacheClient.getSize(this.sourceKey)
      if (!this.isCurrentGeneration(generation)) return undefined
      if (size) this.knownSize = size
      return size
    } catch (error) {
      this.warnPersistenceFailure('读取 OPFS 媒体大小失败', error)
      return undefined
    }
  }

  async getContiguousLength(position: number, maxLength: number) {
    this.adoptCurrentGeneration()
    const generation = this.generation
    if (this.closed || !Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(maxLength) || maxLength <= 0) return 0
    const hotLength = this.hotCache.getContiguousLength(position, maxLength)
    if (hotLength >= maxLength) return hotLength
    try {
      const diskLength = await opfsCacheClient.getContiguousLength(this.sourceKey, position, maxLength)
      return this.isCurrentGeneration(generation) ? Math.max(hotLength, diskLength) : 0
    } catch (error) {
      this.warnPersistenceFailure('读取 OPFS 连续缓存长度失败', error)
      return hotLength
    }
  }

  setSize(size: number) {
    this.adoptCurrentGeneration()
    if (this.closed || !Number.isSafeInteger(size) || size <= 0 || size === this.knownSize) return
    this.knownSize = size
    this.enqueueMetadata('保存 OPFS 媒体大小失败', () => opfsCacheClient.setSize(this.sourceKey, size, this.ttlMs))
  }

  async getTimeline(): Promise<MediaCacheSnapshot> {
    this.adoptCurrentGeneration()
    const generation = this.generation
    if (this.closed) return { ranges: [], anchors: [], seekPoints: [], byteRanges: [] }
    await this.flushTimelineMappings()
    const hotByteRanges = this.hotCache.getRanges()
    try {
      const timeline = await opfsCacheClient.getTimeline(this.sourceKey)
      if (!this.isCurrentGeneration(generation)) return { ranges: [], anchors: [], seekPoints: [], byteRanges: [] }
      return {
        ranges: timeline.ranges.map((range) => ({ ...range })),
        anchors: timeline.anchors.map((anchor) => ({ ...anchor })),
        seekPoints: timeline.seekPoints.map((point) => ({ ...point })),
        byteRanges: normalizeByteRanges([...timeline.byteRanges, ...hotByteRanges]),
      }
    } catch (error) {
      this.warnPersistenceFailure('读取 OPFS 媒体时间索引失败', error)
      return { ranges: [], anchors: [], seekPoints: [], byteRanges: hotByteRanges }
    }
  }

  rememberTimeRange(start: number, end: number, byteRanges?: CachedMediaByteRange[]) {
    this.adoptCurrentGeneration()
    if (this.closed || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    const normalizedByteRanges = normalizeByteRanges(byteRanges)
    if (!normalizedByteRanges.length) return
    this.pendingTimeMappings.push({
      timeRange: { start: Math.max(0, start), end: Math.max(0, end) },
      byteRanges: normalizedByteRanges,
    })
    if (this.timelineWriteTimer) return
    this.timelineWriteTimer = setTimeout(() => {
      this.timelineWriteTimer = undefined
      void this.flushTimelineMappings()
    }, TIMELINE_WRITE_DELAY_MS)
  }

  rememberTimeAnchor(time: number, position: number) {
    this.adoptCurrentGeneration()
    if (this.closed || !Number.isFinite(time) || !Number.isSafeInteger(position) || position < 0) return
    this.enqueueMetadata('保存 OPFS 媒体定位索引失败', () => opfsCacheClient.rememberAnchor(this.sourceKey, Math.max(0, time), position, this.ttlMs))
  }

  rememberSeekPoint(point: MediaSeekPoint) {
    this.adoptCurrentGeneration()
    if (
      this.closed ||
      !Number.isFinite(point.time) ||
      !Number.isSafeInteger(point.position) ||
      point.position < 0 ||
      !Number.isSafeInteger(point.readPosition) ||
      point.readPosition < point.position
    ) {
      return
    }
    this.enqueueMetadata('保存 OPFS 媒体关键帧索引失败', () => opfsCacheClient.rememberSeekPoint(this.sourceKey, { ...point, time: Math.max(0, point.time) }, this.ttlMs))
  }

  put(start: number, bytes: Uint8Array) {
    this.adoptCurrentGeneration()
    if (this.closed || !Number.isSafeInteger(start) || start < 0 || !bytes.length) return
    this.hotCache.put(start, bytes)
    let sourceOffset = 0
    while (sourceOffset < bytes.length) {
      const position = start + sourceOffset
      const pending = this.pendingWrite
      if (!pending || pending.start + pending.byteLength !== position || pending.byteLength >= DISK_WRITE_BATCH_BYTES) {
        this.enqueuePendingWrite()
        this.pendingWrite = { start: position, byteLength: 0, parts: [] }
      }
      const active = this.pendingWrite!
      const length = Math.min(bytes.length - sourceOffset, DISK_WRITE_BATCH_BYTES - active.byteLength)
      const copy = bytes.slice(sourceOffset, sourceOffset + length)
      active.parts.push(copy)
      active.byteLength += copy.length
      sourceOffset += length
      if (active.byteLength >= DISK_WRITE_BATCH_BYTES) this.enqueuePendingWrite()
    }
  }

  async flushMedia() {
    this.adoptCurrentGeneration()
    this.enqueuePendingWrite()
    await this.mediaWriteQueue
  }

  async flush() {
    this.adoptCurrentGeneration()
    await this.flushTimelineMappings()
    await Promise.all([this.mediaWriteQueue, this.metadataWriteQueue])
    try {
      await opfsCacheClient.flush(this.sourceKey)
    } catch (error) {
      this.warnPersistenceFailure('刷新 OPFS 媒体缓存失败', error)
    }
  }

  async close() {
    if (this.closed) return
    await this.flush()
    this.closed = true
    this.hotCache.clear()
  }

  markAccessed() {
    this.adoptCurrentGeneration()
    if (this.closed || this.accessTouchQueued) return
    this.accessTouchQueued = true
    this.enqueueMetadata('更新 OPFS 媒体缓存使用时间失败', () => opfsCacheClient.touch(this.sourceKey, this.ttlMs))
  }

  private enqueuePendingWrite() {
    const pending = this.pendingWrite
    this.pendingWrite = undefined
    if (!pending?.byteLength || !this.isCurrentGeneration(this.generation)) return
    const bytes = new Uint8Array(pending.byteLength)
    let offset = 0
    for (const part of pending.parts) {
      bytes.set(part, offset)
      offset += part.length
    }
    const generation = this.generation
    this.mediaWriteQueue = this.mediaWriteQueue
      .then(async () => {
        if (this.closed || !this.isCurrentGeneration(generation)) return
        await opfsCacheClient.write(this.sourceKey, pending.start, bytes.buffer, this.ttlMs)
      })
      .catch((error) => this.warnPersistenceFailure('写入 OPFS 媒体缓存失败', error))
  }

  private async flushTimelineMappings() {
    if (this.timelineWriteTimer) clearTimeout(this.timelineWriteTimer)
    this.timelineWriteTimer = undefined
    const mappings = this.pendingTimeMappings
    this.pendingTimeMappings = []
    this.enqueuePendingWrite()
    const mediaWrites = this.mediaWriteQueue
    if (mappings.length) {
      this.enqueueMetadata('保存 OPFS 缓存时间失败', async () => {
        await mediaWrites
        await opfsCacheClient.rememberTime(this.sourceKey, mappings, this.ttlMs)
      })
    }
    await Promise.all([mediaWrites, this.metadataWriteQueue])
  }

  private enqueueMetadata(message: string, task: () => Promise<void>) {
    const generation = this.generation
    this.metadataWriteQueue = this.metadataWriteQueue
      .then(async () => {
        if (this.closed || !this.isCurrentGeneration(generation)) return
        await task()
      })
      .catch((error) => this.warnPersistenceFailure(message, error))
  }

  private adoptCurrentGeneration() {
    if (this.generation === cacheGeneration) return
    this.generation = cacheGeneration
    this.pendingWrite = undefined
    this.pendingTimeMappings = []
    this.hotCache.clear()
    this.accessTouchQueued = false
    if (this.timelineWriteTimer) clearTimeout(this.timelineWriteTimer)
    this.timelineWriteTimer = undefined
    const knownSize = this.knownSize
    this.knownSize = undefined
    if (knownSize) this.setSize(knownSize)
  }

  private isCurrentGeneration(generation: number) {
    return generation === this.generation && generation === cacheGeneration
  }

  private warnPersistenceFailure(message: string, error: unknown) {
    console.warn(`[EMOS REEL] ${message}，继续使用内存缓存`, error)
  }
}

export async function getMediaCacheStats(): Promise<MediaCacheStats> {
  try {
    const [stats, persisted] = await Promise.all([opfsCacheClient.stats(), navigator.storage?.persisted?.().catch(() => false) ?? Promise.resolve(false)])
    return { ...stats, persisted }
  } catch (error) {
    console.warn('[EMOS REEL] 获取 OPFS 媒体缓存统计失败', error)
    return { bytes: 0, chunks: 0, limitBytes: 0, quotaBytes: 0, usageBytes: 0, persisted: false }
  }
}

export function requestPersistentMediaStorage() {
  if (!navigator.storage?.persist) return Promise.resolve(false)
  persistenceRequest ??= navigator.storage.persist().catch((error) => {
    console.warn('[EMOS REEL] 请求持久化媒体缓存失败', error)
    return false
  })
  return persistenceRequest
}

export async function clearMediaCache() {
  cacheGeneration += 1
  await opfsCacheClient.clear()
}
