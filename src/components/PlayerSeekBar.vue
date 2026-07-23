<script lang="ts" setup>
  import dayjs from 'dayjs'
  import durationPlugin from 'dayjs/plugin/duration'
  import { ImageOff, LoaderCircle } from '@lucide/vue'
  import { useMediaQuery, useThrottleFn } from '@vueuse/core'
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import type { ManifestSprite } from '@/api/types'
  import type { PlayerBufferedRange } from '@/types/player'
  import { getSpritePreviewFrame, pickPreviewSprite } from '@/utils/sprite-preview'

  dayjs.extend(durationPlugin)

  const MIN_DISPLAYED_BUFFER_SECONDS = 10

  const props = defineProps<{
    currentTime: number
    duration: number
    bufferedRanges: PlayerBufferedRange[]
    sprites: ManifestSprite[]
    previewDisabled: boolean
  }>()

  const emit = defineEmits<{
    interact: []
    previewActive: [active: boolean]
    seek: [seconds: number]
  }>()

  const seekElement = ref<HTMLElement>()
  const spriteCanvas = ref<HTMLCanvasElement>()
  const hoverPreview = ref(false)
  const hoverTime = ref(0)
  const seekDraft = ref<number>()
  const previewLeft = ref(0)
  const previewWidth = ref(640)
  const previewStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const isMobile = useMediaQuery('(max-width: 720px)')
  const spriteImageCache = new Map<string, Promise<HTMLImageElement>>()
  let pointerInside = false
  let spriteRenderSequence = 0

  const displayedTime = computed(() => seekDraft.value ?? props.currentTime)
  const progress = computed(() => (props.duration > 0 ? (displayedTime.value / props.duration) * 100 : 0))
  const availableRanges = computed(() => {
    const ranges = props.bufferedRanges
      .map((range) => ({ start: Math.min(100, Math.max(0, range.start)), end: Math.min(100, Math.max(0, range.end)) }))
      .filter((range) => range.end > range.start)
      .sort((left, right) => left.start - right.start)
    const merged: Array<{ start: number; end: number }> = []
    for (const range of ranges) {
      const previous = merged.at(-1)
      if (!previous || range.start > previous.end + 0.05) merged.push({ ...range })
      else previous.end = Math.max(previous.end, range.end)
    }
    if (!Number.isFinite(props.duration) || props.duration <= 0) return []
    return merged.filter((range) => ((range.end - range.start) / 100) * props.duration >= MIN_DISPLAYED_BUFFER_SECONDS)
  })
  const hoverTimeLabel = computed(() => dayjs.duration(Math.max(0, hoverTime.value), 'seconds').format(hoverTime.value >= 3600 ? 'HH:mm:ss' : 'mm:ss'))
  const activeSprite = computed(() => pickPreviewSprite(props.sprites))
  const previewFrame = computed(() => getSpritePreviewFrame(activeSprite.value, hoverTime.value))
  const previewFrameKey = computed(() => {
    const frame = previewFrame.value
    return frame ? `${frame.url}:${frame.frameIndex}` : ''
  })
  const previewDimensions = computed(() => {
    const frame = previewFrame.value
    const width = previewWidth.value
    const aspectRatio = frame?.sprite.width && frame.sprite.height ? frame.sprite.height / frame.sprite.width : 9 / 16
    return { width, height: Math.round(width * aspectRatio) }
  })
  const previewStyle = computed(() => ({
    left: `${previewLeft.value}px`,
    width: `${previewDimensions.value.width}px`,
    height: `${previewDimensions.value.height}px`,
  }))

  function loadSpriteImage(url: string, priority: 'high' | 'low' = 'high') {
    const cached = spriteImageCache.get(url)
    if (cached) {
      spriteImageCache.delete(url)
      spriteImageCache.set(url, cached)
      return cached
    }

    let imagePromise: Promise<HTMLImageElement>
    imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.decoding = 'async'
      image.fetchPriority = priority
      image.onload = () => {
        void image
          .decode()
          .catch(() => undefined)
          .then(() => resolve(image))
      }
      image.onerror = () => reject(new Error(`无法加载雪碧图：${url}`))
      image.src = url
    }).catch((error) => {
      if (spriteImageCache.get(url) === imagePromise) spriteImageCache.delete(url)
      throw error
    })

    spriteImageCache.set(url, imagePromise)
    while (spriteImageCache.size > 3) {
      const oldestUrl = spriteImageCache.keys().next().value
      if (!oldestUrl) break
      spriteImageCache.delete(oldestUrl)
    }
    return imagePromise
  }

  function preloadAdjacentSprites(frame: NonNullable<typeof previewFrame.value>) {
    for (const fileIndex of [frame.fileIndex - 1, frame.fileIndex + 1]) {
      const file = frame.sprite.files[fileIndex]
      if (file) void loadSpriteImage(`${frame.sprite.base_url}/${file}`, 'low').catch(() => undefined)
    }
  }

  async function drawPreviewFrame() {
    const frame = previewFrame.value
    const canvas = spriteCanvas.value
    const expectedFrameKey = previewFrameKey.value
    if (!hoverPreview.value || props.previewDisabled || !frame || !canvas) return

    const renderSequence = ++spriteRenderSequence
    previewStatus.value = 'loading'
    try {
      const image = await loadSpriteImage(frame.url)
      if (renderSequence !== spriteRenderSequence || expectedFrameKey !== previewFrameKey.value || !hoverPreview.value || props.previewDisabled || canvas !== spriteCanvas.value) return

      const sourceWidth = frame.sprite.width
      const sourceHeight = frame.sprite.height
      const sourceX = frame.column * sourceWidth
      const sourceY = frame.row * sourceHeight
      if (sourceWidth <= 0 || sourceHeight <= 0 || sourceX + sourceWidth > image.naturalWidth || sourceY + sourceHeight > image.naturalHeight) {
        throw new Error(`雪碧图帧超出图片范围：${frame.url}`)
      }

      const { width, height } = previewDimensions.value
      const sourceScale = Math.min(sourceWidth / width, sourceHeight / height)
      const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, sourceScale))
      canvas.width = Math.max(1, Math.round(width * pixelRatio))
      canvas.height = Math.max(1, Math.round(height * pixelRatio))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建雪碧图画布')

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
      previewStatus.value = 'ready'
      preloadAdjacentSprites(frame)
    } catch (error) {
      if (renderSequence !== spriteRenderSequence) return
      previewStatus.value = 'error'
      console.warn('[EMOS REEL] Sprite preview unavailable', error)
    }
  }

  function hideSeekPreview() {
    if (hoverPreview.value) {
      hoverPreview.value = false
      emit('previewActive', false)
    }
    previewStatus.value = 'idle'
    spriteRenderSequence += 1
  }

  const updateSeekPreview = useThrottleFn(
    (event: MouseEvent) => {
      if (!pointerInside || props.previewDisabled) {
        hideSeekPreview()
        return
      }
      const seek = seekElement.value
      if (!seek || props.duration <= 0 || !activeSprite.value) return
      const rect = seek.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      const preferredWidth = isMobile.value ? 320 : 640
      const width = Math.max(1, Math.min(preferredWidth, rect.width - 8))
      previewWidth.value = width
      hoverTime.value = ratio * props.duration
      previewLeft.value = Math.min(rect.width - width / 2 - 4, Math.max(width / 2 + 4, ratio * rect.width))
      if (!hoverPreview.value) {
        hoverPreview.value = true
        emit('previewActive', true)
      }
      emit('interact')
    },
    16,
    false,
    true,
  )

  function handleMouseEnter(event: MouseEvent) {
    pointerInside = true
    updateSeekPreview(event)
  }

  function handleMouseLeave() {
    pointerInside = false
    hideSeekPreview()
  }

  function handleSeekInput(event: Event) {
    seekDraft.value = Number((event.target as HTMLInputElement).value)
    emit('interact')
  }

  function handleSeekCommit(event: Event) {
    const target = Number((event.target as HTMLInputElement).value)
    seekDraft.value = target
    emit('seek', target)
    emit('interact')
    void nextTick(() => {
      if (seekDraft.value === target) seekDraft.value = undefined
    })
  }

  function handleSeekKeydown(event: KeyboardEvent) {
    const offset = event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0
    if (!offset || props.duration <= 0) return
    event.preventDefault()
    seekDraft.value = undefined
    emit('seek', Math.min(props.duration, Math.max(0, props.currentTime + offset)))
    emit('interact')
  }

  watch(
    [previewFrameKey, previewWidth, hoverPreview],
    () => {
      void nextTick(drawPreviewFrame)
    },
    { flush: 'post' },
  )
  watch(
    () => props.previewDisabled,
    (disabled) => {
      if (disabled) hideSeekPreview()
    },
  )
  onBeforeUnmount(() => {
    pointerInside = false
    if (hoverPreview.value) emit('previewActive', false)
    spriteRenderSequence += 1
    spriteImageCache.clear()
  })
