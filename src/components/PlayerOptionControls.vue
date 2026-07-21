<script lang="ts" setup>
import { AudioLines, Check, ChevronDown, LoaderCircle } from '@lucide/vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { computed, ref } from 'vue'
import { formatFileSize } from '@/utils/file-size'
import type { MediaVersion } from '@/api/types'
import type { PlaybackAudioOption } from '@/types/player'

type OptionMenu = 'quality' | 'rate' | 'audio' | null

  const props = defineProps<{
    open: OptionMenu
    versions: MediaVersion[]
    selectedMediaId: string
    switchingVersion: boolean
    playbackRate: number
    audioTracks: PlaybackAudioOption[]
    selectedAudio: string
  }>()

  const emit = defineEmits<{
    'update:open': [menu: OptionMenu]
    selectMedia: [mediaId: string]
    selectRate: [rate: number]
    selectAudio: [id: string]
  }>()

  const root = ref<HTMLElement>()
  const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2]
  const selectedVersion = computed(() => props.versions.find((version) => version.media_id === props.selectedMediaId))
  const qualityLabel = computed(() => selectedVersion.value?.media_name || '播放版本')
  const rateLabel = computed(() => (props.playbackRate === 1 ? '1×' : `${props.playbackRate}×`))
  const audioLabel = computed(() => props.audioTracks.find((audio) => audio.id === props.selectedAudio)?.label || '默认音轨')

  function toggleMenu(menu: Exclude<OptionMenu, null>) {
    emit('update:open', props.open === menu ? null : menu)
  }

  function chooseMedia(mediaId: string) {
    emit('selectMedia', mediaId)
    emit('update:open', null)
  }

  function chooseRate(rate: number) {
    emit('selectRate', rate)
    emit('update:open', null)
  }

  function chooseAudio(id: string) {
    emit('selectAudio', id)
    emit('update:open', null)
  }

  onClickOutside(root, () => emit('update:open', null))
  useEventListener(document, 'keydown', (event) => {
    if (props.open && event.key === 'Escape') emit('update:open', null)
  })
</script>

