<script lang="ts" setup>
import dayjs from 'dayjs'
import { Clapperboard, Film, LoaderCircle, X } from '@lucide/vue'
import { useEventListener, useMediaQuery, useSwipe } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import EpisodeGrid from '@/components/EpisodeGrid.vue'
import EpisodeSortControl from '@/components/EpisodeSortControl.vue'
import PlaybackSplitButton from '@/components/PlaybackSplitButton.vue'
import SeasonSelect from '@/components/SeasonSelect.vue'
import { imageUrl } from '@/api/todb'
import type { EpisodeInfo, MediaSource, MediaVersion, SeasonInfo } from '@/api/types'

const props = defineProps<{
    open: boolean
    title: string
    seasons: SeasonInfo[]
    selectedSeasonNumber: number | null
    episodes: EpisodeInfo[]
    selectedEpisodeNumber: number | null
    playingSeasonNumber: number | null
    playingEpisodeNumber: number | null
    availableEpisodeNumbers: number[]
    sources: MediaSource[]
    episodeLoading: boolean
    resourceLoading: boolean
    resourceResolved: boolean
    resourceError: string
    activeEpisodeTitle: string
    partSources: MediaSource[]
    selectedPartNumber: number | null
    versions: MediaVersion[]
    selectedMediaId: string
    switching: boolean
  }>()

  const emit = defineEmits<{
    close: []
    selectSeason: [seasonNumber: number]
    selectEpisode: [episodeNumber: number]
    selectPart: [partNumber: number | null]
    selectMedia: [mediaId: string]
    switch: [fromStart: boolean]
  }>()

  const filter = ref<'all' | 'available'>('all')
  const episodeSort = ref<'asc' | 'desc'>('asc')
  const descriptionOpen = ref(false)
  const previewImageLoaded = ref(false)
  const previewImageFailed = ref(false)
  const swipeHandle = ref<HTMLElement>()
  const isMobile = useMediaQuery('(max-width: 620px)')
  const available = computed(() => new Set(props.availableEpisodeNumbers))
  const visibleEpisodes = computed(() => {
    const filteredEpisodes = filter.value === 'available' ? props.episodes.filter((episode) => available.value.has(episode.episode_number)) : props.episodes
    const direction = episodeSort.value === 'asc' ? 1 : -1
    return [...filteredEpisodes].sort((a, b) => (a.episode_number - b.episode_number) * direction)
  })
  const playingLabel = computed(() => {
    if (props.playingSeasonNumber == null || props.playingEpisodeNumber == null) return ''
    return `第 ${props.playingSeasonNumber} 季 · 第 ${props.playingEpisodeNumber} 集`
  })
  const selectedSource = computed(() => props.partSources.find((source) => source.part_number === props.selectedPartNumber) ?? props.partSources[0])
  const selectedEpisode = computed(() => props.episodes.find((episode) => episode.episode_number === props.selectedEpisodeNumber))
  const selectedEpisodeAirDate = computed(() => {
    const dateAir = selectedEpisode.value?.date_air
    return dateAir && dayjs(dateAir).isValid() ? dayjs(dateAir).format('YYYY-MM-DD') : ''
  })
  const selectedEpisodeImage = computed(() => imageUrl(selectedEpisode.value?.image_poster, 'w300'))

  function handlePreviewImageLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement
    if (image.getAttribute('src') === selectedEpisodeImage.value) previewImageLoaded.value = true
  }

  function handlePreviewImageError(event: Event) {
    const image = event.currentTarget as HTMLImageElement
    if (image.getAttribute('src') === selectedEpisodeImage.value) previewImageFailed.value = true
  }

  function handlePreviewContentClick(event: MouseEvent) {
    if (!isMobile.value) event.stopPropagation()
  }

  useSwipe(swipeHandle, {
    threshold: 56,
    onSwipeEnd: (_event, direction) => {
      if (direction === 'down') emit('close')
    },
  })

  watch(
    () => props.open,
    (open) => {
      if (open) filter.value = 'all'
      else descriptionOpen.value = false
    },
  )
  watch(
    () => props.selectedSeasonNumber,
    () => {
      filter.value = 'all'
    },
  )
  watch(
    () => props.selectedEpisodeNumber,
    () => {
      descriptionOpen.value = false
    },
  )
  watch(
    selectedEpisodeImage,
    () => {
      previewImageLoaded.value = false
      previewImageFailed.value = false
    },
    { immediate: true, flush: 'sync' },
  )
  useEventListener(document, 'keydown', (event) => {
    if (!props.open || event.key !== 'Escape') return
    if (descriptionOpen.value) descriptionOpen.value = false
    else emit('close')
  })
