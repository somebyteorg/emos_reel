<script lang="ts" setup>
  import { CalendarDays, Clapperboard, Clock3, Film, LoaderCircle, LockKeyhole, X } from '@lucide/vue'
  import { useEventListener, useScrollLock } from '@vueuse/core'
  import { computed, ref, watch } from 'vue'
  import EpisodeGrid from '@/components/EpisodeGrid.vue'
  import EpisodeSortControl from '@/components/EpisodeSortControl.vue'
  import PlaybackSplitButton from '@/components/PlaybackSplitButton.vue'
  import SeasonSelect from '@/components/SeasonSelect.vue'
  import type { EpisodeInfo, MediaSource, MediaVersion, SeasonInfo } from '@/api/types'

  const props = defineProps<{
    open: boolean
    isTv: boolean
    seasons: SeasonInfo[]
    selectedSeasonNumber: number | null
    episodes: EpisodeInfo[]
    selectedEpisode?: EpisodeInfo
    selectedEpisodeNumber: number | null
    sources: MediaSource[]
    availableEpisodeNumbers: number[]
    episodeLoading: boolean
    signedIn: boolean
    resourceLoading: boolean
    resourceResolved: boolean
    resourceError: string
    title: string
    activeTitle: string
    description: string
    previewImage: string | null
    airDateLabel: string
    runtimeLabel: string
    partSources: MediaSource[]
    selectedPartNumber: number | null
    versions: MediaVersion[]
    selectedMediaId: string
    canPlay: boolean
  }>()

  const emit = defineEmits<{
    close: []
    login: []
    selectSeason: [seasonNumber: number]
    selectEpisode: [episodeNumber: number]
    selectPart: [partNumber: number | null]
    selectMedia: [mediaId: string]
    play: [fromStart: boolean]
  }>()

  const filter = ref<'all' | 'available'>('all')
  const episodeSort = ref<'asc' | 'desc'>('asc')
  const descriptionOpen = ref(false)
  const previewImageLoaded = ref(false)
  const previewImageFailed = ref(false)
  const bodyLocked = useScrollLock(document.body)
  const available = computed(() => new Set(props.availableEpisodeNumbers))
  const visibleEpisodes = computed(() => {
    const filteredEpisodes = filter.value === 'available' ? props.episodes.filter((episode) => available.value.has(episode.episode_number)) : props.episodes
    const direction = episodeSort.value === 'asc' ? 1 : -1
    return [...filteredEpisodes].sort((a, b) => (a.episode_number - b.episode_number) * direction)
  })
  const selectedSource = computed(() => props.partSources.find((source) => source.part_number === props.selectedPartNumber) ?? props.partSources[0])

  function handlePreviewImageLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement
    if (image.getAttribute('src') !== props.previewImage) return
    previewImageLoaded.value = true
  }

  function handlePreviewImageError(event: Event) {
    const image = event.currentTarget as HTMLImageElement
    if (image.getAttribute('src') !== props.previewImage) return
    previewImageFailed.value = true
  }

  watch(
    () => props.open,
    (open) => {
      bodyLocked.value = open
      if (open) filter.value = 'all'
      else descriptionOpen.value = false
    },
    { immediate: true },
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
    () => props.previewImage,
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
  <Teleport to="body">
    <Transition name="picker-drawer">
      <div v-if="open" class="picker-backdrop" @click.self="emit('close')">
        <section :class="{ movie: !isTv }" aria-labelledby="picker-title" aria-modal="true" class="picker-drawer" role="dialog">
          <header class="picker-header">
            <div class="picker-heading">
              <span class="section-kicker">
                <Clapperboard :size="14" />
                {{ isTv ? '选择剧集' : '选择版本' }}
              </span>
              <h2 id="picker-title">{{ isTv ? (selectedSeasonNumber == null ? '正在读取剧集' : `第 ${selectedSeasonNumber} 季`) : title }}</h2>
            </div>

            <div class="picker-header-actions">
              <SeasonSelect
                v-if="isTv && seasons.length"
                :class="{ 'single-season': seasons.length === 1 }"
                :model-value="selectedSeasonNumber"
                :seasons="seasons"
                class="season-select"
                @select="emit('selectSeason', $event)" />
              <div v-if="isTv" aria-label="筛选剧集" class="episode-filter">
                <button :aria-pressed="filter === 'all'" :class="{ active: filter === 'all' }" type="button" @click="filter = 'all'">全部 {{ episodes.length }}</button>
                <button :aria-pressed="filter === 'available'" :class="{ active: filter === 'available' }" :disabled="!resourceResolved" type="button" @click="filter = 'available'">
                  可播放 {{ availableEpisodeNumbers.length }}
                </button>
              </div>
              <button aria-label="关闭" class="picker-close" type="button" @click="emit('close')"><X :size="20" /></button>
            </div>
          </header>

          <section class="selection-preview">
            <div class="preview-art">
              <span v-if="previewImage && !previewImageLoaded && !previewImageFailed" aria-hidden="true" class="preview-art-loading"><LoaderCircle :size="22" class="animate-spin" /></span>
              <img
                v-if="previewImage && !previewImageFailed"
                :key="previewImage"
                :alt="activeTitle"
                :class="{ loaded: previewImageLoaded }"
                :src="previewImage"
                @error="handlePreviewImageError"
                @load="handlePreviewImageLoad" />
              <span v-if="!previewImage || previewImageFailed" class="preview-art-empty"><Film :size="30" /></span>
            </div>
            <div class="preview-copy">
              <div class="preview-heading">
                <div class="preview-meta">
                  <span v-if="isTv && selectedEpisodeNumber != null">S{{ selectedSeasonNumber }} · E{{ selectedEpisodeNumber }}</span>
                  <span v-if="airDateLabel">
                    <CalendarDays :size="13" />
                    {{ airDateLabel }}
                  </span>
                  <span v-if="runtimeLabel">
                    <Clock3 :size="13" />
                    {{ runtimeLabel }}
                  </span>
                </div>
                <h3>{{ activeTitle }}</h3>
              </div>
              <button aria-label="查看完整简介" class="preview-description" type="button" @click="descriptionOpen = true">
                <span>{{ description || '暂无简介' }}</span>
              </button>
            </div>
            <div class="preview-actions">
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
                :can-play="canPlay"
                :error="resourceError"
                :is-complete="selectedSource?.is_complete"
                :loading="resourceLoading"
                :menu-direction="isTv ? 'down' : 'up'"
                :model-value="selectedMediaId"
                :resume-seconds="selectedSource?.play_seconds"
                :versions="versions"
                @play="emit('play', $event)"
                @update:model-value="emit('selectMedia', $event)" />
            </div>
          </section>

          <div v-if="!signedIn || isTv" class="picker-content">
            <div v-if="!signedIn" class="login-notice">
              <LockKeyhole :size="18" />
              <span>请登录后再进行观看</span>
              <button type="button" @click="emit('login')">登录</button>
            </div>

            <section v-if="isTv" class="episode-section">
              <header>
                <strong>剧集</strong>
                <div class="episode-section-actions">
                  <span>{{ filter === 'available' ? `${visibleEpisodes.length} 集可播放` : `共 ${episodes.length} 集` }}</span>
                  <EpisodeSortControl v-model="episodeSort" />
                </div>
              </header>
              <EpisodeGrid
                v-if="visibleEpisodes.length || episodeLoading"
                :available-episode-numbers="availableEpisodeNumbers"
                :episodes="visibleEpisodes"
                :loading="episodeLoading"
                :resource-error="resourceError"
                :resource-loading="resourceLoading"
                :resource-resolved="resourceResolved"
                :selected-episode-number="selectedEpisodeNumber"
                :signed-in="signedIn"
                :sources="sources"
                @select="emit('selectEpisode', $event)" />
              <p v-else class="episode-empty">本季还没有可播放剧集</p>
            </section>
          </div>

          <Transition name="episode-description">
            <div v-if="descriptionOpen" class="episode-description-layer" @click.self="descriptionOpen = false">
              <aside aria-labelledby="episode-description-title" aria-modal="true" class="episode-description-panel" role="dialog">
                <header>
                  <div class="episode-description-heading">
                    <span>{{ isTv ? '剧集简介' : '影片简介' }}</span>
                    <h3 id="episode-description-title">{{ activeTitle }}</h3>
                  </div>
                  <button aria-label="关闭简介" type="button" @click="descriptionOpen = false"><X :size="20" /></button>
                </header>
                <p>{{ description || '暂无简介' }}</p>
              </aside>
            </div>
          </Transition>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
  .picker-backdrop {
    position: fixed;
    z-index: 90;
    inset: 0;
    display: flex;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.46);
    backdrop-filter: blur(5px);
  }
  .picker-drawer {
    position: relative;
    display: grid;
    width: 100%;
    height: min(84svh, 820px);
    grid-template-rows: auto auto minmax(0, 1fr);
    overflow: hidden;
    border-top: 1px solid var(--reel-line-strong);
    background: var(--reel-surface-overlay);
    color: var(--reel-text);
    box-shadow: 0 -26px 70px rgba(0, 0, 0, 0.42);
  }
  .picker-drawer.movie {
    height: auto;
    max-height: min(64svh, 560px);
    grid-template-rows: auto auto;
    overflow: visible;
  }
  .picker-header {
    display: flex;
    min-height: 96px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 18px clamp(20px, 5vw, 72px);
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-raised);
  }
  .picker-heading {
    min-width: 0;
  }
  .section-kicker {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--reel-accent-soft);
    font-size: 12px;
    font-weight: 700;
  }
  .picker-header h2 {
    overflow: hidden;
    margin: 7px 0 0;
    font-size: 27px;
    font-weight: 650;
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-header-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }
  .season-select.single-season {
    display: none;
  }
  .episode-filter {
    display: flex;
    height: 44px;
    padding: 3px;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.12);
  }
  .episode-filter button {
    min-width: 100px;
    padding: 0 11px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--reel-muted);
    font: inherit;
    font-size: 14px;
    white-space: nowrap;
  }
  .episode-filter button.active {
    background: var(--reel-accent-wash);
    color: var(--reel-accent-soft);
  }
  .episode-filter button:disabled {
    opacity: 0.35;
  }
  .picker-close {
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--reel-line);
    border-radius: 4px;
    background: var(--reel-hover);
    color: var(--reel-muted);
  }
  .picker-close:hover {
    border-color: var(--reel-line-strong);
    background: var(--reel-accent-wash);
    color: white;
  }
  .picker-content {
    position: relative;
    z-index: 1;
    overflow-y: auto;
    padding: 20px clamp(20px, 5vw, 72px) 30px;
    background: var(--reel-surface);
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }
  .login-notice {
    display: flex;
    min-height: 52px;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    padding: 0 15px;
    border-left: 2px solid var(--reel-accent);
    background: var(--reel-accent-wash);
    color: rgba(255, 255, 255, 0.82);
    font-size: 15px;
  }
  .login-notice button {
    margin-left: auto;
    padding: 7px 9px;
    border: 0;
    background: transparent;
    color: white;
    font: inherit;
    font-size: 15px;
    font-weight: 700;
  }
  .selection-preview {
    position: relative;
    z-index: 3;
    display: grid;
    grid-template-columns: minmax(210px, 300px) minmax(0, 1fr) auto;
    align-items: start;
    gap: clamp(18px, 2.5vw, 36px);
    padding: 20px clamp(20px, 5vw, 72px);
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-elevated);
  }
  .preview-art {
    position: relative;
    display: grid;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    align-self: center;
    place-items: center;
    border-radius: 4px;
    background: var(--reel-surface);
    color: rgba(255, 255, 255, 0.28);
  }
  .preview-art img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transform: scale(1.025);
    transition:
      opacity 0.28s ease,
      transform 0.5s cubic-bezier(0.2, 0.65, 0.35, 1);
  }
  .preview-art img.loaded {
    opacity: 1;
    transform: scale(1);
  }
  .preview-art-loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.46);
  }
  .preview-art-loading::before {
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, rgba(255, 255, 255, 0.025) 25%, rgba(255, 255, 255, 0.11) 45%, rgba(255, 255, 255, 0.025) 65%);
    background-size: 220% 100%;
    animation: preview-art-shimmer 1.25s ease-in-out infinite;
    content: '';
  }
  .preview-art-loading svg {
    position: relative;
    z-index: 1;
  }
  .preview-art-empty {
    display: grid;
    place-items: center;
  }
  @keyframes preview-art-shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  .preview-copy {
    min-width: 0;
  }
  .preview-heading {
    min-width: 0;
  }
  .preview-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px 15px;
    color: var(--reel-film);
    font-size: 13px;
    font-weight: 700;
  }
  .preview-meta span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .preview-copy h3 {
    margin: 10px 0 0;
    overflow-wrap: anywhere;
    font-size: 27px;
    font-weight: 680;
    letter-spacing: 0;
  }
  .preview-description {
    display: block;
    width: min(780px, 100%);
    margin: 11px 0 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.74);
    font: inherit;
    font-size: 16px;
    line-height: 1.7;
    text-align: left;
  }
  .preview-description span {
    display: -webkit-box;
    overflow: hidden;
    transition: color 0.16s ease;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .preview-description:hover span {
    color: rgba(255, 255, 255, 0.92);
  }
  .preview-actions {
    display: grid;
    min-width: 250px;
    align-self: center;
    justify-items: end;
    gap: 8px;
    padding-top: 0;
  }
  .episode-section {
    margin-top: 0;
  }
  .episode-section > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .episode-section > header strong {
    font-size: 17px;
    font-weight: 680;
  }
  .episode-section-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .episode-section-actions > span {
    color: var(--reel-muted);
    font-size: 13px;
  }
  .episode-empty {
    min-height: 100px;
    margin: 0;
    padding-top: 30px;
    color: var(--reel-muted);
    font-size: 14px;
    text-align: center;
  }
  .part-switcher {
    display: flex;
    gap: 5px;
    overflow-x: auto;
  }
  .part-switcher button {
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid var(--reel-line);
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
    font: inherit;
    font-size: 13px;
  }
  .part-switcher button.active {
    border-color: var(--reel-accent);
    background: var(--reel-accent-wash);
    color: var(--reel-accent-soft);
  }
  .episode-description-layer {
    position: absolute;
    z-index: 20;
    inset: 0;
    display: flex;
    overflow: hidden;
    justify-content: flex-end;
    background: rgba(8, 9, 12, 0.5);
    backdrop-filter: blur(4px);
  }
  .episode-description-panel {
    display: grid;
    width: min(560px, 100%);
    height: 100%;
    grid-template-rows: auto minmax(0, 1fr);
    border-left: 1px solid var(--reel-line);
    background: var(--reel-surface-raised);
    box-shadow: -24px 0 64px rgba(0, 0, 0, 0.4);
  }
  .episode-description-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 24px 28px;
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-elevated);
  }
  .episode-description-heading {
    min-width: 0;
  }
  .episode-description-heading span {
    color: var(--reel-film);
    font-size: 12px;
    font-weight: 700;
  }
  .episode-description-heading h3 {
    margin: 7px 0 0;
    overflow-wrap: anywhere;
    font-size: 27px;
    font-weight: 650;
  }
  .episode-description-panel header button {
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
  .episode-description-panel header button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .episode-description-panel > p {
    overflow-y: auto;
    margin: 0;
    padding: 28px;
    color: var(--reel-text-secondary);
    font-size: 16px;
    line-height: 1.9;
  }
  .episode-description-enter-active,
  .episode-description-leave-active {
    transition: opacity 0.2s ease;
  }
  .episode-description-enter-active .episode-description-panel,
  .episode-description-leave-active .episode-description-panel {
    transition: transform 0.26s cubic-bezier(0.22, 0.72, 0.25, 1);
  }
  .episode-description-enter-from,
  .episode-description-leave-to {
    opacity: 0;
  }
  .episode-description-enter-from .episode-description-panel,
  .episode-description-leave-to .episode-description-panel {
    transform: translateX(100%);
  }
  .picker-drawer-enter-active,
  .picker-drawer-leave-active {
    transition: opacity 0.22s ease;
  }
  .picker-drawer-enter-active .picker-drawer,
  .picker-drawer-leave-active .picker-drawer {
    transition: transform 0.28s cubic-bezier(0.22, 0.72, 0.25, 1);
  }
  .picker-drawer-enter-from,
  .picker-drawer-leave-to {
    opacity: 0;
  }
  .picker-drawer-enter-from .picker-drawer,
  .picker-drawer-leave-to .picker-drawer {
    transform: translateY(100%);
  }
  @media (min-width: 621px) {
    .picker-drawer.movie .episode-description-layer {
      position: fixed;
      align-items: stretch;
      justify-content: flex-end;
      background: rgba(8, 9, 12, 0.62);
      backdrop-filter: blur(8px);
    }
    .picker-drawer.movie .episode-description-panel {
      width: min(600px, 100%);
      height: 100%;
      max-height: none;
      border: 0;
      border-left: 1px solid var(--reel-line-strong);
      border-radius: 0;
      box-shadow: -28px 0 80px rgba(0, 0, 0, 0.52);
    }
  }
  @media (max-width: 860px) {
    .picker-drawer {
      height: 94svh;
    }
    .picker-drawer.movie {
      height: auto;
      max-height: 94svh;
    }
    .picker-header {
      align-items: flex-start;
    }
    .picker-header-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .selection-preview {
      grid-template-columns: 180px minmax(0, 1fr);
      align-items: start;
    }
    .preview-actions {
      grid-column: 2;
      grid-row: 2;
      justify-items: start;
    }
  }
  @media (max-width: 620px) {
    .picker-drawer:not(.movie) .picker-header {
      display: grid;
      min-height: 96px;
      grid-template-columns: minmax(0, 1fr);
      align-content: center;
      align-items: start;
      gap: 9px;
      padding-top: 12px;
      padding-bottom: 12px;
    }
    .picker-drawer:not(.movie) .picker-heading {
      max-width: 100%;
      padding-top: 0;
    }
    .section-kicker {
      gap: 5px;
      font-size: 11px;
      white-space: nowrap;
    }
    .picker-header h2 {
      max-width: 100%;
      font-size: 20px;
    }
    .picker-drawer:not(.movie) .picker-header h2 {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      margin: -1px;
      padding: 0;
      border: 0;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
    .picker-drawer:not(.movie) .picker-header-actions {
      width: 100%;
      max-width: none;
      flex-wrap: nowrap;
      justify-content: stretch;
      gap: 6px;
    }
    .picker-drawer.movie .picker-heading {
      max-width: calc(100% - 50px);
    }
    .picker-drawer.movie .picker-header h2 {
      max-width: 100%;
    }
    .picker-drawer.movie .picker-header-actions {
      width: auto;
    }
    .picker-drawer:not(.movie) .season-select {
      display: block;
      min-width: 0;
      flex: 0 1 88px;
    }
    .episode-filter {
      width: auto;
      min-width: 0;
      height: 40px;
      flex: 1 1 auto;
      order: initial;
    }
    .episode-filter button {
      min-width: 0;
      flex: 1;
      padding: 0 4px;
      font-size: 12px;
    }
    .picker-content {
      padding-top: 16px;
      padding-bottom: 20px;
    }
    .selection-preview {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
      gap: 12px;
      padding-top: 14px;
      padding-bottom: 14px;
    }
    .preview-art {
      width: 100%;
      grid-column: 1;
      grid-row: 1;
    }
    .preview-art::after {
      position: absolute;
      z-index: 1;
      right: 0;
      bottom: 0;
      left: 0;
      height: 68%;
      background: linear-gradient(0deg, rgba(17, 19, 18, 0.92) 0%, rgba(17, 19, 18, 0.56) 48%, transparent 100%);
      content: '';
      pointer-events: none;
    }
    .preview-art-loading {
      z-index: 3;
    }
    .preview-copy {
      display: contents;
    }
    .preview-heading {
      position: relative;
      z-index: 2;
      align-self: end;
      grid-column: 1;
      grid-row: 1;
      padding: 0 15px 14px;
      pointer-events: none;
    }
    .login-notice {
      min-height: 48px;
      padding: 0 12px;
      font-size: 13px;
    }
    .login-notice button {
      font-size: 13px;
    }
    .preview-copy h3 {
      display: -webkit-box;
      overflow: hidden;
      margin-top: 7px;
      font-size: 20px;
      line-height: 1.25;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .preview-description {
      width: 100%;
      grid-column: 1;
      grid-row: 2;
      margin-top: 0;
      font-size: 14px;
      line-height: 1.6;
    }
    .preview-description span {
      -webkit-line-clamp: 2;
    }
    .preview-meta {
      font-size: 11px;
    }
    .preview-actions {
      width: 100%;
      min-width: 0;
      grid-column: 1;
      grid-row: 3;
      justify-items: stretch;
    }
    .episode-section {
      margin-top: 18px;
    }
    .episode-section > header strong {
      font-size: 15px;
    }
    .episode-section-actions {
      gap: 7px;
    }
    .episode-section-actions > span {
      font-size: 12px;
    }
    .episode-empty {
      font-size: 13px;
    }
    .part-switcher button {
      min-height: 34px;
      padding: 0 10px;
      font-size: 12px;
    }
    .picker-content {
      padding-top: 16px;
    }
    .episode-description-layer {
      align-items: flex-end;
    }
    .episode-description-panel {
      width: 100%;
      height: min(52svh, 520px);
      border-top: 1px solid rgba(255, 255, 255, 0.16);
      border-left: 0;
      border-radius: 7px 7px 0 0;
      box-shadow: 0 -20px 54px rgba(0, 0, 0, 0.42);
    }
    .picker-drawer.movie .episode-description-panel {
      height: 100%;
      max-height: none;
    }
    .episode-description-panel header {
      padding: 20px;
    }
    .episode-description-heading h3 {
      font-size: 22px;
    }
    .episode-description-panel > p {
      padding: 20px;
      font-size: 15px;
      line-height: 1.8;
    }
    .episode-description-enter-from .episode-description-panel,
    .episode-description-leave-to .episode-description-panel {
      transform: translateY(100%);
    }
  }
</style>
