<script lang="ts" setup>
  import dayjs from 'dayjs'
  import { AlertCircle, LoaderCircle, LockKeyhole } from '@lucide/vue'
  import { computed, nextTick, ref, watch } from 'vue'
  import type { EpisodeInfo, MediaSource } from '@/api/types'
  import { calculateWatchPercent } from '@/utils/playback-progress'

  const props = defineProps<{
    episodes: EpisodeInfo[]
    selectedEpisodeNumber: number | null
    playingEpisodeNumber?: number | null
    availableEpisodeNumbers: number[]
    sources: MediaSource[]
    loading: boolean
    signedIn: boolean
    resourceLoading: boolean
    resourceResolved: boolean
    resourceError: string
  }>()

  const emit = defineEmits<{ select: [episodeNumber: number] }>()
  const gridElement = ref<HTMLElement>()
  const available = computed(() => new Set(props.availableEpisodeNumbers))
  const progressByEpisode = computed(() => {
    const latestSources = new Map<number, MediaSource>()
    for (const source of props.sources) {
      if (source.episode_number == null) continue
      const current = latestSources.get(source.episode_number)
      const sourceTime = source.last_played && dayjs(source.last_played).isValid() ? dayjs(source.last_played).valueOf() : 0
      const currentTime = current?.last_played && dayjs(current.last_played).isValid() ? dayjs(current.last_played).valueOf() : 0
      if (!current || sourceTime >= currentTime) latestSources.set(source.episode_number, source)
    }

    return new Map(
      [...latestSources].map(([episodeNumber, source]) => {
        const playSeconds = Math.max(0, source.play_seconds ?? 0)
        const duration = Math.max(0, ...source.versions.map((version) => version.media_second || 0))
        const percent = calculateWatchPercent(playSeconds, duration, source.is_complete)
        return [
          episodeNumber,
          {
            complete: source.is_complete,
            started: source.is_complete || playSeconds > 0,
            percent,
          },
        ] as const
      }),
    )
  })

  function episodeProgress(episodeNumber: number) {
    return progressByEpisode.value.get(episodeNumber)
  }

  watch(
    () => props.selectedEpisodeNumber,
    (episodeNumber) => {
      if (episodeNumber == null) return
      void nextTick(() => {
        gridElement.value?.querySelector<HTMLElement>(`[data-episode-number="${episodeNumber}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    },
    { immediate: true },
  )
</script>

<template>
  <div ref="gridElement" :aria-busy="loading" class="episode-grid">
    <template v-if="loading">
      <span v-for="index in 12" :key="index" class="episode-skeleton"></span>
    </template>
    <button
      v-for="episode in episodes"
      v-else
      :key="episode.episode_id"
      :aria-label="`第 ${episode.episode_number} 集，${episode.episode_title}${episodeProgress(episode.episode_number)?.complete ? '，已看完' : episodeProgress(episode.episode_number)?.started ? `，已观看 ${episodeProgress(episode.episode_number)?.percent}%` : ''}`"
      :class="{
        active: episode.episode_number === selectedEpisodeNumber,
        playing: episode.episode_number === playingEpisodeNumber,
        unavailable: resourceResolved && !available.has(episode.episode_number),
      }"
      :data-episode-number="episode.episode_number"
      class="episode-cell"
      type="button"
      @click="emit('select', episode.episode_number)">
      <span class="episode-prefix">EP</span>
      <strong>{{ String(episode.episode_number).padStart(2, '0') }}</strong>
      <span class="episode-status">
        <template v-if="!signedIn">
          <LockKeyhole :size="11" />
          登录后查看
        </template>
        <template v-else-if="episode.episode_number === playingEpisodeNumber">
          <i class="playing-dot"></i>
          播放中
        </template>
        <template v-else-if="resourceLoading">
          <LoaderCircle :size="11" class="animate-spin" />
          匹配中
        </template>
        <template v-else-if="resourceError">
          <AlertCircle :size="11" />
          片源未知
        </template>
        <template v-else-if="episodeProgress(episode.episode_number)?.complete">
          <i class="complete-dot"></i>
          已看完
        </template>
        <template v-else-if="episodeProgress(episode.episode_number)?.started">
          <i class="progress-dot"></i>
          已看 {{ episodeProgress(episode.episode_number)?.percent }}%
        </template>
        <template v-else-if="available.has(episode.episode_number)">
          <i class="available-dot"></i>
          可播放
        </template>
        <template v-else>
          <i></i>
          暂无片源
        </template>
      </span>
      <span v-if="episodeProgress(episode.episode_number)?.started" :class="{ complete: episodeProgress(episode.episode_number)?.complete }" aria-hidden="true" class="episode-progress">
        <i :style="{ width: `${episodeProgress(episode.episode_number)?.percent ?? 0}%` }"></i>
      </span>
    </button>
  </div>
</template>

<style scoped>
  .episode-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
  }
  .episode-cell,
  .episode-skeleton {
    min-width: 0;
    height: 84px;
    border-radius: 4px;
  }
  .episode-cell {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: 1fr auto;
    align-items: baseline;
    gap: 2px 7px;
    padding: 11px 12px 9px;
    border: 1px solid var(--reel-line);
    background: rgba(255, 255, 255, 0.04);
    color: var(--reel-text);
    font: inherit;
    text-align: left;
    transition:
      border-color 0.16s ease,
      background-color 0.16s ease,
      opacity 0.16s ease;
  }
  .episode-cell:hover {
    border-color: var(--reel-line-strong);
    background: var(--reel-hover);
  }
  .episode-cell.active {
    border-color: var(--reel-accent);
    background: var(--reel-accent-wash);
  }
  .episode-cell.playing:not(.active) {
    border-color: rgba(219, 197, 139, 0.42);
    background: var(--reel-film-wash);
  }
  .episode-cell.unavailable {
    opacity: 0.46;
  }
  .episode-cell.unavailable:hover,
  .episode-cell.unavailable.active {
    opacity: 0.78;
  }
  .episode-prefix {
    align-self: center;
    color: var(--reel-muted);
    font-size: 10px;
    font-weight: 750;
  }
  .episode-cell strong {
    align-self: center;
    font-size: 26px;
    font-weight: 720;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .episode-status {
    display: flex;
    grid-column: 1 / -1;
    min-width: 0;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.56);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .episode-status i {
    width: 5px;
    height: 5px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.28);
  }
  .episode-status .available-dot {
    background: var(--reel-accent);
    box-shadow: 0 0 0 3px rgba(112, 183, 173, 0.12);
  }
  .episode-status .playing-dot {
    background: var(--reel-film);
    box-shadow: 0 0 0 3px var(--reel-film-wash);
  }
  .episode-status .progress-dot {
    background: var(--reel-accent-soft);
  }
  .episode-status .complete-dot {
    background: var(--reel-film);
  }
  .episode-progress {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
    overflow: hidden;
    border-radius: 0 0 3px 3px;
    background: rgba(255, 255, 255, 0.11);
  }
  .episode-progress > i {
    display: block;
    height: 100%;
    background: var(--reel-accent);
  }
  .episode-progress.complete > i {
    background: var(--reel-film);
  }
  .episode-skeleton {
    background: linear-gradient(100deg, rgba(255, 255, 255, 0.035) 25%, rgba(255, 255, 255, 0.08) 45%, rgba(255, 255, 255, 0.035) 65%);
    background-size: 220% 100%;
    animation: skeleton-shift 1.3s ease-in-out infinite;
  }
  @keyframes skeleton-shift {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (max-width: 600px) {
    .episode-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
    }
    .episode-cell,
    .episode-skeleton {
      height: 72px;
    }
    .episode-cell {
      padding: 9px 8px 8px;
    }
    .episode-cell strong {
      font-size: 20px;
    }
    .episode-prefix {
      font-size: 9px;
    }
    .episode-status {
      gap: 4px;
      font-size: 9px;
    }
  }
</style>
