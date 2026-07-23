import {
  type CachedMediaByteRange,
  type CachedMediaTimeRange,
  type CacheWorkerRequest,
  type CacheWorkerResponse,
  DEFAULT_OPFS_CACHE_BYTES,
  type MediaCacheStats,
  type MediaCacheTimeline,
  type MediaSeekPoint,
  type MediaTimeByteAnchor,
  type MediaTimeMapping,
  MIN_OPFS_CACHE_BYTES,
  OPFS_CACHE_DIRECTORY,
  OPFS_CACHE_VERSION,
  OPFS_CHUNK_BYTES,
} from '@/libmedia/cache/mediaCacheTypes'

const MANIFEST_FILES = ['manifest-a.json', 'manifest-b.json'] as const
const TIMELINE_MERGE_GAP_SECONDS = 1
const TIME_BYTE_ANCHOR_GAP_SECONDS = 5
const MAX_TIME_BYTE_ANCHORS = 4_096
const MAX_MEDIA_SEEK_POINTS = 4_096
const SEEK_POINT_MERGE_GAP_SECONDS = 1
const MANIFEST_WRITE_DELAY_MS = 10_000
const CLEANUP_INTERVAL_MS = 60_000
const ACCESS_PERSIST_INTERVAL_MS = 60_000
const QUOTA_SHARE = 0.15
const MAX_POSTER_BYTES = 2 * 1024 * 1024

interface StoredChunk {
  index: number
  fileSize: number
  ranges: CachedMediaByteRange[]
  timeRanges: CachedMediaTimeRange[]
  lastAccessAt: number
}

interface StoredManifest extends MediaCacheTimeline {
  version: number
  generation: number
  sourceKey: string
  size: number
  expiresAt: number
  lastAccessAt: number
  chunks: StoredChunk[]
}

interface SourceState {
  chunksByIndex: Map<number, StoredChunk>
  directoryName: string
  directory: FileSystemDirectoryHandle
  manifest: StoredManifest
  dirty: boolean
}

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<CacheWorkerRequest>) => void): void
  postMessage(message: CacheWorkerResponse, transfer?: Transferable[]): void
}

const workerScope = self as unknown as WorkerScope
const encoder = new TextEncoder()
const sourceStates = new Map<string, SourceState>()
let rootPromise: Promise<FileSystemDirectoryHandle> | undefined
let initializationPromise: Promise<void> | undefined
let operationQueue = Promise.resolve()
let manifestWriteTimer: ReturnType<typeof setTimeout> | undefined
let lastCleanupAt = 0
let totalBytes = 0
let cacheLimitBytes = DEFAULT_OPFS_CACHE_BYTES
let storageQuotaBytes = 0
let storageUsageBytes = 0
let lastEviction: MediaCacheStats['lastEviction']

function createSourceState(directoryName: string, directory: FileSystemDirectoryHandle, manifest: StoredManifest): SourceState {
  return {
    chunksByIndex: new Map(manifest.chunks.map((chunk) => [chunk.index, chunk])),
    directoryName,
    directory,
    manifest,
    dirty: false,
  }
}

