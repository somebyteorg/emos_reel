<script lang="ts" setup>
import dayjs from 'dayjs'
import durationPlugin from 'dayjs/plugin/duration'
import {
  Captions,
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import PlayerNowPlaying from '@/components/PlayerNowPlaying.vue'
import PlayerOptionControls from '@/components/PlayerOptionControls.vue'
import PlayerSeekBar from '@/components/PlayerSeekBar.vue'
import type { ManifestSprite, MediaVersion } from '@/api/types'
import type {
  PlaybackAudioOption,
  PlayerBufferedRange,
  SubtitleBackgroundMode,
  SubtitleFontSize,
  SubtitleOption,
  SubtitlePosition
} from '@/types/player'

dayjs.extend(durationPlugin)

  const props = defineProps<{
    visible: boolean
    paused: boolean
    currentTime: number
    duration: number
    bufferedRanges: PlayerBufferedRange[]
    volume: number
    muted: boolean
    subtitles: SubtitleOption[]
    selectedSubtitle: string | number
    subtitleFontSize: SubtitleFontSize
    subtitleBackgroundMode: SubtitleBackgroundMode
    subtitleBackgroundOpacity: number
    subtitlePosition: SubtitlePosition
    sprites: ManifestSprite[]
    fullscreen: boolean
    canPictureInPicture: boolean
    showEpisodeNavigation: boolean
    canPreviousEpisode: boolean
    canNextEpisode: boolean
    versions: MediaVersion[]
    selectedMediaId: string
    switchingVersion: boolean
    playbackRate: number
    audioTracks: PlaybackAudioOption[]
    selectedAudio: string
    showNowPlaying: boolean
    nowPlayingTitle: string
    nowPlayingMeta: string
  }>()

  const emit = defineEmits<{
    interact: []
    lockControls: [locked: boolean]
    togglePlayback: []
    previousEpisode: []
    nextEpisode: []
    toggleMute: []
    changeVolume: [volume: number]
    seek: [seconds: number]
    selectSubtitle: [option?: SubtitleOption]
    changeSubtitleFontSize: [size: SubtitleFontSize]
    changeSubtitleBackgroundMode: [mode: SubtitleBackgroundMode]
    changeSubtitleBackground: [opacity: number]
    changeSubtitlePosition: [position: SubtitlePosition]
    selectMedia: [mediaId: string]
    selectRate: [rate: number]
    selectAudio: [id: string]
    pictureInPicture: []
    fullscreen: []
  }>()

  const captionRoot = ref<HTMLElement>()
  const captionsOpen = ref(false)
  const optionMenu = ref<'quality' | 'rate' | 'audio' | null>(null)
  const currentTimeLabel = computed(() => dayjs.duration(Math.max(0, props.currentTime), 'seconds').format(props.currentTime >= 3600 ? 'HH:mm:ss' : 'mm:ss'))
  const durationLabel = computed(() => dayjs.duration(Math.max(0, props.duration), 'seconds').format(props.duration >= 3600 ? 'HH:mm:ss' : 'mm:ss'))
  const timeLabel = computed(() => `${currentTimeLabel.value} / ${durationLabel.value}`)

  function toggleCaptions() {
    optionMenu.value = null
    captionsOpen.value = !captionsOpen.value
    emit('interact')
  }

  function setOptionMenu(menu: 'quality' | 'rate' | 'audio' | null) {
    if (menu) captionsOpen.value = false
    optionMenu.value = menu
    emit('interact')
  }

  function chooseSubtitle(option?: SubtitleOption) {
    captionsOpen.value = false
    emit('selectSubtitle', option)
  }

  onClickOutside(captionRoot, () => {
    captionsOpen.value = false
  })
  watch([captionsOpen, optionMenu], ([captions, menu]) => emit('lockControls', captions || Boolean(menu)))
</script>

<template>
  <div :class="{ visible }" class="player-controls" @click="emit('interact')" @input="emit('interact')" @mouseenter="emit('interact')">
    <PlayerNowPlaying v-if="showNowPlaying" :meta="nowPlayingMeta" :title="nowPlayingTitle" />
    <PlayerSeekBar
      :buffered-ranges="bufferedRanges"
      :current-time="currentTime"
      :duration="duration"
      :preview-disabled="captionsOpen || Boolean(optionMenu)"
      :sprites="sprites"
      @interact="emit('interact')"
      @seek="emit('seek', $event)" />

    <div class="control-row">
      <div class="control-group control-primary">
        <button :aria-label="paused ? '播放' : '暂停'" class="player-icon" type="button" @click="emit('togglePlayback')">
          <Play v-if="paused" :size="20" fill="currentColor" />
          <Pause v-else :size="20" fill="currentColor" />
        </button>
        <button v-if="showEpisodeNavigation" :disabled="!canPreviousEpisode" aria-label="上一集" class="player-icon episode-nav-button" type="button" @click="emit('previousEpisode')">
          <SkipBack :size="19" />
        </button>
        <button v-if="showEpisodeNavigation" :disabled="!canNextEpisode" aria-label="下一集" class="player-icon episode-nav-button" type="button" @click="emit('nextEpisode')">
          <SkipForward :size="19" />
        </button>
        <div class="volume-control">
          <button :aria-label="muted ? '取消静音' : '静音'" class="player-icon" type="button" @click="emit('toggleMute')">
            <VolumeX v-if="muted || volume === 0" :size="20" />
            <Volume2 v-else :size="20" />
          </button>
          <input :value="muted ? 0 : volume" aria-label="音量" max="1" min="0" step="0.05" type="range" @input="emit('changeVolume', Number(($event.target as HTMLInputElement).value))" />
        </div>
        <span class="time-label">{{ timeLabel }}</span>
      </div>

      <div class="control-secondary">
        <div class="playback-options">
          <PlayerOptionControls
            :audio-tracks="audioTracks"
            :open="optionMenu"
            :playback-rate="playbackRate"
            :selected-audio="selectedAudio"
            :selected-media-id="selectedMediaId"
            :switching-version="switchingVersion"
            :versions="versions"
            @update:open="setOptionMenu"
            @select-media="emit('selectMedia', $event)"
            @select-rate="emit('selectRate', $event)"
            @select-audio="emit('selectAudio', $event)" />
        </div>

        <div class="control-group control-end">
          <div aria-hidden="true" class="together-slot"></div>
          <div ref="captionRoot" class="caption-root">
            <button :class="{ active: selectedSubtitle !== 'off' }" aria-label="字幕" class="player-icon" type="button" @click="toggleCaptions">
              <Captions :size="21" />
            </button>
            <Transition name="caption-menu-transition">
              <div v-if="captionsOpen" class="caption-menu">
                <header>字幕</header>
                <div class="caption-track-list">
                  <button :class="{ active: selectedSubtitle === 'off' }" type="button" @click="chooseSubtitle()">
                    <span>关闭字幕</span>
                    <Check v-if="selectedSubtitle === 'off'" :size="15" />
                  </button>
                  <button v-for="option in subtitles" :key="option.track.id" :class="{ active: selectedSubtitle === option.track.id }" type="button" @click="chooseSubtitle(option)">
                    <span>{{ option.title }}</span>
                    <Check v-if="selectedSubtitle === option.track.id" :size="15" />
                  </button>
                </div>
                <section class="caption-appearance">
                  <div class="caption-setting">
                    <span>字号</span>
                    <div class="caption-segments four-options">
                      <button :class="{ active: subtitleFontSize === 'system' }" type="button" @click="emit('changeSubtitleFontSize', 'system')">系统</button>
                      <button :class="{ active: subtitleFontSize === 'small' }" type="button" @click="emit('changeSubtitleFontSize', 'small')">小</button>
                      <button :class="{ active: subtitleFontSize === 'medium' }" type="button" @click="emit('changeSubtitleFontSize', 'medium')">中</button>
                      <button :class="{ active: subtitleFontSize === 'large' }" type="button" @click="emit('changeSubtitleFontSize', 'large')">大</button>
                    </div>
                  </div>
                  <div class="caption-setting">
                    <span>位置</span>
                    <div class="caption-segments four-options">
                      <button :class="{ active: subtitlePosition === 'system' }" type="button" @click="emit('changeSubtitlePosition', 'system')">系统</button>
                      <button :class="{ active: subtitlePosition === 'middle' }" type="button" @click="emit('changeSubtitlePosition', 'middle')">中部</button>
                      <button :class="{ active: subtitlePosition === 'raised' }" type="button" @click="emit('changeSubtitlePosition', 'raised')">稍高</button>
                      <button :class="{ active: subtitlePosition === 'bottom' }" type="button" @click="emit('changeSubtitlePosition', 'bottom')">底部</button>
                    </div>
                  </div>
                  <div class="caption-setting">
                    <span>背景</span>
                    <div class="caption-segments two-options">
                      <button :class="{ active: subtitleBackgroundMode === 'system' }" type="button" @click="emit('changeSubtitleBackgroundMode', 'system')">系统</button>
                      <button :class="{ active: subtitleBackgroundMode === 'custom' }" type="button" @click="emit('changeSubtitleBackgroundMode', 'custom')">自定义</button>
                    </div>
                  </div>
                  <label v-if="subtitleBackgroundMode === 'custom'" class="caption-opacity">
                    <span>不透明</span>
                    <small>{{ Math.round(subtitleBackgroundOpacity * 100) }}%</small>
                    <input
                      :value="subtitleBackgroundOpacity"
                      aria-label="字幕背景透明度"
                      max="0.9"
                      min="0"
                      step="0.1"
                      type="range"
                      @input="emit('changeSubtitleBackground', Number(($event.target as HTMLInputElement).value))" />
                  </label>
                </section>
              </div>
            </Transition>
          </div>
          <button v-if="canPictureInPicture" aria-label="画中画" class="player-icon desktop-control" type="button" @click="emit('pictureInPicture')"><PictureInPicture :size="20" /></button>
          <button :aria-label="fullscreen ? '退出全屏' : '全屏'" class="player-icon" type="button" @click="emit('fullscreen')">
            <Minimize v-if="fullscreen" :size="20" />
            <Maximize v-else :size="20" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .player-controls {
    position: absolute;
    z-index: 9;
    right: 0;
    bottom: 0;
    left: 0;
    padding: 72px clamp(13px, 3vw, 36px) 17px;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.9), rgba(0, 0, 0, 0.55) 54%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .player-controls.visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-group {
    display: flex;
    align-items: center;
  }
  .control-row {
    display: grid;
    min-height: 44px;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  .control-group {
    gap: 2px;
  }
  .control-primary {
    min-width: 0;
  }
  .control-secondary {
    display: flex;
    align-items: center;
  }
  .playback-options {
    padding: 0 5px;
  }
  .player-icon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: white;
  }
  .player-icon:hover,
  .player-icon.active {
    background: rgba(255, 255, 255, 0.12);
  }
  .player-icon:disabled {
    opacity: 0.28;
    cursor: default;
  }
  .player-icon:focus-visible,
  .caption-menu button:focus-visible,
  .caption-opacity input:focus-visible,
  .volume-control input:focus-visible {
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 1px;
  }
  .time-label {
    margin-left: 9px;
    color: rgba(255, 255, 255, 0.76);
    font-variant-numeric: tabular-nums;
    font-size: 13px;
  }
  .volume-control {
    display: flex;
    align-items: center;
  }
  .volume-control input {
    width: 0;
    opacity: 0;
    accent-color: var(--reel-accent);
    transition:
      width 0.18s ease,
      opacity 0.18s ease;
  }
  .volume-control:hover input,
  .volume-control:focus-within input {
    width: 76px;
    opacity: 1;
  }
  .caption-root {
    position: relative;
  }
  .caption-menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    display: grid;
    width: 292px;
    max-height: min(560px, 72vh);
    overflow-y: auto;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-surface-overlay);
    box-shadow: 0 20px 58px rgba(0, 0, 0, 0.58);
  }
  .caption-menu > header {
    padding: 11px 13px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.52);
    font-size: 11px;
    font-weight: 700;
  }
  .caption-track-list {
    max-height: 220px;
    overflow-y: auto;
    padding: 5px;
  }
  .caption-track-list button {
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
    color: rgba(255, 255, 255, 0.72);
    font: inherit;
    font-size: 13px;
    text-align: left;
  }
  .caption-track-list button:hover,
  .caption-track-list button.active {
    background: var(--reel-accent-wash);
    color: white;
  }
  .caption-track-list span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .caption-appearance {
    display: grid;
    gap: 11px;
    padding: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
  }
  .caption-setting {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .caption-setting > span,
  .caption-opacity > span {
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
  }
  .caption-segments {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
  }
  .caption-segments.four-options {
    grid-template-columns: repeat(4, 1fr);
  }
  .caption-segments.two-options {
    grid-template-columns: repeat(2, 1fr);
  }
  .caption-segments button {
    min-height: 32px;
    padding: 0 5px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.66);
    font: inherit;
    font-size: 11px;
  }
  .caption-segments button:hover,
  .caption-segments button.active {
    border-color: rgba(112, 183, 173, 0.46);
    background: var(--reel-accent-wash);
    color: white;
  }
  .caption-opacity {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) 34px;
    align-items: center;
    gap: 8px;
  }
  .caption-opacity input {
    width: 100%;
    margin: 0;
    accent-color: var(--reel-accent);
  }
  .caption-opacity small {
    color: rgba(255, 255, 255, 0.62);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .caption-menu-transition-enter-active,
  .caption-menu-transition-leave-active {
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
    transform-origin: right bottom;
  }
  .caption-menu-transition-enter-from,
  .caption-menu-transition-leave-to {
    opacity: 0;
    transform: translateY(5px) scale(0.98);
  }
  .together-slot {
    width: 0;
    height: 0;
    overflow: hidden;
  }
  @media (max-width: 620px) {
    .player-controls {
      padding-top: 100px;
      padding-right: 8px;
      padding-bottom: max(8px, env(safe-area-inset-bottom));
      padding-left: 8px;
    }
    .control-row {
      grid-template-areas: 'secondary' 'primary';
      grid-template-columns: minmax(0, 1fr);
      row-gap: 3px;
    }
    .control-primary {
      grid-area: primary;
      width: 100%;
    }
    .control-primary .time-label {
      margin-left: auto;
    }
    .control-secondary {
      position: relative;
      display: grid;
      width: 100%;
      min-width: 0;
      grid-area: secondary;
      grid-template-columns: minmax(0, 1fr) 8px auto auto auto;
      align-items: center;
    }
    .playback-options {
      display: contents;
      min-width: 0;
      padding: 0;
    }
    .playback-options :deep(.option-controls) {
      display: contents;
    }
    .playback-options :deep(.quality-trigger) {
      width: 100%;
      min-width: 0;
      max-width: none;
      grid-column: 1;
      justify-content: flex-start;
    }
    .playback-options :deep(.rate-trigger) {
      grid-column: 3;
    }
    .playback-options :deep(.audio-trigger) {
      grid-column: 4;
    }
    .playback-options :deep(.option-menu) {
      right: 0;
    }
    .control-end {
      grid-column: 5;
    }
    .player-icon {
      width: 40px;
      height: 40px;
    }
    .volume-control input,
    .volume-control:hover input {
      display: none;
    }
    .time-label {
      margin-left: 3px;
      font-size: 12px;
    }
    .desktop-control {
      display: none;
    }
    .caption-menu {
      right: -42px;
      width: min(292px, calc(100vw - 16px));
      max-height: 68svh;
    }
    .caption-track-list button {
      min-height: 36px;
      font-size: 12px;
    }
    .episode-nav-button {
      width: 34px;
    }
  }
  @media (max-width: 480px) {
    .volume-control {
      display: none;
    }
  }
  @media (max-width: 340px) {
    .time-label {
      display: none;
    }
  }
</style>
