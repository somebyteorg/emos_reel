<script lang="ts" setup>
  import { Activity, Trash2, X } from '@lucide/vue'
  import { StorageSerializers, useDraggable, useEventListener, useMediaQuery, useSessionStorage } from '@vueuse/core'
  import { computed, nextTick, onMounted, ref } from 'vue'
  import PlayerSeekDebugList from '@/components/PlayerSeekDebugList.vue'
  import type { PlayerDebugSnapshot } from '@/types/player'

  defineProps<{
    cacheClearing: boolean
    snapshot: PlayerDebugSnapshot
  }>()

  defineEmits<{ clearCache: []; close: [] }>()

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
      <span class="panel-title">
        <Activity :size="15" />
        播放信息
      </span>
      <button aria-label="关闭播放信息" type="button" @click="$emit('close')"><X :size="17" /></button>
    </header>
    <div class="debug-content">
      <dl class="debug-list">
        <div class="debug-row">
          <dt>视频读取</dt>
          <dd class="speed-value">{{ snapshot.readStatus }}</dd>
        </div>
        <div class="debug-row">
          <dt>网络带宽</dt>
          <dd>{{ snapshot.estimatedBandwidth }}</dd>
        </div>
        <div class="debug-row">
          <dt>视频码率</dt>
          <dd>{{ snapshot.streamBandwidth }}</dd>
        </div>
        <div v-if="snapshot.showLibmediaDiagnostics" class="debug-row">
          <dt>缓冲构成</dt>
          <dd>{{ snapshot.bufferDiagnostics }}</dd>
        </div>
        <div v-if="snapshot.showLibmediaDiagnostics" class="debug-row">
          <dt>后台缓存</dt>
          <dd>{{ snapshot.persistentReadAhead }}</dd>
        </div>
        <div v-if="snapshot.showLibmediaDiagnostics" class="debug-row">
          <dt>数据状态</dt>
          <dd>{{ snapshot.streamState }}</dd>
        </div>
        <div class="debug-row">
          <dt>视频尺寸</dt>
          <dd>{{ snapshot.resolution }}</dd>
        </div>
        <div class="debug-row">
          <dt>窗口尺寸</dt>
          <dd>{{ snapshot.viewport }}</dd>
        </div>
        <div class="debug-row">
          <dt>丢帧统计</dt>
          <dd>{{ snapshot.droppedFrames }}</dd>
        </div>
        <div class="debug-row">
          <dt>编码格式</dt>
          <dd>{{ snapshot.codecs }}</dd>
        </div>
        <div class="debug-row">
          <dt>播放版本</dt>
          <dd>{{ snapshot.mediaName }}</dd>
        </div>
        <div v-if="snapshot.storageLocation" class="debug-row">
          <dt>储存位置</dt>
          <dd>{{ snapshot.storageLocation }}</dd>
        </div>
        <div class="debug-row">
          <dt>视频编号</dt>
          <dd>{{ snapshot.mediaId }}</dd>
        </div>
        <div v-if="snapshot.showLibmediaDiagnostics" class="debug-row cache-row">
          <dt>全局缓存</dt>
          <dd>{{ snapshot.mediaCache }}</dd>
          <button :aria-label="cacheClearing ? '正在清除全局本机缓存' : '清除全局本机缓存'" :disabled="cacheClearing" type="button" @click="$emit('clearCache')">
            <Trash2 :size="14" />
          </button>
        </div>
      </dl>

      <PlayerSeekDebugList v-if="snapshot.showLibmediaDiagnostics" :entries="snapshot.seekLogs" />
    </div>
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
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
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
  .panel-title {
    display: flex;
    align-items: center;
    gap: 7px;
    color: white;
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
  .debug-content {
    max-height: min(650px, calc(100vh - 170px));
    overflow-y: auto;
  }
  .debug-list {
    margin: 0;
    padding: 12px 14px 13px;
  }
  .debug-row {
    display: grid;
    min-height: 22px;
    grid-template-columns: 82px minmax(0, 1fr) auto;
    align-items: center;
  }
  .debug-list dt {
    color: rgba(255, 255, 255, 0.45);
    font-size: 10px;
    line-height: 1.35;
    white-space: nowrap;
  }
  .debug-list dd {
    min-width: 0;
    overflow: hidden;
    margin: 0;
    color: rgba(255, 255, 255, 0.82);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .debug-list .speed-value {
    color: var(--reel-accent-soft);
    font-weight: 700;
  }
  .cache-row button {
    display: grid;
    width: 27px;
    height: 27px;
    grid-column: 3;
    place-items: center;
    margin-left: 10px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.66);
  }
  .cache-row button:hover:not(:disabled) {
    border-color: rgba(220, 138, 132, 0.36);
    background: rgba(220, 138, 132, 0.1);
    color: rgba(239, 167, 160, 0.96);
  }
  .cache-row button:disabled {
    opacity: 0.56;
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
    .debug-content {
      max-height: calc(100vh - 180px);
    }
  }
</style>
