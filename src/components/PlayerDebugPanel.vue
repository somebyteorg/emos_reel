<script lang="ts" setup>
import { Activity, X } from '@lucide/vue'
import { StorageSerializers, useDraggable, useEventListener, useMediaQuery, useSessionStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, ref } from 'vue'
import type { PlayerDebugSnapshot } from '@/types/player'

defineProps<{
    snapshot: PlayerDebugSnapshot
  }>()

  defineEmits<{ close: [] }>()

  interface PanelPosition {
    x: number
    y: number
  }

  const panel = ref<HTMLElement>()
  const dragHandle = ref<HTMLElement>()
  const isMobile = useMediaQuery('(max-width: 620px)')
  const storedPosition = useSessionStorage<PanelPosition | null>('emos_reel.player.debug.position', null, { serializer: StorageSerializers.object })
  const hasStoredPosition = storedPosition.value !== null
  const container = computed(() => panel.value?.parentElement)
  const { x, y, isDragging } = useDraggable(panel, {
    handle: dragHandle,
    containerElement: container,
    initialValue: storedPosition.value ?? { x: 38, y: 94 },
    pointerTypes: ['mouse'],
    preventDefault: true,
    restrictInView: true,
    disabled: isMobile,
    onStart: (_position, event) => {
      if ((event.target as Element).closest('button')) return false
    },
    onEnd: (position) => {
      storedPosition.value = position
    },
  })
  const panelStyle = computed(() => (isMobile.value ? undefined : { left: `${x.value}px`, top: `${y.value}px` }))

  function clampPosition() {
    const element = panel.value
    const parent = container.value
    if (!element || !parent || isMobile.value) return
    x.value = Math.min(Math.max(0, x.value), Math.max(0, parent.clientWidth - element.offsetWidth))
    y.value = Math.min(Math.max(0, y.value), Math.max(0, parent.clientHeight - element.offsetHeight))
  }

  onMounted(async () => {
    await nextTick()
    if (!hasStoredPosition && panel.value && container.value) {
      x.value = Math.max(14, container.value.clientWidth - panel.value.offsetWidth - 38)
      y.value = 94
    }
    clampPosition()
  })
  useEventListener('resize', clampPosition)
</script>

<template>
  <aside ref="panel" :class="{ dragging: isDragging }" :style="panelStyle" aria-label="播放调试信息" class="debug-panel">
    <header ref="dragHandle">
      <span>
        <Activity :size="15" />
        播放调试信息
      </span>
      <button aria-label="关闭播放调试信息" type="button" @click="$emit('close')"><X :size="17" /></button>
    </header>
    <div class="speed-row">
      <span>速度</span>
      <strong>{{ snapshot.downloadSpeed }}</strong>
    </div>
    <dl>
      <dt>网络估算</dt>
      <dd>{{ snapshot.estimatedBandwidth }}</dd>
      <dt>当前码率</dt>
      <dd>{{ snapshot.streamBandwidth }}</dd>
      <dt>缓冲时长</dt>
      <dd>{{ snapshot.bufferAhead }}</dd>
      <dt>播放器尺寸</dt>
      <dd>{{ snapshot.viewport }}</dd>
      <dt>视频分辨率</dt>
      <dd>{{ snapshot.resolution }}</dd>
      <dt>丢帧</dt>
      <dd>{{ snapshot.droppedFrames }}</dd>
      <dt>编码</dt>
      <dd>{{ snapshot.codecs }}</dd>
      <dt>播放版本</dt>
      <dd>{{ snapshot.mediaName }}</dd>
      <dt>Media ID</dt>
      <dd>{{ snapshot.mediaId }}</dd>
    </dl>
  </aside>
</template>

<style scoped>
  .debug-panel {
    position: absolute;
    z-index: 12;
    top: 94px;
    left: clamp(14px, 3vw, 38px);
    width: min(420px, calc(100vw - 28px));
    overflow: hidden;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-surface-overlay);
    color: rgba(255, 255, 255, 0.78);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(10px);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    pointer-events: auto;
  }
  .debug-panel header {
    display: flex;
    min-height: 42px;
    align-items: center;
    justify-content: space-between;
    padding: 0 9px 0 13px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .debug-panel.dragging header {
    cursor: grabbing;
  }
  .debug-panel header span {
    display: flex;
    align-items: center;
    gap: 7px;
    color: white;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
  }
  .debug-panel header button {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: rgba(255, 255, 255, 0.62);
  }
  .debug-panel header button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  .speed-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
    padding: 12px 13px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .speed-row span {
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
  }
  .speed-row strong {
    color: var(--reel-accent-soft);
    font-size: 19px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .debug-panel dl {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    margin: 0;
    padding: 9px 13px 12px;
    font-size: 11px;
    line-height: 1.65;
  }
  .debug-panel dt {
    color: rgba(255, 255, 255, 0.45);
  }
  .debug-panel dd {
    min-width: 0;
    overflow: hidden;
    margin: 0;
    color: rgba(255, 255, 255, 0.82);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 620px) {
    .debug-panel {
      top: 70px;
      left: 10px;
      width: min(340px, calc(100vw - 20px));
    }
    .debug-panel header {
      cursor: default;
      touch-action: auto;
    }
    .debug-panel dl {
      grid-template-columns: 88px minmax(0, 1fr);
      font-size: 10px;
    }
    .speed-row strong {
      font-size: 16px;
    }
  }
</style>
