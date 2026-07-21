<script lang="ts" setup>
import { ArrowLeftRight, Check, ChevronDown, LoaderCircle } from '@lucide/vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { ref } from 'vue'
import type { MediaVersion } from '@/api/types'
import { formatFileSize } from '@/utils/file-size'

const props = defineProps<{
    versions: MediaVersion[]
    selectedMediaId: string
    switching: boolean
  }>()

  const emit = defineEmits<{
    select: [mediaId: string]
  }>()

  const root = ref<HTMLElement>()
  const open = ref(false)

  function toggle() {
    if (!props.switching) open.value = !open.value
  }

  function selectVersion(mediaId: string) {
    if (mediaId === props.selectedMediaId || props.switching) return
    open.value = false
    emit('select', mediaId)
  }

  onClickOutside(root, () => {
    open.value = false
  })
  useEventListener(document, 'keydown', (event) => {
    if (event.key === 'Escape') open.value = false
  })
</script>

<template>
  <div ref="root" class="error-version-picker">
    <button :aria-expanded="open" :disabled="switching" class="secondary-button error-version-trigger" type="button" @click="toggle">
      <LoaderCircle v-if="switching" :size="17" class="animate-spin" />
      <ArrowLeftRight v-else :size="17" />
      <span>{{ switching ? '正在切换' : '切换版本' }}</span>
      <ChevronDown v-if="!switching" :class="{ rotated: open }" :size="15" />
    </button>

    <Transition name="version-menu">
      <div v-if="open" class="error-version-menu">
        <header>选择播放版本</header>
        <div class="error-version-list">
          <button
            v-for="version in versions"
            :key="version.media_id"
            :class="{ active: version.media_id === selectedMediaId }"
            :disabled="version.media_id === selectedMediaId"
            type="button"
            @click="selectVersion(version.media_id)">
            <span>
              <b>{{ version.media_name }}</b>
              <small>{{ formatFileSize(version.media_size) }}</small>
            </span>
            <Check v-if="version.media_id === selectedMediaId" :size="16" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
  .error-version-picker {
    position: relative;
  }
  .error-version-trigger {
    white-space: nowrap;
  }
  .error-version-trigger[aria-expanded='true'] {
    border-color: rgba(255, 255, 255, 0.42);
    background: rgba(255, 255, 255, 0.07);
  }
  .error-version-trigger:disabled {
    cursor: wait;
    opacity: 0.62;
  }
  .error-version-trigger:focus-visible,
  .error-version-list button:focus-visible {
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 2px;
  }
  .error-version-trigger svg:last-child {
    color: rgba(255, 255, 255, 0.5);
    transition: transform 0.16s ease;
  }
  .error-version-trigger svg.rotated {
    transform: rotate(180deg);
  }
  .error-version-menu {
    position: absolute;
    z-index: 20;
    bottom: calc(100% + 9px);
    left: 50%;
    width: min(330px, 88vw);
    overflow: hidden;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-surface-overlay);
    box-shadow: 0 18px 54px rgba(0, 0, 0, 0.62);
    transform: translateX(-50%);
    text-align: left;
  }
  .error-version-menu header {
    padding: 11px 13px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.55);
    font-size: 11px;
    font-weight: 700;
  }
  .error-version-list {
    max-height: min(280px, 48svh);
    overflow-y: auto;
    padding: 5px;
  }
  .error-version-list button {
    display: flex;
    width: 100%;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font: inherit;
    text-align: left;
  }
  .error-version-list button:hover:not(:disabled) {
    background: var(--reel-accent-wash);
    color: white;
  }
  .error-version-list button.active {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.52);
  }
  .error-version-list button > span {
    display: grid;
    min-width: 0;
    gap: 3px;
  }
  .error-version-list b {
    overflow-wrap: anywhere;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.35;
  }
  .error-version-list small {
    color: rgba(255, 255, 255, 0.42);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .error-version-list svg {
    flex: 0 0 auto;
    color: var(--reel-accent-soft);
  }
  .version-menu-enter-active,
  .version-menu-leave-active {
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }
  .version-menu-enter-from,
  .version-menu-leave-to {
    opacity: 0;
    transform: translate(-50%, 5px) scale(0.98);
  }
  @media (max-width: 620px) {
    .error-version-picker,
    .error-version-trigger {
      width: 100%;
    }
    .error-version-trigger {
      padding-right: 8px;
      padding-left: 8px;
    }
    .error-version-menu {
      position: fixed;
      right: 12px;
      bottom: 86px;
      left: 12px;
      width: auto;
      transform: none;
    }
    .version-menu-enter-from,
    .version-menu-leave-to {
      transform: translateY(5px) scale(0.98);
    }
  }
</style>