<template>
  <div ref="root" class="option-controls">
    <button
      :aria-expanded="open === 'quality'"
      :class="{ active: open === 'quality' }"
      :disabled="switchingVersion || !versions.length"
      aria-label="选择画质"
      class="option-trigger quality-trigger"
      type="button"
      @click="toggleMenu('quality')">
      <LoaderCircle v-if="switchingVersion" :size="15" class="animate-spin" />
      <span>{{ switchingVersion ? '切换中' : qualityLabel }}</span>
      <ChevronDown v-if="!switchingVersion" :size="14" />
    </button>
    <button :aria-expanded="open === 'rate'" :class="{ active: open === 'rate' }" aria-label="选择播放速度" class="option-trigger rate-trigger" type="button" @click="toggleMenu('rate')">
      <span>{{ rateLabel }}</span>
      <ChevronDown :size="14" />
    </button>
    <button :aria-expanded="open === 'audio'" :class="{ active: open === 'audio' }" aria-label="选择音轨" class="option-trigger audio-trigger" type="button" @click="toggleMenu('audio')">
      <AudioLines :size="18" />
      <span>{{ audioLabel }}</span>
      <ChevronDown :size="14" />
    </button>

    <Transition name="option-menu">
      <div v-if="open" class="option-menu">
        <header>{{ open === 'quality' ? '画质' : open === 'rate' ? '播放速度' : '音轨' }}</header>
        <div v-if="open === 'quality'" class="option-list">
          <button v-for="version in versions" :key="version.media_id" :class="{ active: selectedMediaId === version.media_id }" type="button" @click="chooseMedia(version.media_id)">
            <span class="version-copy">
              <b>{{ version.media_name }}</b>
              <small>{{ formatFileSize(version.media_size) }}</small>
            </span>
            <Check v-if="selectedMediaId === version.media_id" :size="15" />
          </button>
        </div>
        <div v-else-if="open === 'rate'" class="option-list">
          <button v-for="rate in playbackRates" :key="rate" :class="{ active: playbackRate === rate }" type="button" @click="chooseRate(rate)">
            <span>{{ rate === 1 ? '正常' : `${rate}×` }}</span>
            <Check v-if="playbackRate === rate" :size="15" />
          </button>
        </div>
        <div v-else class="option-list audio-list">
          <button v-for="audio in audioTracks" :key="audio.id" :class="{ active: selectedAudio === audio.id }" type="button" @click="chooseAudio(audio.id)">
            <span>{{ audio.label }}</span>
            <Check v-if="selectedAudio === audio.id" :size="15" />
          </button>
          <button v-if="!audioTracks.length" disabled type="button"><span>默认音轨</span></button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
  .option-controls {
    position: relative;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .option-trigger {
    display: flex;
    height: 38px;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 9px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.76);
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }
  .option-trigger:hover,
  .option-trigger.active {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }
  .option-trigger:focus-visible,
  .option-list button:focus-visible {
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 1px;
  }
  .option-trigger > svg:last-child {
    color: rgba(255, 255, 255, 0.44);
    transition: transform 0.16s ease;
  }
  .option-trigger.active > svg:last-child {
    transform: rotate(180deg);
  }
  .quality-trigger {
    min-width: 76px;
    max-width: 180px;
  }
  .quality-trigger span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rate-trigger {
    min-width: 52px;
  }
  .audio-trigger {
    max-width: 160px;
  }
  .audio-trigger span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .option-menu {
    position: absolute;
    z-index: 18;
    right: 0;
    bottom: calc(100% + 10px);
    width: 292px;
    overflow: hidden;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-surface-overlay);
    box-shadow: 0 20px 58px rgba(0, 0, 0, 0.58);
  }
  .option-menu header {
    padding: 11px 13px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.52);
    font-size: 11px;
    font-weight: 700;
  }
  .option-list {
    max-height: min(340px, 55svh);
    overflow-y: auto;
    padding: 5px;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }
  .option-list button {
    display: flex;
    width: 100%;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 10px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: rgba(255, 255, 255, 0.68);
    font: inherit;
    font-size: 13px;
    text-align: left;
  }
  .option-list button:hover,
  .option-list button.active {
    background: var(--reel-accent-wash);
    color: white;
  }
  .option-list button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .option-list .version-copy {
    display: grid;
    gap: 2px;
    overflow: visible;
    white-space: normal;
  }
  .version-copy b {
    overflow-wrap: anywhere;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.35;
  }
  .version-copy small {
    color: rgba(255, 255, 255, 0.42);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .option-list button svg {
    flex: 0 0 auto;
    color: var(--reel-accent-soft);
  }
  .option-menu-enter-active,
  .option-menu-leave-active {
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
    transform-origin: right bottom;
  }
  .option-menu-enter-from,
  .option-menu-leave-to {
    opacity: 0;
    transform: translateY(5px) scale(0.98);
  }
  @media (max-width: 900px) {
    .audio-trigger {
      width: 50px;
      padding: 0 6px;
    }
    .audio-trigger span {
      display: none;
    }
  }
  @media (max-width: 620px) {
    .option-controls {
      justify-content: flex-end;
    }
    .option-trigger {
      height: 34px;
      padding: 0 7px;
      font-size: 11px;
    }
    .quality-trigger {
      width: 100%;
      min-width: 0;
      max-width: none;
    }
    .quality-trigger span {
      flex: 1;
      text-align: left;
    }
    .rate-trigger {
      min-width: 46px;
    }
    .audio-trigger {
      width: 38px;
      padding: 0;
    }
    .audio-trigger span,
    .audio-trigger > svg:last-child {
      display: none;
    }
    .option-menu {
      width: min(292px, calc(100vw - 16px));
    }
    .option-list button {
      font-size: 12px;
    }
  }
</style>
