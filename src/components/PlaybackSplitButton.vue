<script lang="ts" setup>
  import { Check, ChevronDown, CircleCheck, File, HardDrive, Info, Play } from '@lucide/vue'
  import { onClickOutside, useEventListener } from '@vueuse/core'
  import { computed, ref, watch } from 'vue'
  import { formatFileSize } from '@/utils/file-size'
  import type { PlaybackCodec } from '@/utils/media-codecs'
  import { formatMediaVersionSummary, getMediaVersionPlaybackSupport, type MediaVersionPlaybackSupport } from '@/utils/media-metadata'
  import type { MediaVersion } from '@/api/types'

  const props = defineProps<{
    versions: MediaVersion[]
    modelValue: string
    canPlay: boolean
    loading: boolean
    error: string
    menuDirection?: 'up' | 'down'
    actionLabel?: string
    resumeSeconds?: number | null
    isComplete?: boolean
    selectedSupport?: MediaVersionPlaybackSupport
    supportedCodecs?: readonly PlaybackCodec[]
  }>()

  const emit = defineEmits<{
    'update:modelValue': [mediaId: string]
    play: [fromStart: boolean]
  }>()

  const root = ref<HTMLElement>()
  const open = ref(false)
  const selectedVersion = computed(() => props.versions.find((version) => version.media_id === props.modelValue))
  const selectedVersionSummary = computed(() => (selectedVersion.value ? formatMediaVersionSummary(selectedVersion.value) : ''))
  const hasMultipleVersions = computed(() => props.versions.length > 1)
  const resolvedActionLabel = computed(() => props.actionLabel ?? (props.isComplete ? '重新播放' : (props.resumeSeconds ?? 0) > 0 ? '继续播放' : '开始播放'))
  const canRestart = computed(() => props.canPlay && !props.isComplete && (props.resumeSeconds ?? 0) > 0)

  function toggleMenu() {
    if (!hasMultipleVersions.value) return
    open.value = !open.value
  }

  function selectVersion(mediaId: string) {
    emit('update:modelValue', mediaId)
    open.value = false
  }

  function versionSupport(version: MediaVersion) {
    return getMediaVersionPlaybackSupport(version, props.supportedCodecs)
  }

  onClickOutside(root, () => {
    open.value = false
  })
  useEventListener(document, 'keydown', (event) => {
    if (open.value && event.key === 'Escape') open.value = false
  })
  watch(
    () => props.versions,
    (versions) => {
      if (versions.length <= 1) open.value = false
    },
  )
</script>