</script>

<template>
  <Transition name="episode-switcher">
    <div v-if="open" class="switcher-backdrop" @click.self="emit('close')">
      <section v-if="selectedEpisode" class="switcher-episode-preview" @click="emit('close')">
        <div class="episode-preview-visual" @click="handlePreviewContentClick">
          <span v-if="selectedEpisodeImage && !previewImageLoaded && !previewImageFailed" class="episode-preview-loading">
            <LoaderCircle :size="22" class="animate-spin" />
          </span>
          <img
            v-if="selectedEpisodeImage && !previewImageFailed"
            :key="selectedEpisodeImage"
            :class="{ loaded: previewImageLoaded }"
            :src="selectedEpisodeImage"
            alt=""
            @error="handlePreviewImageError"
            @load="handlePreviewImageLoad" />
          <span v-if="!selectedEpisodeImage || previewImageFailed" class="episode-preview-empty"><Film :size="34" /></span>
        </div>
        <div class="episode-preview-copy" @click="handlePreviewContentClick">
          <span>
            第 {{ selectedSeasonNumber }} 季 · 第 {{ selectedEpisodeNumber }} 集
            <template v-if="selectedEpisodeAirDate">· {{ selectedEpisodeAirDate }}</template>
          </span>
          <h3>{{ selectedEpisode.episode_title || `第 ${selectedEpisodeNumber} 集` }}</h3>
          <button v-if="isMobile" class="episode-preview-description" type="button" @click.stop="descriptionOpen = true">
            <span>{{ selectedEpisode.episode_description || '暂无简介' }}</span>
          </button>
          <p v-else>{{ selectedEpisode.episode_description || '暂无简介' }}</p>
        </div>
      </section>
      <aside aria-labelledby="switcher-title" aria-modal="true" class="switcher-panel" role="dialog">
        <header class="switcher-header">
          <div ref="swipeHandle" aria-hidden="true" class="mobile-swipe-handle"><i></i></div>
          <div class="switcher-header-copy">
            <span>
              <Clapperboard :size="14" />
              选集
            </span>
            <h2 id="switcher-title">
              <strong>{{ title }}</strong>
              <small v-if="playingLabel">{{ playingLabel }}</small>
            </h2>
          </div>
          <button aria-label="关闭选集" type="button" @click="emit('close')"><X :size="20" /></button>
        </header>

        <div class="switcher-toolbar">
          <SeasonSelect v-if="seasons.length" :model-value="selectedSeasonNumber" :seasons="seasons" @select="emit('selectSeason', $event)" />
          <div aria-label="筛选剧集" class="episode-filter">
            <button :aria-pressed="filter === 'all'" :class="{ active: filter === 'all' }" type="button" @click="filter = 'all'">全部 {{ episodes.length }}</button>
            <button :aria-pressed="filter === 'available'" :class="{ active: filter === 'available' }" :disabled="!resourceResolved" type="button" @click="filter = 'available'">
              可播放 {{ availableEpisodeNumbers.length }}
            </button>
          </div>
          <EpisodeSortControl v-model="episodeSort" />
        </div>

        <div class="switcher-content">
          <div v-if="episodeLoading && !episodes.length" class="switcher-loading">
            <LoaderCircle :size="22" class="animate-spin" />
            正在读取剧集
          </div>
          <EpisodeGrid
            v-else-if="visibleEpisodes.length"
            :available-episode-numbers="availableEpisodeNumbers"
            :episodes="visibleEpisodes"
            :loading="false"
            :playing-episode-number="playingSeasonNumber === selectedSeasonNumber ? playingEpisodeNumber : null"
            :resource-error="resourceError"
            :resource-loading="resourceLoading"
            :resource-resolved="resourceResolved"
            :selected-episode-number="selectedEpisodeNumber"
            :signed-in="true"
            :sources="sources"
            @select="emit('selectEpisode', $event)" />
          <p v-else class="switcher-empty">{{ resourceError || '本季暂无剧集' }}</p>
        </div>

        <section v-if="selectedEpisodeNumber != null" class="switcher-selection">
          <div class="switcher-selection-copy">
            <span>
              第 {{ selectedSeasonNumber }} 季 · 第 {{ selectedEpisodeNumber }} 集
              <template v-if="selectedEpisodeAirDate">· {{ selectedEpisodeAirDate }}</template>
            </span>
            <h3>{{ activeEpisodeTitle || `第 ${selectedEpisodeNumber} 集` }}</h3>
          </div>
          <div v-if="partSources.length > 1" aria-label="选择分段" class="part-switcher">
            <button
              v-for="source in partSources"
              :key="source.part_number ?? 'full'"
              :class="{ active: source.part_number === selectedPartNumber }"
              type="button"
              @click="emit('selectPart', source.part_number)">
              {{ source.part_number == null ? '正片' : `分段 ${source.part_number}` }}
            </button>
          </div>
          <PlaybackSplitButton
            :can-play="Boolean(selectedMediaId) && !switching"
            :error="resourceError"
            :is-complete="selectedSource?.is_complete"
            :loading="resourceLoading || switching"
            :model-value="selectedMediaId"
            :resume-seconds="selectedSource?.play_seconds"
            :versions="versions"
            menu-direction="up"
            @play="emit('switch', $event)"
            @update:model-value="emit('selectMedia', $event)" />
        </section>
      </aside>

      <Transition name="description-sheet">
        <div v-if="descriptionOpen && selectedEpisode" class="description-sheet-backdrop" @click.self="descriptionOpen = false">
          <aside aria-labelledby="switcher-description-title" aria-modal="true" class="description-sheet" role="dialog">
            <header>
              <div>
                <span>第 {{ selectedSeasonNumber }} 季 · 第 {{ selectedEpisodeNumber }} 集</span>
                <h3 id="switcher-description-title">{{ selectedEpisode.episode_title || `第 ${selectedEpisodeNumber} 集` }}</h3>
              </div>
              <button aria-label="关闭简介" type="button" @click="descriptionOpen = false"><X :size="20" /></button>
            </header>
            <p>{{ selectedEpisode.episode_description || '暂无简介' }}</p>
          </aside>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
  .switcher-backdrop {
    position: fixed;
    z-index: 110;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    background: rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(5px);
  }
  .switcher-episode-preview {
    position: absolute;
    inset: 0 520px 0 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    gap: 22px;
    overflow-x: hidden;
    overflow-y: auto;
    padding: clamp(28px, 5vw, 72px);
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }
  .episode-preview-visual {
    position: relative;
    width: min(640px, 100%);
    overflow: hidden;
    aspect-ratio: 16 / 9;
    border-radius: 5px;
    background: var(--reel-surface);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
  }
  .episode-preview-visual img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transform: scale(1.02);
    transition:
      opacity 0.28s ease,
      transform 0.45s ease;
  }
  .episode-preview-visual img.loaded {
    opacity: 1;
    transform: scale(1);
  }
  .episode-preview-loading,
  .episode-preview-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.35);
  }
  .episode-preview-copy {
    width: min(640px, 100%);
  }
  .episode-preview-copy > span {
    color: var(--reel-film);
    font-size: 12px;
    font-weight: 700;
  }
  .episode-preview-copy h3 {
    margin: 8px 0 0;
    overflow-wrap: anywhere;
    color: white;
    font-size: clamp(24px, 2.4vw, 38px);
    font-weight: 680;
    line-height: 1.25;
    text-shadow: 0 3px 18px rgba(0, 0, 0, 0.7);
  }
  .episode-preview-copy p,
  .episode-preview-description {
    margin: 12px 0 0;
    color: rgba(255, 255, 255, 0.72);
    font-size: 15px;
    line-height: 1.75;
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.72);
  }
  .episode-preview-description {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
  }
  .mobile-swipe-handle {
    display: none;
  }
  .switcher-panel {
    position: relative;
    z-index: 1;
    display: grid;
    width: min(520px, 100%);
    height: 100%;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    overflow: visible;
    border-left: 1px solid var(--reel-line);
    background: var(--reel-surface);
    color: var(--reel-text);
    box-shadow: -26px 0 70px rgba(0, 0, 0, 0.48);
  }
  .switcher-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 24px;
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-raised);
  }
  .switcher-header-copy {
    min-width: 0;
  }
  .switcher-header span {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--reel-film);
    font-size: 12px;
    font-weight: 700;
  }
  .switcher-header h2 {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 9px;
    overflow: hidden;
    margin: 7px 0 0;
    font-size: 24px;
    font-weight: 680;
  }
  .switcher-header h2 strong {
    min-width: 0;
    overflow: hidden;
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .switcher-header h2 small {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.58);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .switcher-header > button {
    display: grid;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
  }
  .switcher-header > button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .switcher-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-raised);
  }
  .switcher-toolbar :deep(.episode-sort) {
    height: 44px;
  }
  .episode-filter {
    display: flex;
    min-width: 0;
    height: 44px;
    flex: 1;
    padding: 3px;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.12);
  }
  .episode-filter button {
    min-width: 0;
    flex: 1;
    padding: 0 7px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--reel-muted);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
  }
  .episode-filter button.active {
    background: var(--reel-accent-wash);
    color: var(--reel-accent-soft);
  }
  .switcher-content {
    overflow-y: auto;
    padding: 18px;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }
  .switcher-loading,
  .switcher-empty {
    display: flex;
    min-height: 150px;
    align-items: center;
    justify-content: center;
    gap: 9px;
    margin: 0;
    color: var(--reel-muted);
    font-size: 14px;
    text-align: center;
  }
  .switcher-selection {
    position: relative;
    z-index: 5;
    display: grid;
    justify-items: end;
    gap: 10px;
    padding: 14px 18px 18px;
    border-top: 1px solid var(--reel-line);
    background: var(--reel-surface-raised);
    box-shadow: 0 -14px 34px rgba(0, 0, 0, 0.22);
    overflow: visible;
  }
  .switcher-selection :deep(.playback-action) {
    width: 100%;
    min-width: 0;
  }
  .switcher-selection :deep(.version-menu) {
    width: 100%;
  }
  .switcher-selection-copy {
    display: none;
    width: 100%;
    min-width: 0;
  }
  .switcher-selection-copy span {
    color: var(--reel-film);
    font-size: 11px;
    font-weight: 700;
  }
  .switcher-selection h3 {
    margin: 6px 0 0;
    overflow-wrap: anywhere;
    font-size: 20px;
    font-weight: 650;
  }
  .part-switcher {
    display: flex;
    width: 100%;
    gap: 5px;
    overflow-x: auto;
  }
  .part-switcher button {
    min-height: 34px;
    padding: 0 10px;
    border: 1px solid var(--reel-line);
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
    font: inherit;
    font-size: 12px;
  }
  .part-switcher button.active {
    border-color: var(--reel-accent);
    background: var(--reel-accent-wash);
    color: var(--reel-accent-soft);
  }
  .description-sheet-backdrop {
    position: fixed;
    z-index: 4;
    inset: 0;
    display: flex;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }
  .description-sheet {
    display: grid;
    width: 100%;
    height: min(56svh, 560px);
    grid-template-rows: auto minmax(0, 1fr);
    border-top: 1px solid var(--reel-line);
    border-radius: 7px 7px 0 0;
    background: var(--reel-surface-raised);
    box-shadow: 0 -22px 62px rgba(0, 0, 0, 0.5);
  }
  .description-sheet header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-elevated);
  }
  .description-sheet header > div {
    min-width: 0;
  }
  .description-sheet header span {
    color: var(--reel-film);
    font-size: 11px;
    font-weight: 700;
  }
  .description-sheet h3 {
    margin: 5px 0 0;
    overflow: hidden;
    font-size: 20px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .description-sheet header button {
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
  }
  .description-sheet header button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .description-sheet > p {
    overflow-y: auto;
    margin: 0;
    padding: 20px;
    color: var(--reel-text-secondary);
    font-size: 14px;
    line-height: 1.85;
  }
  .description-sheet-enter-active,
  .description-sheet-leave-active {
    transition: opacity 0.18s ease;
  }
  .description-sheet-enter-active .description-sheet,
  .description-sheet-leave-active .description-sheet {
    transition: transform 0.24s cubic-bezier(0.22, 0.72, 0.25, 1);
  }
  .description-sheet-enter-from,
  .description-sheet-leave-to {
    opacity: 0;
  }
  .description-sheet-enter-from .description-sheet,
  .description-sheet-leave-to .description-sheet {
    transform: translateY(100%);
  }
  .episode-switcher-enter-active,
  .episode-switcher-leave-active {
    transition: opacity 0.22s ease;
  }
  .episode-switcher-enter-active .switcher-panel,
  .episode-switcher-leave-active .switcher-panel {
    transition: transform 0.28s cubic-bezier(0.22, 0.72, 0.25, 1);
  }
  .episode-switcher-enter-from,
  .episode-switcher-leave-to {
    opacity: 0;
  }
  .episode-switcher-enter-from .switcher-panel,
  .episode-switcher-leave-to .switcher-panel {
    transform: translateX(100%);
  }

  @media (min-width: 621px) and (max-width: 960px) {
    .switcher-episode-preview {
      display: none;
    }
    .switcher-selection-copy {
      display: block;
    }
  }

  @media (max-width: 620px) {
    .switcher-backdrop {
      align-items: flex-end;
    }
    .switcher-episode-preview {
      inset: 0 0 70svh;
      display: block;
      overflow: hidden;
      padding: 0;
    }
    .episode-preview-visual {
      position: absolute;
      inset: 0;
      width: 100%;
      border-radius: 0;
      box-shadow: none;
    }
    .episode-preview-visual::after {
      position: absolute;
      inset: 30% 0 0;
      background: linear-gradient(0deg, rgba(17, 19, 18, 0.96), rgba(17, 19, 18, 0.44), transparent);
      content: '';
    }
    .episode-preview-copy {
      position: absolute;
      z-index: 1;
      right: 16px;
      bottom: 12px;
      left: 16px;
      width: auto;
    }
    .episode-preview-copy > span {
      font-size: 10px;
    }
    .episode-preview-copy h3 {
      display: -webkit-box;
      overflow: hidden;
      margin-top: 4px;
      font-size: 17px;
      line-height: 1.25;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
    }
    .episode-preview-description {
      margin-top: 5px;
      font-size: 11px;
      line-height: 1.45;
    }
    .episode-preview-description span {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .switcher-panel {
      width: 100%;
      height: 70svh;
      border-top: 1px solid rgba(255, 255, 255, 0.16);
      border-left: 0;
      border-radius: 7px 7px 0 0;
      box-shadow: 0 -22px 60px rgba(0, 0, 0, 0.46);
    }
    .switcher-header {
      padding: 22px 18px 16px;
    }
    .mobile-swipe-handle {
      position: absolute;
      top: 0;
      left: 50%;
      display: grid;
      width: 88px;
      height: 24px;
      place-items: center;
      transform: translateX(-50%);
      touch-action: pan-y;
    }
    .mobile-swipe-handle i {
      width: 38px;
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.3);
    }
    .switcher-header h2 {
      font-size: 20px;
    }
    .switcher-header h2 small {
      font-size: 12px;
    }
    .switcher-toolbar {
      padding: 10px 12px;
    }
    .switcher-toolbar :deep(.episode-sort) {
      height: 40px;
    }
    .episode-filter {
      height: 40px;
    }
    .episode-filter button {
      padding: 0 4px;
      font-size: 12px;
    }
    .switcher-content {
      padding: 14px 12px 20px;
    }
    .switcher-selection {
      justify-items: stretch;
      padding: 12px;
    }
    .episode-switcher-enter-from .switcher-panel,
    .episode-switcher-leave-to .switcher-panel {
      transform: translateY(100%);
    }
  }
</style>
