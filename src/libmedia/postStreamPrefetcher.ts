import type { OpfsMediaCache } from '@/libmedia/mediaCache'

export type PersistentReadAheadState = 'idle' | 'filling' | 'holding'

export interface PersistentReadAheadSnapshot {
  state: PersistentReadAheadState
  cachedAheadSeconds: number
  targetSeconds: number
  resumeSeconds: number
}

interface PostStreamPrefetcherOptions {
  cache: OpfsMediaCache
  targetSeconds: number
  resumeSeconds: number
  startAboveSeconds: number
  pauseBelowSeconds: number
  getMediaSize: () => number
  getMediaDuration: () => number
  getReadPosition: () => number
  readNetworkRange: (start: number, end: number, signal: AbortSignal, onProgress: (start: number, end: number) => Promise<void>) => Promise<void>
  onRangeMapped?: (startSeconds: number, endSeconds: number) => void
  onSnapshotChange?: (snapshot: PersistentReadAheadSnapshot) => void
}

const PREFETCH_PROGRESS_REPORT_BYTES = 1024 * 1024
const PREFETCH_FLUSH_BYTES = 8 * 1024 * 1024
const PREFETCH_RETRY_DELAY_MS = 5_000
const CACHE_PROBE_INTERVAL_MS = 1_000

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export class PostStreamPrefetcher {
  private abortController: AbortController | undefined
  private cachedEndPosition = 0
  private generation = 0
  private lastEmittedKey = ''
  private latestCurrentSeconds = 0
  private latestPlayableAheadSeconds = 0
  private lastCacheProbeAt = 0
  private probePromise: Promise<void> | undefined
  private retryAfter = 0
  private runPromise: Promise<void> | undefined
  private state: PersistentReadAheadState = 'idle'
  private stopped = false

  constructor(private readonly options: PostStreamPrefetcherOptions) {}

  update(currentSeconds: number, playableAheadSeconds: number) {
    if (this.stopped || !Number.isFinite(currentSeconds) || !Number.isFinite(playableAheadSeconds)) return
    this.latestCurrentSeconds = Math.max(0, currentSeconds)
    this.latestPlayableAheadSeconds = Math.max(0, playableAheadSeconds)

    this.scheduleCacheProbe()

    if (this.latestPlayableAheadSeconds < this.options.pauseBelowSeconds) {
      if (this.abortController) this.abortController.abort()
      this.state = 'idle'
      this.emitSnapshot()
      return
    }

    if (!this.getBytesPerSecond()) {
      this.state = 'idle'
      this.emitSnapshot()
      return
    }
    if (this.latestPlayableAheadSeconds < this.options.startAboveSeconds) {
      this.emitSnapshot()
      return
    }

    const cachedAhead = this.estimateCachedAheadSeconds()
    if (this.state === 'holding' && cachedAhead > this.options.resumeSeconds) {
      this.emitSnapshot()
      return
    }
    if (this.runPromise || Date.now() < this.retryAfter) {
      this.emitSnapshot()
      return
    }
    this.scheduleRefresh()
  }

  reset() {
    this.generation += 1
    this.abortController?.abort()
    this.abortController = undefined
    this.cachedEndPosition = 0
    this.latestCurrentSeconds = 0
    this.latestPlayableAheadSeconds = 0
    this.lastCacheProbeAt = 0
    this.retryAfter = 0
    this.state = 'idle'
    this.lastEmittedKey = ''
    this.emitSnapshot()
  }

  async stop() {
    this.stopped = true
    this.reset()
    await Promise.all([this.runPromise?.catch(() => undefined), this.probePromise?.catch(() => undefined)])
  }

  getSnapshot(): PersistentReadAheadSnapshot {
    return {
      state: this.state,
      cachedAheadSeconds: this.estimateCachedAheadSeconds(),
      targetSeconds: this.options.targetSeconds,
      resumeSeconds: this.options.resumeSeconds,
    }
  }

  private scheduleRefresh() {
    const generation = this.generation
    const operation = this.refresh(generation)
    const settled = operation.finally(() => {
      if (this.runPromise === settled) this.runPromise = undefined
      if (this.stopped || generation !== this.generation) return
      this.emitSnapshot()
      if (this.latestPlayableAheadSeconds >= this.options.startAboveSeconds && this.state !== 'holding' && Date.now() >= this.retryAfter) {
        this.scheduleRefresh()
      }
    })
    this.runPromise = settled
  }

  private scheduleCacheProbe() {
    if (this.probePromise || Date.now() - this.lastCacheProbeAt < CACHE_PROBE_INTERVAL_MS) return
    const bytesPerSecond = this.getBytesPerSecond()
    const mediaSize = this.options.getMediaSize()
    const readPosition = this.options.getReadPosition()
    if (!bytesPerSecond || mediaSize <= 0 || readPosition < 0 || readPosition >= mediaSize) return
    const maxLength = Math.min(mediaSize - readPosition, Math.max(1, Math.ceil(Math.max(0, this.options.targetSeconds - this.latestPlayableAheadSeconds) * bytesPerSecond)))
    const generation = this.generation
    this.lastCacheProbeAt = Date.now()
    const operation = this.options.cache.getContiguousLength(readPosition, maxLength).then((length) => {
      if (this.stopped || generation !== this.generation) return
      this.cachedEndPosition = Math.max(this.cachedEndPosition, readPosition + length)
      this.emitSnapshot(bytesPerSecond)
    })
    const settled = operation.finally(() => {
      if (this.probePromise === settled) this.probePromise = undefined
    })
    this.probePromise = settled
  }

  private async refresh(generation: number) {
    const bytesPerSecond = this.getBytesPerSecond()
    const mediaSize = this.options.getMediaSize()
    const basePosition = this.options.getReadPosition()
    const playableAhead = this.latestPlayableAheadSeconds
    if (!bytesPerSecond || mediaSize <= 0 || basePosition < 0 || basePosition >= mediaSize) {
      this.state = 'idle'
      this.emitSnapshot()
      return
    }

    const targetByteLength = Math.max(0, Math.ceil((this.options.targetSeconds - playableAhead) * bytesPerSecond))
    const targetPosition = Math.min(mediaSize, basePosition + targetByteLength)
    const contiguousLength = await this.options.cache.getContiguousLength(basePosition, Math.max(1, targetPosition - basePosition))
    if (this.stopped || generation !== this.generation) return

    this.cachedEndPosition = Math.max(this.cachedEndPosition, basePosition + contiguousLength)
    const cachedAhead = this.estimateCachedAheadSeconds(bytesPerSecond)
    if (cachedAhead >= this.options.targetSeconds - 0.5 || this.cachedEndPosition >= mediaSize) {
      this.state = 'holding'
      this.emitSnapshot()
      return
    }
    if (this.state === 'holding' && cachedAhead > this.options.resumeSeconds) {
      this.emitSnapshot()
      return
    }

    const requestStart = Math.max(basePosition, this.cachedEndPosition)
    if (requestStart >= targetPosition) {
      this.state = 'holding'
      this.emitSnapshot()
      return
    }

    this.state = 'filling'
    this.emitSnapshot()
    const baseTime = this.latestCurrentSeconds + playableAhead
    try {
      await this.fillRange(generation, requestStart, targetPosition, basePosition, baseTime, bytesPerSecond)
      if (this.stopped || generation !== this.generation) return
      this.state = this.estimateCachedAheadSeconds(bytesPerSecond) >= this.options.targetSeconds - 0.5 ? 'holding' : 'idle'
      this.retryAfter = 0
    } catch (error) {
      if (this.stopped || generation !== this.generation || isAbortError(error)) return
      this.state = 'idle'
      this.retryAfter = Date.now() + PREFETCH_RETRY_DELAY_MS
      console.warn('[EMOS REEL] 后台媒体预取失败，将稍后重试', error)
    }
  }

  private async fillRange(generation: number, requestStart: number, targetPosition: number, basePosition: number, baseTime: number, bytesPerSecond: number) {
    const abortController = new AbortController()
    this.abortController = abortController
    let cursor = requestStart
    let flushedAt = requestStart
    let reportedAt = requestStart
    try {
      await this.options.readNetworkRange(requestStart, targetPosition, abortController.signal, async (start, end) => {
        if (this.stopped || generation !== this.generation || end <= start || start !== cursor) return
        cursor = Math.min(targetPosition, end)
        this.cachedEndPosition = Math.max(this.cachedEndPosition, cursor)
        this.emitSnapshot(bytesPerSecond)
        if (cursor - reportedAt >= PREFETCH_PROGRESS_REPORT_BYTES) {
          this.reportMappedRange(reportedAt, cursor, basePosition, baseTime, bytesPerSecond)
          reportedAt = cursor
        }
        if (cursor - flushedAt < PREFETCH_FLUSH_BYTES) return
        await this.persistMappedRange(flushedAt, cursor, basePosition, baseTime, bytesPerSecond)
        flushedAt = cursor
      })
      if (cursor > reportedAt) this.reportMappedRange(reportedAt, cursor, basePosition, baseTime, bytesPerSecond)
      if (cursor > flushedAt) await this.persistMappedRange(flushedAt, cursor, basePosition, baseTime, bytesPerSecond)
      if (!abortController.signal.aborted && cursor < targetPosition) throw new Error(`当前媒体流提前结束于 byte ${cursor}`)
    } finally {
      if (this.abortController === abortController) this.abortController = undefined
      abortController.abort()
    }
  }

  private reportMappedRange(start: number, end: number, basePosition: number, baseTime: number, bytesPerSecond: number) {
    if (end <= start) return
    const startSeconds = baseTime + (start - basePosition) / bytesPerSecond
    const endSeconds = baseTime + (end - basePosition) / bytesPerSecond
    this.options.onRangeMapped?.(startSeconds, endSeconds)
  }

  private async persistMappedRange(start: number, end: number, basePosition: number, baseTime: number, bytesPerSecond: number) {
    if (end <= start) return
    await this.options.cache.flushMedia()
    const startSeconds = baseTime + (start - basePosition) / bytesPerSecond
    const endSeconds = baseTime + (end - basePosition) / bytesPerSecond
    this.options.cache.rememberTimeRange(startSeconds, endSeconds, [{ start, end }])
  }

  private getBytesPerSecond() {
    const size = this.options.getMediaSize()
    const duration = this.options.getMediaDuration()
    if (!Number.isSafeInteger(size) || size <= 0 || !Number.isFinite(duration) || duration <= 0) return undefined
    return size / duration
  }

  private estimateCachedAheadSeconds(bytesPerSecond = this.getBytesPerSecond()) {
    if (!bytesPerSecond) return this.latestPlayableAheadSeconds
    const readPosition = this.options.getReadPosition()
    const persistentAhead = Math.max(0, this.cachedEndPosition - readPosition) / bytesPerSecond
    return Math.max(0, this.latestPlayableAheadSeconds + persistentAhead)
  }

  private emitSnapshot(bytesPerSecond = this.getBytesPerSecond()) {
    const snapshot = {
      state: this.state,
      cachedAheadSeconds: this.estimateCachedAheadSeconds(bytesPerSecond),
      targetSeconds: this.options.targetSeconds,
      resumeSeconds: this.options.resumeSeconds,
    }
    const key = `${snapshot.state}:${Math.floor(snapshot.cachedAheadSeconds)}`
    if (key === this.lastEmittedKey) return
    this.lastEmittedKey = key
    this.options.onSnapshotChange?.(snapshot)
  }
}