<template>
  <div ref="root" :class="{ 'menu-down': menuDirection === 'down' }" class="playback-action">
    <Transition name="version-menu">
      <div v-if="open" class="version-menu">
        <header>
          <div>
            <span>选择播放版本</span>
            <strong v-if="selectedVersion">{{ selectedVersion.media_name }}</strong>
          </div>
          <small>{{ versions.length }} 个版本</small>
        </header>
        <div aria-label="选择播放版本" class="version-list" role="listbox">
          <button
            v-for="version in versions"
            :key="version.media_id"
            :aria-selected="version.media_id === modelValue"
            :class="{ active: version.media_id === modelValue }"
            role="option"
            type="button"
            @click="selectVersion(version.media_id)">
            <span class="selection-mark"><Check v-if="version.media_id === modelValue" :size="15" /></span>
            <span class="version-copy">
              <span class="version-name">{{ version.media_name }}</span>
              <span class="version-meta">
                <span v-if="version.storage_title" class="storage-title">
                  <HardDrive :size="12" />
                  {{ version.storage_title }}
                </span>
                <small class="file-size">
                  <File :size="12" />
                  {{ formatFileSize(version.media_size) }}
                </small>
                <small v-if="versionSupport(version).playable === false" class="support-badge">不可播放</small>
              </span>
              <small v-if="versionSupport(version).playable === false" class="version-summary warning">{{ versionSupport(version).reason }}</small>
              <small v-else-if="formatMediaVersionSummary(version)" class="version-summary">{{ formatMediaVersionSummary(version) }}</small>
            </span>
          </button>
        </div>
      </div>
    </Transition>

    <p v-if="error" class="action-message">{{ error }}</p>
    <p v-else-if="selectedSupport?.playable === false" class="action-message">{{ selectedSupport.reason }}</p>
    <p v-else-if="!versions.length && !loading" class="action-message">当前内容暂无播放版本</p>

    <div v-if="selectedVersion" class="selected-version">
      <div class="selected-version-copy">
        <div class="selected-version-line">
          <span aria-label="当前版本" class="selected-version-name" title="当前版本">
            <CircleCheck :size="12" />
            <span>{{ selectedVersion.media_name }}</span>
          </span>
        </div>
        <div class="selected-version-line selected-version-line-secondary">
          <span v-if="selectedVersion.storage_title" class="selected-storage">
            <HardDrive :size="12" />
            <span>{{ selectedVersion.storage_title }}</span>
          </span>
          <small class="selected-file-size">
            <File :size="12" />
            {{ formatFileSize(selectedVersion.media_size) }}
          </small>
        </div>
        <small v-if="selectedVersionSummary" class="selected-summary">
          <Info :size="12" />
          <span>{{ selectedVersionSummary }}</span>
        </small>
      </div>
      <button v-if="canRestart" type="button" @click="emit('play', true)">从头播放</button>
    </div>

    <div :class="{ open, 'single-version': !hasMultipleVersions }" class="split-button">
      <button :disabled="!canPlay" class="play-main" type="button" @click="emit('play', false)">
        <Play :size="17" fill="currentColor" />
        {{ resolvedActionLabel }}
      </button>
      <button v-if="hasMultipleVersions" :aria-expanded="open" aria-label="选择播放版本" class="version-toggle" type="button" @click="toggleMenu">
        <ChevronDown :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
  .playback-action {
    position: relative;
    display: grid;
    min-width: 250px;
    justify-items: stretch;
    gap: 6px;
  }
  .playback-action > * {
    justify-self: end;
  }
  .split-button {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(140px, 1fr) 44px;
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.24));
  }
  .split-button.single-version {
    grid-template-columns: minmax(184px, 1fr);
  }
  .split-button button {
    height: 48px;
    border: 0;
    color: var(--reel-on-action);
  }
  .play-main {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 19px 0 22px;
    border-radius: 999px 0 0 999px;
    background: var(--reel-action);
    font-size: 15px;
    font-weight: 750;
  }
  .split-button.single-version .play-main {
    border-radius: 999px;
  }
  .version-toggle {
    display: grid;
    width: 44px;
    place-items: center;
    border-left: 1px solid rgba(17, 18, 22, 0.16) !important;
    border-radius: 0 999px 999px 0;
    background: var(--reel-action-secondary);
  }
  .play-main:hover:not(:disabled),
  .version-toggle:hover:not(:disabled) {
    background: var(--reel-action-hover);
  }
  .version-toggle svg {
    transition: transform 0.18s ease;
  }
  .split-button.open .version-toggle svg {
    transform: rotate(180deg);
  }
  .action-message {
    max-width: 300px;
    margin: 0 8px 0 0;
    color: var(--reel-muted);
    font-size: 12px;
    text-align: right;
  }
  .selected-version {
    justify-self: stretch;
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    color: rgba(245, 243, 239, 0.88);
    font-size: 13px;
    text-align: left;
  }
  .selected-version-copy {
    display: grid;
    min-width: 0;
    max-width: 100%;
    justify-items: start;
    gap: 4px;
  }
  .selected-version-line {
    display: flex;
    min-width: 0;
    max-width: 100%;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
  }
  .selected-version-line-secondary {
    gap: 8px;
  }
  .selected-version-name,
  .selected-storage,
  .selected-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selected-version-name {
    display: inline-flex;
    min-height: 16px;
    align-items: center;
    gap: 5px;
    line-height: 1.15;
  }
  .selected-version-name span,
  .selected-storage span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .selected-version-name svg {
    display: block;
    flex: 0 0 auto;
    color: var(--reel-accent-soft);
  }
  .selected-version small {
    flex: 0 0 auto;
    color: rgba(156, 157, 163, 0.78);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .selected-file-size {
    display: inline-flex;
    min-height: 14px;
    align-items: center;
    gap: 4px;
    color: rgba(198, 199, 194, 0.74);
    line-height: 1;
  }
  .selected-file-size svg {
    display: block;
    flex: 0 0 auto;
  }
  .selected-summary {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 4px;
    color: rgba(222, 224, 218, 0.7);
    line-height: 1.2;
  }
  .selected-summary svg {
    display: block;
    flex: 0 0 auto;
    color: rgba(222, 224, 218, 0.58);
  }
  .selected-summary span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .selected-storage {
    display: inline-flex;
    min-height: 14px;
    align-items: center;
    gap: 4px;
    color: rgba(210, 211, 207, 0.68);
    font-size: 11px;
    line-height: 1;
  }
  .selected-storage svg {
    display: block;
    flex: 0 0 auto;
  }
  .selected-version button {
    flex: 0 0 auto;
    padding: 2px 0 2px 9px;
    border: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.16);
    background: transparent;
    color: var(--reel-film);
    font: inherit;
    font-size: 11px;
    font-weight: 680;
  }
  .selected-version button:hover {
    color: white;
  }
  .version-menu {
    position: absolute;
    z-index: 5;
    right: 0;
    bottom: calc(100% + 12px);
    width: min(520px, calc(100vw - 40px));
    overflow: hidden;
    border: 1px solid var(--reel-line);
    border-radius: 7px;
    background: var(--reel-surface-elevated);
    box-shadow: 0 22px 65px rgba(0, 0, 0, 0.48);
  }
  .playback-action.menu-down .version-menu {
    top: calc(100% + 12px);
    bottom: auto;
  }
  .version-menu > header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 18px;
    padding: 14px 15px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .version-menu header > div {
    display: grid;
    min-width: 0;
    gap: 4px;
  }
  .version-menu header span {
    color: var(--reel-film);
    font-size: 12px;
    font-weight: 700;
  }
  .version-menu header strong {
    overflow: hidden;
    color: rgba(255, 255, 255, 0.78);
    font-size: 15px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .version-menu header > small {
    flex: 0 0 auto;
    color: var(--reel-muted);
    font-size: 11px;
  }
  .version-list {
    max-height: min(330px, 48svh);
    overflow-y: auto;
    padding: 6px;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }
  .version-list button {
    display: grid;
    width: 100%;
    min-height: 56px;
    grid-template-columns: 22px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font: inherit;
    text-align: left;
  }
  .version-list button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .version-list button.active {
    background: var(--reel-accent-wash);
    color: white;
  }
  .selection-mark {
    display: grid;
    width: 20px;
    height: 20px;
    place-items: center;
    color: var(--reel-accent-soft);
  }
  .version-name {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 14px;
    line-height: 1.5;
  }
  .version-copy {
    display: grid;
    min-width: 0;
    gap: 3px;
  }
  .version-meta {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 9px;
  }
  .storage-title {
    display: inline-flex;
    min-width: 0;
    min-height: 14px;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.48);
    font-size: 11px;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .storage-title svg {
    display: block;
    flex: 0 0 auto;
  }
  .version-list small {
    flex: 0 0 auto;
    color: var(--reel-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .file-size {
    display: inline-flex;
    min-height: 14px;
    align-items: center;
    gap: 4px;
    line-height: 1;
  }
  .version-summary {
    min-width: 0;
    overflow: hidden;
    color: rgba(213, 216, 209, 0.58);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .version-summary.warning,
  .support-badge {
    color: #f2b8a2;
  }
  .support-badge {
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 700;
  }
  .file-size svg {
    display: block;
    flex: 0 0 auto;
  }
  .version-menu-enter-active,
  .version-menu-leave-active {
    transition:
      opacity 0.16s ease,
      transform 0.16s ease;
    transform-origin: right bottom;
  }
  .version-menu-enter-from,
  .version-menu-leave-to {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
  .menu-down .version-menu-enter-from,
  .menu-down .version-menu-leave-to {
    transform: translateY(-6px) scale(0.98);
  }
  @media (max-width: 620px) {
    .playback-action {
      width: 100%;
      min-width: 0;
    }
    .split-button {
      order: 1;
      width: 100%;
      grid-template-columns: minmax(0, 1fr) 44px;
    }
    .split-button.single-version {
      grid-template-columns: minmax(0, 1fr);
    }
    .selected-version {
      order: 2;
      flex-wrap: wrap;
      padding: 0 8px;
      font-size: 12px;
    }
    .selected-version-copy {
      width: 100%;
      flex: 1 1 100%;
    }
    .selected-version-line {
      width: 100%;
    }
    .selected-summary {
      width: 100%;
    }
    .selected-version button {
      margin-top: 2px;
      padding-left: 0;
      border-left: 0;
    }
    .selected-version small {
      font-size: 10px;
    }
    .selected-storage {
      max-width: 34%;
      font-size: 10px;
    }
    .action-message {
      order: 3;
      justify-self: start;
      max-width: 100%;
      margin: 0 0 0 8px;
      text-align: left;
    }
    .split-button button {
      height: 44px;
    }
    .play-main {
      padding-right: 17px;
      padding-left: 19px;
      font-size: 14px;
    }
    .version-toggle {
      width: 44px;
    }
    .version-menu {
      right: 0;
      width: 100%;
    }
    .action-message {
      max-width: 100%;
      font-size: 11px;
    }
    .version-menu header span {
      font-size: 11px;
    }
    .version-menu header strong {
      font-size: 14px;
    }
    .version-menu header > small {
      font-size: 10px;
    }
    .version-list button {
      min-height: 52px;
    }
    .version-name {
      font-size: 13px;
    }
    .version-list small {
      font-size: 10px;
    }
  }
</style>