</script>

<template>
  <div ref="seekElement" class="seek-shell" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave" @mousemove="updateSeekPreview">
    <div v-if="hoverPreview && previewFrame" :class="previewStatus" :style="previewStyle" class="sprite-preview">
      <canvas ref="spriteCanvas"></canvas>
      <span v-if="previewStatus === 'loading' || previewStatus === 'idle'" aria-hidden="true" class="sprite-preview-state">
        <LoaderCircle :size="19" class="animate-spin" />
      </span>
      <span v-else-if="previewStatus === 'error'" aria-hidden="true" class="sprite-preview-state error">
        <ImageOff :size="19" />
      </span>
      <span class="sprite-preview-time">{{ hoverTimeLabel }}</span>
    </div>

    <div class="buffer-track">
      <span v-for="(range, index) in availableRanges" :key="`${index}:${range.start}:${range.end}`" :style="{ left: `${range.start}%`, width: `${Math.max(0, range.end - range.start)}%` }"></span>
    </div>
    <input
      :max="duration || 0"
      :style="{ '--seek-progress': `${progress}%` }"
      :value="displayedTime"
      aria-label="播放进度"
      class="seek-range"
      min="0"
      step="0.05"
      type="range"
      @change="handleSeekCommit"
      @input="handleSeekInput"
      @keydown="handleSeekKeydown" />
  </div>