function isNotFoundError(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function isQuotaExceededError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

function normalizeByteRanges(ranges: CachedMediaByteRange[]) {
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

function mergeTimeRange(ranges: CachedMediaTimeRange[], next: CachedMediaTimeRange) {
  const merged: CachedMediaTimeRange[] = []
  for (const range of [...ranges, next].sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end + TIMELINE_MERGE_GAP_SECONDS) merged.push({ ...range })
    else previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

function subtractTimeRanges(ranges: CachedMediaTimeRange[], removedRanges: CachedMediaTimeRange[]) {
  let remaining = ranges.map((range) => ({ ...range }))
  for (const removed of removedRanges) {
    remaining = remaining.flatMap((range) => {
      if (removed.end <= range.start || removed.start >= range.end) return [range]
      const next: CachedMediaTimeRange[] = []
      if (removed.start > range.start) next.push({ start: range.start, end: Math.min(removed.start, range.end) })
      if (removed.end < range.end) next.push({ start: Math.max(removed.end, range.start), end: range.end })
      return next.filter((item) => item.end > item.start)
    })
  }
  return remaining
}

function mergeTimeByteAnchor(anchors: MediaTimeByteAnchor[], next: MediaTimeByteAnchor) {
  const merged = anchors.filter((anchor) => Math.abs(anchor.time - next.time) >= TIME_BYTE_ANCHOR_GAP_SECONDS)
  merged.push(next)
  merged.sort((left, right) => left.time - right.time)
  if (merged.length > MAX_TIME_BYTE_ANCHORS) merged.splice(0, merged.length - MAX_TIME_BYTE_ANCHORS)
  return merged
}

function mergeSeekPoint(points: MediaSeekPoint[], next: MediaSeekPoint) {
  const merged = points.filter((point) => Math.abs(point.time - next.time) >= SEEK_POINT_MERGE_GAP_SECONDS)
  merged.push(next)
  merged.sort((left, right) => left.time - right.time)
  if (merged.length > MAX_MEDIA_SEEK_POINTS) merged.splice(0, merged.length - MAX_MEDIA_SEEK_POINTS)
  return merged
}

function emptyManifest(sourceKey: string, ttlMs: number): StoredManifest {
  const now = Date.now()
  return {
    version: OPFS_CACHE_VERSION,
    generation: 0,
    sourceKey,
    size: 0,
    expiresAt: now + ttlMs,
    lastAccessAt: now,
    chunks: [],
    ranges: [],
    anchors: [],
    seekPoints: [],
  }
}

function normalizeManifest(value: unknown): StoredManifest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<StoredManifest>
  if (candidate.version !== OPFS_CACHE_VERSION || typeof candidate.sourceKey !== 'string' || !candidate.sourceKey) return undefined
  if (!Number.isSafeInteger(candidate.generation) || !Number.isFinite(candidate.expiresAt) || !Number.isFinite(candidate.lastAccessAt)) return undefined
  const chunks = Array.isArray(candidate.chunks)
    ? candidate.chunks.flatMap((chunk) => {
        if (!chunk || typeof chunk !== 'object') return []
        const item = chunk as Partial<StoredChunk>
        if (!Number.isSafeInteger(item.index) || (item.index ?? -1) < 0 || !Number.isSafeInteger(item.fileSize) || (item.fileSize ?? 0) <= 0) return []
        return [
          {
            index: item.index!,
            fileSize: Math.min(OPFS_CHUNK_BYTES, item.fileSize!),
            ranges: normalizeByteRanges(Array.isArray(item.ranges) ? item.ranges : []).filter((range) => range.end <= OPFS_CHUNK_BYTES),
            timeRanges: Array.isArray(item.timeRanges) ? item.timeRanges.filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start) : [],
            lastAccessAt: Number.isFinite(item.lastAccessAt) ? item.lastAccessAt! : candidate.lastAccessAt!,
          } satisfies StoredChunk,
        ]
      })
    : []
  return {
    version: OPFS_CACHE_VERSION,
    generation: candidate.generation!,
    sourceKey: candidate.sourceKey,
    size: Number.isSafeInteger(candidate.size) && (candidate.size ?? 0) > 0 ? candidate.size! : 0,
    expiresAt: candidate.expiresAt!,
    lastAccessAt: candidate.lastAccessAt!,
    chunks,
    ranges: Array.isArray(candidate.ranges) ? candidate.ranges.filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start) : [],
    anchors: Array.isArray(candidate.anchors) ? candidate.anchors.filter((anchor) => Number.isFinite(anchor?.time) && Number.isSafeInteger(anchor?.position) && anchor.position >= 0) : [],
    seekPoints: Array.isArray(candidate.seekPoints)
      ? candidate.seekPoints.filter(
          (point) => Number.isFinite(point?.time) && Number.isSafeInteger(point?.position) && point.position >= 0 && Number.isSafeInteger(point?.readPosition) && point.readPosition >= point.position,
        )
      : [],
  }
}

