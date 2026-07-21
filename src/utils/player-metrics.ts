import type shaka from 'shaka-player'

export interface TransferSample {
  bytes: number
  startedAt: number
  endedAt: number
}

export function formatBitrate(bitsPerSecond: number) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '--'
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
  return `${Math.round(bitsPerSecond / 1000)} Kbps`
}

export function formatTransferSpeed(bitsPerSecond: number) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '--'
  return `${(bitsPerSecond / 8 / 1_000_000).toFixed(2)} MB/s`
}

export function calculateTransferSpeed(samples: TransferSample[], now: number) {
  const recentSamples = samples.filter((sample) => sample.endedAt >= now - 12_000)
  samples.splice(0, samples.length, ...recentSamples)
  if (!recentSamples.length) return 0

  const intervals = recentSamples.map((sample) => [sample.startedAt, sample.endedAt] as const).sort((a, b) => a[0] - b[0])
  let activeMilliseconds = 0
  let intervalStart = intervals[0][0]
  let intervalEnd = intervals[0][1]
  for (const [start, end] of intervals.slice(1)) {
    if (start <= intervalEnd) {
      intervalEnd = Math.max(intervalEnd, end)
    } else {
      activeMilliseconds += intervalEnd - intervalStart
      intervalStart = start
      intervalEnd = end
    }
  }
  activeMilliseconds += intervalEnd - intervalStart
  if (activeMilliseconds <= 0) return 0
  const totalBytes = recentSamples.reduce((total, sample) => total + sample.bytes, 0)
  return (totalBytes * 8) / (activeMilliseconds / 1000)
}

export function audioTrackId(track: shaka.extern.AudioTrack) {
  return [track.language, track.label, track.channelsCount, ...track.roles].join('|')
}

export function audioTrackLabel(track: shaka.extern.AudioTrack) {
  const name = track.label || track.originalLanguage || track.language || '默认音轨'
  if (!track.channelsCount || track.channelsCount <= 2) return name
  const channels = track.channelsCount === 6 ? '5.1' : `${track.channelsCount} 声道`
  return `${name} · ${channels}`
}
