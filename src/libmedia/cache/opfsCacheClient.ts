import type { CacheWorkerRequest, CacheWorkerResponse, MediaCacheSnapshot, MediaCacheStats, MediaSeekPoint, MediaTimeMapping } from '@/libmedia/cache/mediaCacheTypes'

type RequestPayload = CacheWorkerRequest extends infer Request ? (Request extends CacheWorkerRequest ? Omit<Request, 'id'> : never) : never

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let workerUnavailable = false
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

function cacheWorker() {
  if (workerUnavailable) return undefined
  if (worker) return worker
  if (typeof Worker === 'undefined' || !navigator.storage?.getDirectory) {
    workerUnavailable = true
    return undefined
  }
  try {
    worker = new Worker(new URL('./opfsMediaCache.worker.ts', import.meta.url), {
      type: 'module',
      name: 'emos-reel-media-cache',
    })
    worker.addEventListener('message', (event: MessageEvent<CacheWorkerResponse>) => {
      const response = event.data
      const pending = pendingRequests.get(response.id)
      if (!pending) return
      pendingRequests.delete(response.id)
      if (response.ok) pending.resolve(response.value)
      else pending.reject(new Error(response.error || 'OPFS 媒体缓存操作失败'))
    })
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'OPFS 媒体缓存 Worker 异常')
      for (const pending of pendingRequests.values()) pending.reject(error)
      pendingRequests.clear()
      worker?.terminate()
      worker = undefined
      workerUnavailable = true
    })
    return worker
  } catch (error) {
    console.warn('[EMOS REEL] 无法启动 OPFS 媒体缓存 Worker，将只使用内存缓存', error)
    workerUnavailable = true
    return undefined
  }
}

function request<T>(payload: RequestPayload, transfer: Transferable[] = []) {
  const activeWorker = cacheWorker()
  if (!activeWorker) return Promise.reject(new Error('当前浏览器不支持 OPFS 媒体缓存'))
  const id = nextRequestId++
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: (value) => resolve(value as T), reject })
    activeWorker.postMessage({ ...payload, id } satisfies CacheWorkerRequest, transfer)
  })
}

export const opfsCacheClient = {
  read(sourceKey: string, position: number, maxLength: number) {
    return request<ArrayBuffer | undefined>({ type: 'read', sourceKey, position, maxLength })
  },
  getContiguousLength(sourceKey: string, position: number, maxLength: number) {
    return request<number>({ type: 'contiguous', sourceKey, position, maxLength })
  },
  write(sourceKey: string, start: number, data: ArrayBuffer, ttlMs: number) {
    return request<void>({ type: 'write', sourceKey, start, data, ttlMs }, [data])
  },
  getSize(sourceKey: string) {
    return request<number | undefined>({ type: 'get-size', sourceKey })
  },
  setSize(sourceKey: string, size: number, ttlMs: number) {
    return request<void>({ type: 'set-size', sourceKey, size, ttlMs })
  },
  getTimeline(sourceKey: string) {
    return request<MediaCacheSnapshot>({ type: 'get-timeline', sourceKey })
  },
  rememberTime(sourceKey: string, mappings: MediaTimeMapping[], ttlMs: number) {
    return request<void>({ type: 'remember-time', sourceKey, mappings, ttlMs })
  },
  rememberAnchor(sourceKey: string, time: number, position: number, ttlMs: number) {
    return request<void>({ type: 'remember-anchor', sourceKey, time, position, ttlMs })
  },
  rememberSeekPoint(sourceKey: string, point: MediaSeekPoint, ttlMs: number) {
    return request<void>({ type: 'remember-seek', sourceKey, point, ttlMs })
  },
  readPoster(sourceKey: string, key: string) {
    return request<ArrayBuffer | undefined>({ type: 'read-poster', sourceKey, key })
  },
  writePoster(sourceKey: string, key: string, data: ArrayBuffer, ttlMs: number) {
    return request<void>({ type: 'write-poster', sourceKey, key, data, ttlMs }, [data])
  },
  touch(sourceKey: string, ttlMs: number) {
    return request<void>({ type: 'touch', sourceKey, ttlMs })
  },
  flush(sourceKey: string) {
    return request<void>({ type: 'flush', sourceKey })
  },
  stats() {
    return request<MediaCacheStats>({ type: 'stats' })
  },
  clear() {
    return request<void>({ type: 'clear' })
  },
}
