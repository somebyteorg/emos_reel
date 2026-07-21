import type { ManifestSprite } from '@/api/types'

export interface SpritePreviewFrame {
  sprite: ManifestSprite
  url: string
  fileIndex: number
  frameIndex: number
  column: number
  row: number
}

export function pickPreviewSprite(sprites: readonly ManifestSprite[]) {
  if (!sprites.length) return undefined
  return sprites.find((sprite) => sprite.width === 640 && sprite.height === 360) ?? sprites.find((sprite) => sprite.width === 640) ?? sprites.find((sprite) => sprite.height === 360) ?? sprites[0]
}

export function getValidSpriteFrameCount(sprite: ManifestSprite) {
  if (sprite.columns <= 0 || sprite.rows <= 0 || !sprite.files.length) return 0
  const fileCapacity = sprite.files.length * sprite.columns * sprite.rows
  const declaredCount = Number.isFinite(sprite.count_frame) ? Math.max(0, Math.floor(sprite.count_frame)) : sprite.frame_times.length
  return Math.min(declaredCount, sprite.frame_times.length, fileCapacity)
}

function findFrameAtOrBefore(frameTimes: readonly number[], seconds: number, frameCount: number) {
  if (frameCount <= 0) return -1
  if (seconds < frameTimes[0]) return 0

  let result = 0
  let low = 0
  let high = frameCount - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (frameTimes[middle] <= seconds) {
      result = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

export function getSpritePreviewFrame(sprite: ManifestSprite | undefined, seconds: number): SpritePreviewFrame | undefined {
  if (!sprite) return undefined
  const frameCount = getValidSpriteFrameCount(sprite)
  const frameIndex = findFrameAtOrBefore(sprite.frame_times, seconds, frameCount)
  if (frameIndex < 0) return undefined

  const framesPerFile = sprite.columns * sprite.rows
  const fileIndex = Math.floor(frameIndex / framesPerFile)
  const indexInFile = frameIndex % framesPerFile
  const file = sprite.files[fileIndex]
  if (!file) return undefined

  return {
    sprite,
    url: `${sprite.base_url}/${file}`,
    fileIndex,
    frameIndex,
    column: indexInFile % sprite.columns,
    row: Math.floor(indexInFile / sprite.columns),
  }
}
