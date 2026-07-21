export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const gigabytes = bytes / 1024 / 1024 / 1024
  return gigabytes >= 1 ? `${gigabytes.toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`
}
