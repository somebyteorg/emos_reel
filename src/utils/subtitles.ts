const TEXT_SUBTITLE_TYPES = new Set(['ass', 'ssa', 'srt', 'subrip', 'vtt', 'webvtt', 'text'])
const TEXT_SUBTITLE_EXTENSIONS = new Set(['ass', 'ssa', 'srt', 'vtt', 'webvtt'])

function normalizeSubtitleType(type?: string) {
  return type?.trim().toLowerCase() ?? ''
}

function subtitleExtension(url: string) {
  try {
    const pathname = new URL(url, window.location.href).pathname
    return pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase()
  } catch {
    const pathname = url.split(/[?#]/, 1)[0] ?? ''
    return pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase()
  }
}

export function isTextSubtitleSource(url: string, type?: string) {
  const normalizedType = normalizeSubtitleType(type)
  if (TEXT_SUBTITLE_TYPES.has(normalizedType)) return true
  if (normalizedType === 'text/vtt' || normalizedType === 'text/srt') return true
  return TEXT_SUBTITLE_EXTENSIONS.has(subtitleExtension(url))
}

export function shakaSubtitleMimeType(type: string) {
  switch (normalizeSubtitleType(type)) {
    case 'srt':
    case 'subrip':
      return 'text/srt'
    case 'vtt':
    case 'webvtt':
      return 'text/vtt'
    case 'ass':
    case 'ssa':
      return 'text/x-ssa'
    default:
      return type
  }
}
