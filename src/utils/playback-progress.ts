export function calculateWatchPercent(playSeconds: number | null | undefined, durationSeconds: number | null | undefined, isComplete: boolean) {
  if (isComplete) return 100
  const played = Math.max(0, playSeconds ?? 0)
  const duration = Math.max(0, durationSeconds ?? 0)
  if (played <= 0 || duration <= 0) return 0
  return Math.min(99, Math.max(1, Math.round((played / duration) * 100)))
}
