export const OPFS_CACHE_DIRECTORY = 'emos_reel-media-cache-v1'
export const OPFS_CACHE_VERSION = 1
export const OPFS_CHUNK_BYTES = 8 * 1024 * 1024
export const DEFAULT_OPFS_CACHE_BYTES = 30 * 1024 * 1024 * 1024
export const MIN_OPFS_CACHE_BYTES = 256 * 1024 * 1024
export const DEFAULT_MEDIA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface CachedMediaTimeRange {
  start: number
  end: number
}

export interface CachedMediaByteRange {
  start: number
  end: number
}

export interface MediaTimeByteAnchor {
  time: number
  position: number
}

export interface MediaSeekPoint {
  time: number
  position: number
  readPosition: number
}

export interface MediaCacheTimeline {
  ranges: CachedMediaTimeRange[]
  anchors: MediaTimeByteAnchor[]
  seekPoints: MediaSeekPoint[]
}

export interface MediaCacheSnapshot extends MediaCacheTimeline {
  byteRanges: CachedMediaByteRange[]
}

export interface MediaCacheStats {
  bytes: number
  chunks: number
  limitBytes: number
  quotaBytes: number
  usageBytes: number
  persisted?: boolean
  lastEviction?: {
    at: number
    bytes: number
    reason: 'capacity' | 'quota' | 'expired'
  }
}

export interface MediaTimeMapping {
  timeRange: CachedMediaTimeRange
  byteRanges: CachedMediaByteRange[]
}

export type CacheWorkerRequest =
  | { id: number; type: 'read'; sourceKey: string; position: number; maxLength: number }
  | { id: number; type: 'contiguous'; sourceKey: string; position: number; maxLength: number }
  | { id: number; type: 'write'; sourceKey: string; start: number; data: ArrayBuffer; ttlMs: number }
  | { id: number; type: 'get-size'; sourceKey: string }
  | { id: number; type: 'set-size'; sourceKey: string; size: number; ttlMs: number }
  | { id: number; type: 'get-timeline'; sourceKey: string }
  | { id: number; type: 'remember-time'; sourceKey: string; mappings: MediaTimeMapping[]; ttlMs: number }
  | { id: number; type: 'remember-anchor'; sourceKey: string; time: number; position: number; ttlMs: number }
  | { id: number; type: 'remember-seek'; sourceKey: string; point: MediaSeekPoint; ttlMs: number }
  | { id: number; type: 'read-poster'; sourceKey: string; key: string }
  | { id: number; type: 'write-poster'; sourceKey: string; key: string; data: ArrayBuffer; ttlMs: number }
  | { id: number; type: 'touch'; sourceKey: string; ttlMs: number }
  | { id: number; type: 'flush'; sourceKey: string }
  | { id: number; type: 'stats' }
  | { id: number; type: 'clear' }

export interface CacheWorkerResponse {
  id: number
  ok: boolean
  value?: unknown
  error?: string
}