</template>

<style scoped>
  .seek-shell {
    position: relative;
    height: 22px;
  }
  .buffer-track {
    position: absolute;
    top: 9px;
    right: 0;
    left: 0;
    height: 3px;
    overflow: hidden;
    pointer-events: none;
  }
  .buffer-track span {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(255, 255, 255, 0.42);
  }
  .seek-range {
    --seek-progress: 0%;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 22px;
    margin: 0;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }
  .seek-range::-webkit-slider-runnable-track {
    height: 3px;
    background: linear-gradient(90deg, var(--reel-accent) var(--seek-progress), rgba(255, 255, 255, 0.18) var(--seek-progress));
  }
  .seek-range::-moz-range-track {
    height: 3px;
    background: rgba(255, 255, 255, 0.18);
  }
  .seek-range::-moz-range-progress {
    height: 3px;
    background: var(--reel-accent);
  }
  .seek-range::-webkit-slider-thumb {
    width: 13px;
    height: 13px;
    margin-top: -5px;
    border: 0;
    border-radius: 50%;
    appearance: none;
    background: white;
    box-shadow: 0 0 0 3px rgba(112, 183, 173, 0.32);
  }
  .seek-range::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border: 0;
    border-radius: 50%;
    background: white;
  }
  .seek-range:focus-visible {
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 1px;
  }
  .sprite-preview {
    position: absolute;
    bottom: 28px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 4px;
    background: #151515;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
    transform: translateX(-50%);
    pointer-events: none;
  }
  .sprite-preview canvas {
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.1s ease;
  }
  .sprite-preview.ready canvas {
    opacity: 1;
  }
  .sprite-preview-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(21, 21, 21, 0.94);
    color: rgba(255, 255, 255, 0.58);
  }
  .sprite-preview-state.error {
    color: rgba(255, 255, 255, 0.38);
  }
  .sprite-preview-time {
    position: absolute;
    z-index: 1;
    right: 7px;
    bottom: 6px;
    padding: 4px 6px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.74);
    font-size: 12px;
  }
  @media (max-width: 620px) {
    .sprite-preview-time {
      font-size: 11px;
    }
  }
</style>