async function cacheRoot() {
  rootPromise ??= navigator.storage.getDirectory().then((storageRoot) => storageRoot.getDirectoryHandle(OPFS_CACHE_DIRECTORY, { create: true }))
  return rootPromise
}

function sourceDirectoryName(sourceKey: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(sourceKey)) throw new Error('无效的媒体编号')
  return sourceKey
}

async function readManifestFile(directory: FileSystemDirectoryHandle, name: string) {
  try {
    const handle = await directory.getFileHandle(name)
    return normalizeManifest(JSON.parse(await (await handle.getFile()).text()))
  } catch (error) {
    if (isNotFoundError(error) || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function readManifest(directory: FileSystemDirectoryHandle) {
  const manifests = await Promise.all(MANIFEST_FILES.map((name) => readManifestFile(directory, name)))
  return manifests.filter((manifest): manifest is StoredManifest => Boolean(manifest)).sort((left, right) => right.generation - left.generation)[0]
}

function writeAll(access: FileSystemSyncAccessHandle, bytes: Uint8Array, at: number) {
  let offset = 0
  while (offset < bytes.length) {
    const written = access.write(bytes.subarray(offset), { at: at + offset })
    if (written <= 0) throw new Error('OPFS 文件写入未取得进展')
    offset += written
  }
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, bytes: Uint8Array) {
  const file = await directory.getFileHandle(name, { create: true })
  const access = await file.createSyncAccessHandle()
  try {
    access.truncate(0)
    writeAll(access, bytes, 0)
    access.flush()
  } finally {
    access.close()
  }
}

async function saveManifest(state: SourceState) {
  if (!state.dirty) return
  state.manifest.chunks.sort((left, right) => left.index - right.index)
  state.manifest.generation += 1
  const fileName = MANIFEST_FILES[state.manifest.generation % MANIFEST_FILES.length]!
  await writeFile(state.directory, fileName, encoder.encode(JSON.stringify(state.manifest)))
  state.dirty = false
}

function queueManifestWrites() {
  if (manifestWriteTimer) return
  manifestWriteTimer = setTimeout(() => {
    manifestWriteTimer = undefined
    operationQueue = operationQueue.then(flushDirtyManifests, flushDirtyManifests)
  }, MANIFEST_WRITE_DELAY_MS)
}

function markDirty(state: SourceState) {
  state.dirty = true
  queueManifestWrites()
}

async function flushDirtyManifests() {
  for (const state of sourceStates.values()) {
    if (!state.dirty) continue
    try {
      await saveManifest(state)
    } catch (error) {
      console.warn('[EMOS REEL] 保存 OPFS 缓存索引失败', error)
    }
  }
}

async function removeSource(state: SourceState, reason?: 'expired') {
  sourceStates.delete(state.manifest.sourceKey)
  const removedBytes = state.manifest.chunks.reduce((sum, chunk) => sum + chunk.fileSize, 0)
  totalBytes = Math.max(0, totalBytes - removedBytes)
  if (reason && removedBytes > 0) lastEviction = { at: Date.now(), bytes: removedBytes, reason }
  const root = await cacheRoot()
  await root.removeEntry(state.directoryName, { recursive: true }).catch((error) => {
    if (!isNotFoundError(error)) throw error
  })
}

async function initialize() {
  const root = await cacheRoot()
  await refreshStorageEstimate()
  const expired: { name: string; state?: SourceState }[] = []
  for await (const entry of root.values()) {
    if (entry.kind !== 'directory') continue
    const directory = entry as FileSystemDirectoryHandle
    const manifest = await readManifest(directory)
    if (!manifest || manifest.expiresAt <= Date.now()) {
      expired.push({ name: entry.name })
      continue
    }
    if (manifest.sourceKey !== entry.name) continue
    const state = createSourceState(entry.name, directory, manifest)
    sourceStates.set(manifest.sourceKey, state)
    totalBytes += manifest.chunks.reduce((sum, chunk) => sum + chunk.fileSize, 0)
  }
  for (const item of expired) await root.removeEntry(item.name, { recursive: true }).catch(() => undefined)
}

async function refreshStorageEstimate() {
  const estimate = await navigator.storage.estimate().catch(() => undefined)
  storageQuotaBytes = Number.isFinite(estimate?.quota) ? Math.max(0, estimate!.quota!) : 0
  storageUsageBytes = Number.isFinite(estimate?.usage) ? Math.max(0, estimate!.usage!) : 0
  if (storageQuotaBytes > 0) {
    cacheLimitBytes = Math.min(DEFAULT_OPFS_CACHE_BYTES, Math.max(MIN_OPFS_CACHE_BYTES, Math.floor(storageQuotaBytes * QUOTA_SHARE)))
  }
}

async function ensureInitialized() {
  initializationPromise ??= initialize().catch((error) => {
    initializationPromise = undefined
    throw error
  })
  await initializationPromise
}

async function getSource(sourceKey: string, create: boolean, ttlMs = 0) {
  await ensureInitialized()
  let state = sourceStates.get(sourceKey)
  if (state?.manifest.expiresAt && state.manifest.expiresAt <= Date.now()) {
    await removeSource(state, 'expired')
    state = undefined
  }
  if (state || !create) return state
  const directoryName = sourceDirectoryName(sourceKey)
  const directory = await (await cacheRoot()).getDirectoryHandle(directoryName, { create: true })
  state = createSourceState(directoryName, directory, emptyManifest(sourceKey, ttlMs))
  sourceStates.set(sourceKey, state)
  markDirty(state)
  return state
}

function touchSource(state: SourceState, ttlMs?: number) {
  const now = Date.now()
  const shouldPersist = Boolean(ttlMs) || now - state.manifest.lastAccessAt >= ACCESS_PERSIST_INTERVAL_MS
  state.manifest.lastAccessAt = now
  if (ttlMs) state.manifest.expiresAt = now + ttlMs
  if (shouldPersist) markDirty(state)
}

async function removeChunk(state: SourceState, chunk: StoredChunk, reason?: 'capacity' | 'quota') {
  await state.directory.removeEntry(`${chunk.index}.bin`).catch((error) => {
    if (!isNotFoundError(error)) throw error
  })
  state.manifest.chunks = state.manifest.chunks.filter((candidate) => candidate !== chunk)
  state.chunksByIndex.delete(chunk.index)
  state.manifest.ranges = subtractTimeRanges(state.manifest.ranges, chunk.timeRanges)
  const chunkStart = chunk.index * OPFS_CHUNK_BYTES
  const chunkEnd = chunkStart + OPFS_CHUNK_BYTES
  state.manifest.anchors = state.manifest.anchors.filter((anchor) => anchor.position < chunkStart || anchor.position >= chunkEnd)
  totalBytes = Math.max(0, totalBytes - chunk.fileSize)
  if (reason && chunk.fileSize > 0) lastEviction = { at: Date.now(), bytes: chunk.fileSize, reason }
  markDirty(state)
}

async function cleanupExpiredSources() {
  const now = Date.now()
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now
  for (const state of [...sourceStates.values()]) {
    if (state.manifest.expiresAt <= now) await removeSource(state, 'expired')
  }
}

async function evictBytes(requiredBytes: number, protectedSourceKey?: string, protectedChunkIndex?: number, reason: 'capacity' | 'quota' = 'capacity') {
  let released = 0
  const candidates = [...sourceStates.values()]
    .flatMap((state) => state.manifest.chunks.map((chunk) => ({ state, chunk })))
    .filter(({ state, chunk }) => state.manifest.sourceKey !== protectedSourceKey || chunk.index !== protectedChunkIndex)
    .sort((left, right) => {
      const leftProtectedSource = left.state.manifest.sourceKey === protectedSourceKey ? 1 : 0
      const rightProtectedSource = right.state.manifest.sourceKey === protectedSourceKey ? 1 : 0
      return leftProtectedSource - rightProtectedSource || left.chunk.lastAccessAt - right.chunk.lastAccessAt
    })
  for (const candidate of candidates) {
    if (released >= requiredBytes) break
    const bytes = candidate.chunk.fileSize
    await removeChunk(candidate.state, candidate.chunk)
    released += bytes
  }
  if (released > 0) lastEviction = { at: Date.now(), bytes: released, reason }
  return released
}

async function ensureRoom(additionalBytes: number, protectedSourceKey: string, protectedChunkIndex: number) {
  await cleanupExpiredSources()
  const overflow = totalBytes + additionalBytes - cacheLimitBytes
  if (overflow > 0) await evictBytes(overflow, protectedSourceKey, protectedChunkIndex)
}

function findChunk(state: SourceState, index: number) {
  return state.chunksByIndex.get(index)
}

async function writeChunkBytes(state: SourceState, chunk: StoredChunk, relativeStart: number, bytes: Uint8Array) {
  const nextFileSize = Math.max(chunk.fileSize, relativeStart + bytes.length)
  const growth = nextFileSize - chunk.fileSize
  await ensureRoom(growth, state.manifest.sourceKey, chunk.index)
  const file = await state.directory.getFileHandle(`${chunk.index}.bin`, { create: true })
  for (let attempt = 0; ; attempt += 1) {
    const access = await file.createSyncAccessHandle()
    try {
      writeAll(access, bytes, relativeStart)
      access.flush()
      break
    } catch (error) {
      if (!isQuotaExceededError(error) || attempt >= 2) throw error
      const released = await evictBytes(Math.max(growth, 64 * 1024 * 1024), state.manifest.sourceKey, chunk.index, 'quota')
      if (released <= 0) throw error
    } finally {
      access.close()
    }
  }
  chunk.fileSize = nextFileSize
  chunk.ranges = normalizeByteRanges([...chunk.ranges, { start: relativeStart, end: relativeStart + bytes.length }])
  chunk.lastAccessAt = Date.now()
  totalBytes += growth
  touchSource(state)
}

async function writeMedia(sourceKey: string, start: number, data: ArrayBuffer, ttlMs: number) {
  const state = await getSource(sourceKey, true, ttlMs)
  if (!state) return
  const bytes = new Uint8Array(data)
  let sourceOffset = 0
  while (sourceOffset < bytes.length) {
    const position = start + sourceOffset
    const index = Math.floor(position / OPFS_CHUNK_BYTES)
    const relativeStart = position - index * OPFS_CHUNK_BYTES
    const length = Math.min(bytes.length - sourceOffset, OPFS_CHUNK_BYTES - relativeStart)
    let chunk = findChunk(state, index)
    if (!chunk) {
      chunk = { index, fileSize: 0, ranges: [], timeRanges: [], lastAccessAt: Date.now() }
      state.manifest.chunks.push(chunk)
      state.chunksByIndex.set(index, chunk)
    }
    await writeChunkBytes(state, chunk, relativeStart, bytes.subarray(sourceOffset, sourceOffset + length))
    sourceOffset += length
  }
  touchSource(state, ttlMs)
}

async function readMedia(sourceKey: string, position: number, maxLength: number) {
  const state = await getSource(sourceKey, false)
  if (!state) return undefined
  const index = Math.floor(position / OPFS_CHUNK_BYTES)
  const chunk = findChunk(state, index)
  if (!chunk) return undefined
  const relativeStart = position - index * OPFS_CHUNK_BYTES
  const range = chunk.ranges.find((candidate) => candidate.start <= relativeStart && candidate.end > relativeStart)
  if (!range) return undefined
  const length = Math.min(maxLength, range.end - relativeStart)
  try {
    const file = await state.directory.getFileHandle(`${index}.bin`)
    const access = await file.createSyncAccessHandle()
    try {
      const bytes = new Uint8Array(length)
      const readLength = access.read(bytes, { at: relativeStart })
      if (readLength <= 0) return undefined
      chunk.lastAccessAt = Date.now()
      touchSource(state)
      return readLength === bytes.length ? bytes.buffer : bytes.slice(0, readLength).buffer
    } finally {
      access.close()
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    await removeChunk(state, chunk)
    return undefined
  }
}

function contiguousLength(state: SourceState, position: number, maxLength: number) {
  const limit = position + maxLength
  let cursor = position
  while (cursor < limit) {
    const index = Math.floor(cursor / OPFS_CHUNK_BYTES)
    const chunk = findChunk(state, index)
    if (!chunk) break
    const relativeStart = cursor - index * OPFS_CHUNK_BYTES
    const range = chunk.ranges.find((candidate) => candidate.start <= relativeStart && candidate.end > relativeStart)
    if (!range) break
    cursor = Math.min(limit, index * OPFS_CHUNK_BYTES + range.end)
    if (cursor % OPFS_CHUNK_BYTES !== 0) break
  }
  return cursor - position
}

function cachedByteRanges(state: SourceState) {
  return normalizeByteRanges(
    state.manifest.chunks.flatMap((chunk) => {
      const chunkStart = chunk.index * OPFS_CHUNK_BYTES
      return chunk.ranges.map((range) => ({ start: chunkStart + range.start, end: chunkStart + range.end }))
    }),
  )
}

function isByteRangeCovered(state: SourceState, range: CachedMediaByteRange) {
  return contiguousLength(state, range.start, range.end - range.start) >= range.end - range.start
}

function chunksForByteRange(state: SourceState, range: CachedMediaByteRange) {
  const first = Math.floor(range.start / OPFS_CHUNK_BYTES)
  const last = Math.floor((range.end - 1) / OPFS_CHUNK_BYTES)
  const chunks: StoredChunk[] = []
  for (let index = first; index <= last; index += 1) {
    const chunk = findChunk(state, index)
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

function rememberTimeMappings(state: SourceState, mappings: MediaTimeMapping[], ttlMs: number) {
  for (const mapping of mappings) {
    const byteRanges = normalizeByteRanges(mapping.byteRanges)
    const timeRange = {
      start: Math.max(0, mapping.timeRange.start),
      end: Math.max(0, mapping.timeRange.end),
    }
    if (!byteRanges.length || !Number.isFinite(timeRange.start) || !Number.isFinite(timeRange.end) || timeRange.end <= timeRange.start) continue
    if (!byteRanges.every((range) => isByteRangeCovered(state, range))) continue
    state.manifest.ranges = mergeTimeRange(state.manifest.ranges, timeRange)
    if (byteRanges.length === 1) {
      state.manifest.anchors = mergeTimeByteAnchor(state.manifest.anchors, { time: timeRange.start, position: byteRanges[0]!.start })
      state.manifest.anchors = mergeTimeByteAnchor(state.manifest.anchors, { time: timeRange.end, position: byteRanges[0]!.end })
    }
    for (const range of byteRanges) {
      for (const chunk of chunksForByteRange(state, range)) chunk.timeRanges = mergeTimeRange(chunk.timeRanges, timeRange)
    }
  }
  touchSource(state, ttlMs)
}

function posterFileName(key: string) {
  if (!/^\d+$/.test(key)) throw new Error('无效的首帧缓存编号')
  return `poster-${key}.webp`
}

async function readPoster(sourceKey: string, key: string) {
  const state = await getSource(sourceKey, false)
  if (!state) return undefined
  try {
    const file = await (await state.directory.getFileHandle(posterFileName(key))).getFile()
    touchSource(state)
    return await file.arrayBuffer()
  } catch (error) {
    if (isNotFoundError(error)) return undefined
    throw error
  }
}

async function writePoster(sourceKey: string, key: string, data: ArrayBuffer, ttlMs: number) {
  if (data.byteLength <= 0 || data.byteLength > MAX_POSTER_BYTES) return
  const state = await getSource(sourceKey, true, ttlMs)
  if (!state) return
  await writeFile(state.directory, posterFileName(key), new Uint8Array(data))
  touchSource(state, ttlMs)
}

async function handleRequest(request: CacheWorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'read':
      return readMedia(request.sourceKey, request.position, request.maxLength)
    case 'contiguous': {
      const state = await getSource(request.sourceKey, false)
      return state ? contiguousLength(state, request.position, request.maxLength) : 0
    }
    case 'write':
      return writeMedia(request.sourceKey, request.start, request.data, request.ttlMs)
    case 'get-size':
      return (await getSource(request.sourceKey, false))?.manifest.size || undefined
    case 'set-size': {
      const state = await getSource(request.sourceKey, true, request.ttlMs)
      if (state) {
        state.manifest.size = request.size
        touchSource(state, request.ttlMs)
      }
      return
    }
    case 'get-timeline': {
      const state = await getSource(request.sourceKey, false)
      return state
        ? {
            ranges: state.manifest.ranges.map((range) => ({ ...range })),
            anchors: state.manifest.anchors.map((anchor) => ({ ...anchor })),
            seekPoints: state.manifest.seekPoints.map((point) => ({ ...point })),
            byteRanges: cachedByteRanges(state),
          }
        : { ranges: [], anchors: [], seekPoints: [], byteRanges: [] }
    }
    case 'remember-time': {
      const state = await getSource(request.sourceKey, true, request.ttlMs)
      if (state) rememberTimeMappings(state, request.mappings, request.ttlMs)
      return
    }
    case 'remember-anchor': {
      const state = await getSource(request.sourceKey, true, request.ttlMs)
      if (state) {
        state.manifest.anchors = mergeTimeByteAnchor(state.manifest.anchors, { time: request.time, position: request.position })
        touchSource(state, request.ttlMs)
      }
      return
    }
    case 'remember-seek': {
      const state = await getSource(request.sourceKey, true, request.ttlMs)
      if (state) {
        state.manifest.seekPoints = mergeSeekPoint(state.manifest.seekPoints, request.point)
        touchSource(state, request.ttlMs)
      }
      return
    }
    case 'read-poster':
      return readPoster(request.sourceKey, request.key)
    case 'write-poster':
      return writePoster(request.sourceKey, request.key, request.data, request.ttlMs)
    case 'touch': {
      const state = await getSource(request.sourceKey, false)
      if (state) touchSource(state, request.ttlMs)
      return
    }
    case 'flush': {
      const state = await getSource(request.sourceKey, false)
      if (state) await saveManifest(state)
      return
    }
    case 'stats':
      await ensureInitialized()
      await cleanupExpiredSources()
      await refreshStorageEstimate()
      return {
        bytes: totalBytes,
        chunks: [...sourceStates.values()].reduce((sum, state) => sum + state.manifest.chunks.length, 0),
        limitBytes: cacheLimitBytes,
        quotaBytes: storageQuotaBytes,
        usageBytes: storageUsageBytes,
        lastEviction,
      }
    case 'clear': {
      if (manifestWriteTimer) clearTimeout(manifestWriteTimer)
      manifestWriteTimer = undefined
      const storageRoot = await navigator.storage.getDirectory()
      await storageRoot.removeEntry(OPFS_CACHE_DIRECTORY, { recursive: true }).catch((error) => {
        if (!isNotFoundError(error)) throw error
      })
      sourceStates.clear()
      totalBytes = 0
      lastEviction = undefined
      rootPromise = undefined
      initializationPromise = undefined
      return
    }
  }
}

workerScope.addEventListener('message', (event) => {
  const request = event.data
  operationQueue = operationQueue.then(async () => {
    try {
      const value = await handleRequest(request)
      const response: CacheWorkerResponse = { id: request.id, ok: true, value }
      if (value instanceof ArrayBuffer) workerScope.postMessage(response, [value])
      else workerScope.postMessage(response)
    } catch (error) {
      workerScope.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})
