import type { CachedMediaByteRange } from '@/libmedia/cache/mediaCacheTypes'

const HOT_PAGE_BYTES = 1024 * 1024
const HOT_CACHE_BYTES = 128 * 1024 * 1024
const HOT_PAGE_LIMIT = HOT_CACHE_BYTES / HOT_PAGE_BYTES

interface HotPage {
  data: Uint8Array
  ranges: CachedMediaByteRange[]
}

function mergeRange(ranges: CachedMediaByteRange[], next: CachedMediaByteRange) {
  const merged: CachedMediaByteRange[] = []
  for (const range of [...ranges, next].sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end) merged.push({ ...range })
    else previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

export class HotMediaCache {
  private readonly pages = new Map<number, HotPage>()

  put(start: number, bytes: Uint8Array) {
    let sourceOffset = 0
    while (sourceOffset < bytes.length) {
      const position = start + sourceOffset
      const pageIndex = Math.floor(position / HOT_PAGE_BYTES)
      const pageOffset = position - pageIndex * HOT_PAGE_BYTES
      const length = Math.min(bytes.length - sourceOffset, HOT_PAGE_BYTES - pageOffset)
      const page = this.getOrCreatePage(pageIndex)
      page.data.set(bytes.subarray(sourceOffset, sourceOffset + length), pageOffset)
      page.ranges = mergeRange(page.ranges, { start: pageOffset, end: pageOffset + length })
      sourceOffset += length
    }
  }

  get(position: number, maxLength: number) {
    if (!Number.isSafeInteger(position) || position < 0 || maxLength <= 0) return undefined
    const pageIndex = Math.floor(position / HOT_PAGE_BYTES)
    const page = this.touchPage(pageIndex)
    if (!page) return undefined
    const pageOffset = position - pageIndex * HOT_PAGE_BYTES
    const range = page.ranges.find((candidate) => candidate.start <= pageOffset && candidate.end > pageOffset)
    if (!range) return undefined
    return page.data.subarray(pageOffset, Math.min(range.end, pageOffset + maxLength))
  }

  getContiguousLength(position: number, maxLength: number) {
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(maxLength) || maxLength <= 0) return 0
    const limit = position + maxLength
    let cursor = position
    while (cursor < limit) {
      const pageIndex = Math.floor(cursor / HOT_PAGE_BYTES)
      const page = this.pages.get(pageIndex)
      if (!page) break
      const pageOffset = cursor - pageIndex * HOT_PAGE_BYTES
      const range = page.ranges.find((candidate) => candidate.start <= pageOffset && candidate.end > pageOffset)
      if (!range) break
      cursor = Math.min(limit, pageIndex * HOT_PAGE_BYTES + range.end)
      if (cursor % HOT_PAGE_BYTES !== 0) break
    }
    return cursor - position
  }

  getRanges() {
    const ranges: CachedMediaByteRange[] = []
    for (const [pageIndex, page] of this.pages) {
      const pageStart = pageIndex * HOT_PAGE_BYTES
      for (const range of page.ranges) ranges.push({ start: pageStart + range.start, end: pageStart + range.end })
    }
    const merged: CachedMediaByteRange[] = []
    for (const range of ranges.sort((left, right) => left.start - right.start)) {
      const previous = merged.at(-1)
      if (!previous || range.start > previous.end) merged.push({ ...range })
      else previous.end = Math.max(previous.end, range.end)
    }
    return merged
  }

  clear() {
    this.pages.clear()
  }

  private getOrCreatePage(pageIndex: number) {
    const existing = this.touchPage(pageIndex)
    if (existing) return existing
    const page: HotPage = { data: new Uint8Array(HOT_PAGE_BYTES), ranges: [] }
    this.pages.set(pageIndex, page)
    while (this.pages.size > HOT_PAGE_LIMIT) {
      const oldest = this.pages.keys().next().value
      if (oldest == null) break
      this.pages.delete(oldest)
    }
    return page
  }

  private touchPage(pageIndex: number) {
    const page = this.pages.get(pageIndex)
    if (!page) return undefined
    this.pages.delete(pageIndex)
    this.pages.set(pageIndex, page)
    return page
  }
}
