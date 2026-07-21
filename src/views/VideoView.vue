<script lang="ts" setup>
import dayjs from 'dayjs'
import durationPlugin from 'dayjs/plugin/duration'
import { AlertCircle, Check, ListVideo, LoaderCircle, LockKeyhole, Play, RefreshCw, Share2 } from '@lucide/vue'
import {
  useClipboard,
  useDocumentVisibility,
  usePreferredReducedMotion,
  useResizeObserver,
  useTimeoutPoll
} from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import DescriptionDrawer from '@/components/DescriptionDrawer.vue'
import SourcePickerDrawer from '@/components/SourcePickerDrawer.vue'
import { getMediaSources, getRandomReel, getReelInfo } from '@/api/emos'
import { getEpisodes, getSeasons, getVideo, getVideoDictionary, getVideoImages, imageUrl } from '@/api/todb'
import type {
  EpisodeInfo,
  MediaSource,
  ReelInfo,
  ReelVideoRecord,
  SeasonInfo,
  VideoDictionary,
  VideoImage,
  VideoInfo
} from '@/api/types'
import { pickPreferredMediaVersion, useMediaSourceSelection } from '@/composables/useMediaSourceSelection'
import { useUserBase } from '@/composables/useUserBase'
import { useSignStore } from '@/stores/sign'
import { cachePlayerContext } from '@/utils/player-context'
import { calculateWatchPercent } from '@/utils/playback-progress'

dayjs.extend(durationPlugin)

  const route = useRoute()
  const router = useRouter()
  const signStore = useSignStore()
  useUserBase()

  const reel = ref<ReelInfo>()
  const video = ref<VideoInfo>()
  const images = ref<VideoImage[]>([])
  const dictionary = ref<VideoDictionary>()
  const seasons = ref<SeasonInfo[]>([])
  const episodes = ref<EpisodeInfo[]>([])
  const sources = ref<MediaSource[]>([])
  const selectedSeasonNumber = ref<number | null>(null)
  const selectedEpisodeNumber = ref<number | null>(null)
  const selectedPartNumber = ref<number | null>(null)
  const selectedMediaId = ref('')
  const pickerOpen = ref(false)
  const descriptionOpen = ref(false)
  const overviewText = ref<HTMLElement>()
  const descriptionOverflowing = ref(false)
  const loading = ref(true)
  const episodeLoading = ref(false)
  const resourceLoading = ref(false)
  const changingReel = ref(false)
  const resumeLoading = ref(false)
  const backdropIndex = ref(0)
  const rotationReady = ref(false)
  const switchingBackdrop = ref(false)
  const errorMessage = ref('')
  const resourceError = ref('')
  let loadVersion = 0
  let seasonLoadVersion = 0
  let resourceLoadVersion = 0
  let pickerLoadVersion = 0
  const pickerReady = ref(false)
  const documentVisibility = useDocumentVisibility()
  const preferredMotion = usePreferredReducedMotion()
  const backdropDuration = 10_000
  const { copy: copyPageUrl, copied: pageUrlCopied } = useClipboard({ copiedDuring: 1800 })

  const forgeReelUuid = computed(() => String(route.params.forgeReelUuid || ''))
  const isTv = computed(() => video.value?.video_type === 'tv')
  const backdropPaths = computed(() => {
    const paths = [imageUrl(video.value?.image_backdrop), ...images.value.map((image) => imageUrl(image.image_path))].filter((path): path is string => Boolean(path))
    return [...new Set(paths)]
  })
  const backdrop = computed(() => backdropPaths.value[backdropIndex.value % Math.max(1, backdropPaths.value.length)])
  const logo = computed(() => imageUrl(video.value?.image_logo, 'w500'))
  const year = computed(() => (video.value?.date_air ? dayjs(video.value.date_air).format('YYYY') : ''))
  const genreLabels = computed(() => {
    const names = new Map((dictionary.value?.genre ?? []).map((item) => [String(item.id), item.name]))
    return (video.value?.genre_ids ?? []).map((id) => names.get(String(id)) ?? String(id))
  })
  const videoRecord = computed(() => (signStore.isSignedIn ? (reel.value?.video_record ?? null) : null))
  const heroProgress = computed(() => {
    const record = videoRecord.value
    if (!record) return undefined
    const percent = calculateWatchPercent(record.play_seconds, record.media_second, record.is_complete)
    const location = isTv.value && record.season_number != null && record.episode_number != null ? `第 ${record.season_number} 季 · 第 ${record.episode_number} 集` : ''
    return {
      percent,
      location,
      status: record.is_complete ? '已看完' : `已观看 ${percent}%`,
    }
  })
  const heroActionLabel = computed(() => {
    if (!signStore.isSignedIn) return '登录后观看'
    if (resumeLoading.value) return '正在定位'
    if (videoRecord.value?.is_complete) return '重新播放'
    if (videoRecord.value) return '继续播放'
    return isTv.value ? '选择剧集' : '选择版本'
  })
  const selectedEpisode = computed(() => episodes.value.find((episode) => episode.episode_number === selectedEpisodeNumber.value))
  const { availableEpisodeNumbers, partSources, selectedSource, selectedVersion, sourceForEpisode, versions } = useMediaSourceSelection({
    sources,
    isSeries: isTv,
    seasonNumber: selectedSeasonNumber,
    episodeNumber: selectedEpisodeNumber,
    partNumber: selectedPartNumber,
    mediaId: selectedMediaId,
  })
  const canPlay = computed(() => signStore.isSignedIn && Boolean(selectedVersion.value))
  const resourceResolved = computed(() => signStore.isSignedIn && !resourceLoading.value && !resourceError.value)
  const activeTitle = computed(() => selectedEpisode.value?.episode_title || video.value?.video_title || '影片')
  const pickerDescription = computed(() => selectedEpisode.value?.episode_description || video.value?.video_description || '暂无简介')
  const pickerPreviewImage = computed(() => imageUrl(selectedEpisode.value?.image_poster, 'w300') ?? imageUrl(video.value?.image_backdrop) ?? imageUrl(video.value?.image_poster) ?? null)
  const episodeAirDateLabel = computed(() => {
    const dateAir = selectedEpisode.value?.date_air
    return dateAir && dayjs(dateAir).isValid() ? dayjs(dateAir).format('YYYY-MM-DD') : ''
  })
  const runtimeLabel = computed(() => {
    const minutes = selectedEpisode.value?.runtime ?? video.value?.runtime
    if (!minutes) return ''
    const runtime = dayjs.duration(minutes, 'minutes')
    return runtime.asHours() >= 1 ? runtime.format('H 小时 m 分钟') : runtime.format('m 分钟')
  })
  function preloadImage(source: string) {
    return new Promise<void>((resolve) => {
      const image = new Image()
      image.onload = () => resolve()
      image.onerror = () => resolve()
      image.src = source
    })
  }

  async function rotateBackdrop() {
    if (switchingBackdrop.value || backdropPaths.value.length < 2) return
    switchingBackdrop.value = true
    const nextIndex = (backdropIndex.value + 1) % backdropPaths.value.length
    await preloadImage(backdropPaths.value[nextIndex])
    if (backdropPaths.value.length > 1) backdropIndex.value = nextIndex
    switchingBackdrop.value = false
  }

  const { pause: pauseBackdropRotation, resume: resumeBackdropRotation } = useTimeoutPoll(rotateBackdrop, backdropDuration, { immediate: false })

  function syncBackdropRotation() {
    const shouldRotate = rotationReady.value && backdropPaths.value.length > 1 && documentVisibility.value === 'visible' && preferredMotion.value !== 'reduce'
    if (shouldRotate) resumeBackdropRotation()
    else pauseBackdropRotation()
  }

  function copyCurrentUrl() {
    void copyPageUrl(window.location.href)
  }

  async function loadBackdropGallery(todbId: number, currentLoad: number) {
    const gallery = await getVideoImages(todbId).catch(() => [])
    if (currentLoad !== loadVersion) return
    images.value = gallery
    rotationReady.value = true
    syncBackdropRotation()
  }

  function beginLogin() {
    signStore.rememberReturnPath(route.fullPath)
    window.location.assign(signStore.loginUrl())
  }

  async function openPicker() {
    if (!signStore.isSignedIn) {
      beginLogin()
      return
    }
    pickerOpen.value = true
    if (pickerReady.value || !reel.value || !video.value) return

    const currentLoad = ++pickerLoadVersion
    resourceError.value = ''
    if (isTv.value) episodeLoading.value = true
    try {
      if (isTv.value) {
        const seasonList = await getSeasons(reel.value.todbv_id)
        if (currentLoad !== pickerLoadVersion) return
        seasons.value = seasonList
        const record = videoRecord.value
        const preferredSeason = record?.season_number != null ? seasonList.find((season) => season.season_number === record.season_number) : undefined
        const initialSeason = preferredSeason ?? seasonList[0]
        if (initialSeason) {
          await selectSeason(initialSeason.season_number, preferredSeason ? record?.episode_number : null, preferredSeason ? record?.part_number : null)
        }
      } else {
        await loadResources()
      }
      if (currentLoad === pickerLoadVersion) pickerReady.value = !resourceError.value
    } catch {
      if (currentLoad === pickerLoadVersion) resourceError.value = '剧集信息暂时不可用'
    } finally {
      if (currentLoad === pickerLoadVersion) episodeLoading.value = false
    }
  }

  function measureDescription() {
    const element = overviewText.value
    descriptionOverflowing.value = Boolean(element && element.scrollHeight > element.clientHeight + 1)
  }

  useResizeObserver(overviewText, measureDescription)

  async function loadResources(preferredEpisodeNumber?: number | null, preferredPartNumber?: number | null) {
    const currentLoad = ++resourceLoadVersion
    if (!signStore.isSignedIn || !reel.value) {
      sources.value = []
      return
    }
    resourceLoading.value = true
    resourceError.value = ''
    try {
      const nextSources = await getMediaSources(reel.value.video_list_id, isTv.value && selectedSeasonNumber.value != null ? { seasonNumber: selectedSeasonNumber.value } : {})
      if (currentLoad !== resourceLoadVersion) return
      sources.value = nextSources

      if (isTv.value) {
        const explicitlyPreferred = preferredEpisodeNumber != null ? sourceForEpisode(preferredEpisodeNumber) : undefined
        if (explicitlyPreferred?.episode_number != null) {
          selectedEpisodeNumber.value = explicitlyPreferred.episode_number
          const preferredPartExists = sources.value.some((source) => source.episode_number === explicitlyPreferred.episode_number && source.part_number === preferredPartNumber)
          selectedPartNumber.value = preferredPartExists ? (preferredPartNumber ?? null) : null
          return
        }
        const currentHasSource = selectedEpisodeNumber.value != null && Boolean(sourceForEpisode(selectedEpisodeNumber.value))
        if (!currentHasSource) {
          const playableSources = sources.value.filter((source) => source.episode_number != null && source.versions.length)
          const recentlyPlayed = [...playableSources].filter((source) => source.last_played).sort((a, b) => dayjs(b.last_played).valueOf() - dayjs(a.last_played).valueOf())[0]
          const preferredSource = recentlyPlayed ?? [...playableSources].sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))[0]
          if (preferredSource?.episode_number != null) selectedEpisodeNumber.value = preferredSource.episode_number
        }
      }
    } catch {
      if (currentLoad !== resourceLoadVersion) return
      resourceError.value = '片源信息暂时不可用'
      sources.value = []
    } finally {
      if (currentLoad === resourceLoadVersion) resourceLoading.value = false
    }
  }

  async function selectSeason(seasonNumber: number, preferredEpisodeNumber?: number | null, preferredPartNumber?: number | null) {
    const currentLoad = ++seasonLoadVersion
    resourceLoadVersion += 1
    resourceLoading.value = false
    selectedSeasonNumber.value = seasonNumber
    selectedEpisodeNumber.value = null
    selectedPartNumber.value = null
    episodes.value = []
    sources.value = []
    episodeLoading.value = true
    resourceError.value = ''
    try {
      const nextEpisodes = await getEpisodes(reel.value!.todbv_id, seasonNumber)
      if (currentLoad !== seasonLoadVersion) return
      episodes.value = nextEpisodes
      const preferredEpisode = preferredEpisodeNumber != null ? nextEpisodes.find((episode) => episode.episode_number === preferredEpisodeNumber) : undefined
      selectedEpisodeNumber.value = preferredEpisode?.episode_number ?? nextEpisodes[0]?.episode_number ?? null
      await loadResources(preferredEpisode?.episode_number, preferredPartNumber)
    } catch {
      if (currentLoad === seasonLoadVersion) resourceError.value = '本季数据暂时不可用'
    } finally {
      if (currentLoad === seasonLoadVersion) episodeLoading.value = false
    }
  }

  async function loadPage() {
    const currentLoad = ++loadVersion
    pauseBackdropRotation()
    rotationReady.value = false
    seasonLoadVersion += 1
    resourceLoadVersion += 1
    loading.value = true
    resumeLoading.value = false
    errorMessage.value = ''
    resourceError.value = ''
    reel.value = undefined
    video.value = undefined
    images.value = []
    backdropIndex.value = 0
    seasons.value = []
    episodes.value = []
    sources.value = []
    pickerOpen.value = false
    pickerReady.value = false
    pickerLoadVersion += 1
    try {
      const reelInfo = await getReelInfo(forgeReelUuid.value)
      const [videoInfo, dict] = await Promise.all([getVideo(reelInfo.todbv_id), getVideoDictionary().catch(() => undefined)])
      if (currentLoad !== loadVersion) return
      reel.value = reelInfo
      video.value = videoInfo
      dictionary.value = dict
      backdropIndex.value = 0
      rotationReady.value = true
      syncBackdropRotation()
      void loadBackdropGallery(reelInfo.todbv_id, currentLoad)
      await nextTick()
      measureDescription()
    } catch {
      errorMessage.value = '这场放映暂时无法准备，请换一部影片。'
    } finally {
      if (currentLoad === loadVersion) loading.value = false
    }
  }

  async function showAnotherReel() {
    if (changingReel.value) return
    changingReel.value = true
    try {
      const next = await getRandomReel()
      if (next.forge_reel_uuid && next.forge_reel_uuid !== forgeReelUuid.value) {
        await router.push({ name: 'video', params: { forgeReelUuid: next.forge_reel_uuid } })
      }
    } finally {
      changingReel.value = false
    }
  }

  function chooseEpisode(episodeNumber: number) {
    selectedEpisodeNumber.value = episodeNumber
    selectedPartNumber.value = null
  }

  function cachePlaybackContext(
    mediaId: string,
    mediaName: string,
    versions: MediaSource['versions'] | undefined,
    record: Pick<ReelVideoRecord, 'season_number' | 'episode_number' | 'episode_title' | 'part_number' | 'play_seconds' | 'is_complete'>,
    fromStart: boolean,
  ) {
    if (!reel.value || !video.value) return
    cachePlayerContext({
      mediaId,
      forgeReelUuid: forgeReelUuid.value,
      todbId: reel.value.todbv_id,
      videoListId: reel.value.video_list_id,
      videoType: video.value.video_type,
      videoTitle: video.value.video_title,
      logo: logo.value ?? null,
      backdrop: backdrop.value ?? null,
      seasonNumber: record.season_number,
      episodeNumber: record.episode_number,
      episodeTitle: record.episode_title,
      partNumber: record.part_number,
      mediaName,
      versions,
      resumeSeconds: fromStart || record.is_complete ? 0 : record.play_seconds,
    })
  }

  function navigateToPlayer(mediaId: string, fromStart: boolean) {
    void router.push({
      name: 'player',
      params: { mediaId },
      query: fromStart ? { t: '0' } : undefined,
    })
  }

  function play(fromStart = false) {
    if (!signStore.isSignedIn) {
      beginLogin()
      return
    }
    if (!reel.value || !video.value || !selectedVersion.value) return
    cachePlaybackContext(
      selectedVersion.value.media_id,
      selectedVersion.value.media_name,
      versions.value,
      {
        season_number: selectedSeasonNumber.value,
        episode_number: selectedEpisodeNumber.value,
        episode_title: selectedEpisode.value?.episode_title ?? null,
        part_number: selectedSource.value?.part_number ?? null,
        play_seconds: selectedSource.value?.play_seconds ?? null,
        is_complete: selectedSource.value?.is_complete ?? false,
      },
      fromStart,
    )
    navigateToPlayer(selectedVersion.value.media_id, fromStart || Boolean(selectedSource.value?.is_complete))
  }

  async function continuePlayback() {
    if (!signStore.isSignedIn) {
      beginLogin()
      return
    }
    const record = videoRecord.value
    if (!record || !reel.value || !video.value) {
      await openPicker()
      return
    }

    const fromStart = record.is_complete
    if (record.media_id) {
      cachePlaybackContext(record.media_id, record.media_name ?? '', undefined, record, fromStart)
      navigateToPlayer(record.media_id, fromStart)
      return
    }

    resumeLoading.value = true
    try {
      const matchingSources = await getMediaSources(reel.value.video_list_id, {
        seasonNumber: record.season_number ?? undefined,
        episodeNumber: record.episode_number ?? undefined,
        partNumber: record.part_number ?? undefined,
      })
      const source =
        matchingSources.find((item) => item.season_number === record.season_number && item.episode_number === record.episode_number && item.part_number === record.part_number) ?? matchingSources[0]
      const version = source && pickPreferredMediaVersion(source.versions)
      if (!source || !version) {
        await openPicker()
        return
      }
      cachePlaybackContext(
        version.media_id,
        version.media_name,
        source.versions,
        {
          ...record,
          play_seconds: source.play_seconds ?? record.play_seconds,
          is_complete: source.is_complete,
        },
        fromStart,
      )
      navigateToPlayer(version.media_id, fromStart)
    } catch {
      await openPicker()
    } finally {
      resumeLoading.value = false
    }
  }

  watch(
    () => signStore.isSignedIn,
    (signedIn) => {
      if (!signedIn) {
        resourceLoadVersion += 1
        pickerLoadVersion += 1
        resourceLoading.value = false
        sources.value = []
        pickerOpen.value = false
        pickerReady.value = false
      }
    },
  )

  watch([documentVisibility, preferredMotion, backdropPaths], syncBackdropRotation)
  watch(forgeReelUuid, () => void loadPage())
  onMounted(() => void loadPage())
  onBeforeUnmount(pauseBackdropRotation)
</script>

<template>
  <main class="selection-page">
    <Transition name="backdrop-fade">
      <img v-if="backdrop" :key="backdrop" :src="backdrop" :style="{ '--backdrop-duration': `${backdropDuration}ms` }" alt="" aria-hidden="true" class="selection-backdrop" />
    </Transition>
    <div class="selection-shade"></div>
    <AppHeader :avatar="signStore.user?.avatar" :signed-in="signStore.isSignedIn" :username="signStore.username" @brand="showAnotherReel" @signout="signStore.signOut" />

    <section v-if="loading" class="selection-state">
      <LoaderCircle :size="24" class="animate-spin" />
      <span>正在布置银幕</span>
    </section>

    <section v-else-if="errorMessage" class="selection-state">
      <AlertCircle :size="25" />
      <h1>{{ errorMessage }}</h1>
      <button class="primary-button" type="button" @click="showAnotherReel">
        <RefreshCw :size="17" />
        换一部
      </button>
    </section>

    <template v-else-if="video && reel">
      <section class="selection-hero">
        <div class="title-lockup">
          <img v-if="logo" :alt="video.video_title" :src="logo" class="title-logo" />
          <h1 v-else>{{ video.video_title }}</h1>
          <p v-if="video.tagline" class="tagline">{{ video.tagline }}</p>
          <div class="meta-line">
            <span v-if="year">{{ year }}</span>
            <span v-for="genre in genreLabels" :key="genre">{{ genre }}</span>
          </div>
          <button
            :aria-disabled="!descriptionOverflowing"
            :class="{ interactive: descriptionOverflowing }"
            class="overview-trigger"
            type="button"
            @click="descriptionOverflowing && (descriptionOpen = true)">
            <span ref="overviewText" class="overview">{{ video.video_description || '暂无简介' }}</span>
          </button>
          <div v-if="heroProgress" :aria-valuenow="heroProgress.percent" aria-label="观看进度" aria-valuemax="100" aria-valuemin="0" class="hero-progress" role="progressbar">
            <div class="hero-progress-copy">
              <span v-if="heroProgress.location">{{ heroProgress.location }}</span>
              <strong>{{ heroProgress.status }}</strong>
            </div>
            <div class="hero-progress-track"><span :style="{ width: `${heroProgress.percent}%` }"></span></div>
          </div>
          <div class="hero-actions">
            <button :disabled="resumeLoading" class="primary-button play-button" type="button" @click="continuePlayback">
              <LockKeyhole v-if="!signStore.isSignedIn" :size="18" />
              <LoaderCircle v-else-if="resumeLoading" :size="18" class="animate-spin" />
              <Play v-else :size="18" fill="currentColor" />
              {{ heroActionLabel }}
            </button>
            <button v-if="videoRecord" class="secondary-action" type="button" @click="openPicker">
              <ListVideo :size="18" />
              <span>{{ isTv ? '重新选集' : '选择版本' }}</span>
            </button>
            <button :disabled="changingReel" aria-label="换一部影片" class="icon-action" type="button" @click="showAnotherReel">
              <RefreshCw :class="{ 'animate-spin': changingReel }" :size="19" />
            </button>
            <button :aria-label="pageUrlCopied ? '链接已复制' : '复制当前页面地址'" class="icon-action" type="button" @click="copyCurrentUrl">
              <Check v-if="pageUrlCopied" :size="19" />
              <Share2 v-else :size="19" />
            </button>
          </div>
        </div>
      </section>

      <SourcePickerDrawer
        :active-title="activeTitle"
        :air-date-label="episodeAirDateLabel"
        :available-episode-numbers="availableEpisodeNumbers"
        :can-play="canPlay"
        :description="pickerDescription"
        :episode-loading="episodeLoading"
        :episodes="episodes"
        :is-tv="isTv"
        :open="pickerOpen"
        :part-sources="partSources"
        :preview-image="pickerPreviewImage"
        :resource-error="resourceError"
        :resource-loading="resourceLoading"
        :resource-resolved="resourceResolved"
        :runtime-label="runtimeLabel"
        :seasons="seasons"
        :selected-episode="selectedEpisode"
        :selected-episode-number="selectedEpisodeNumber"
        :selected-media-id="selectedMediaId"
        :selected-part-number="selectedPartNumber"
        :selected-season-number="selectedSeasonNumber"
        :signed-in="signStore.isSignedIn"
        :sources="sources"
        :title="video.video_title"
        :versions="versions"
        @close="pickerOpen = false"
        @login="beginLogin"
        @play="play"
        @select-season="selectSeason"
        @select-episode="chooseEpisode"
        @select-part="selectedPartNumber = $event"
        @select-media="selectedMediaId = $event" />
      <DescriptionDrawer :description="video.video_description || '暂无简介'" :open="descriptionOpen" :title="video.video_title" @close="descriptionOpen = false" />
    </template>
    <Transition name="copy-toast">
      <div v-if="pageUrlCopied" class="copy-toast" role="status">链接已复制</div>
    </Transition>
  </main>
</template>

<style scoped>
  .selection-page {
    position: relative;
    height: 100svh;
    overflow: hidden;
    background: var(--reel-bg);
    color: var(--reel-text);
  }
  .selection-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 20%;
    filter: saturate(0.96) contrast(1.02) brightness(1.02);
    transform-origin: center;
    animation: backdrop-zoom var(--backdrop-duration, 10000ms) cubic-bezier(0.2, 0.65, 0.35, 1) both;
  }
  .selection-shade {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 78% 92% at 0% 100%, rgba(13, 15, 14, 0.88) 0%, rgba(13, 15, 14, 0.58) 40%, rgba(13, 15, 14, 0.2) 62%, transparent 79%);
    pointer-events: none;
  }
  .selection-state {
    position: relative;
    z-index: 2;
    display: grid;
    min-height: calc(100svh - 76px);
    place-content: center;
    justify-items: center;
    gap: 14px;
    padding: 24px;
    color: var(--reel-muted);
    text-align: center;
  }
  .selection-state h1 {
    max-width: 560px;
    margin: 0;
    color: var(--reel-text);
    font-size: 25px;
  }
  .selection-hero {
    position: relative;
    z-index: 2;
    display: flex;
    height: calc(100svh - 76px);
    align-items: flex-end;
    padding: 50px clamp(20px, 6vw, 92px) clamp(48px, 7vh, 78px);
  }
  .title-lockup {
    --hero-content-width: min(690px, 100%);
    width: min(780px, 100%);
  }
  .title-logo {
    display: block;
    max-width: min(700px, 82vw);
    max-height: 220px;
    object-fit: contain;
    object-position: left bottom;
    filter: drop-shadow(0 8px 30px rgba(0, 0, 0, 0.72));
  }
  .title-lockup h1 {
    max-width: 880px;
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 120px;
    font-weight: 720;
    line-height: 0.95;
    letter-spacing: 0;
    text-wrap: balance;
    text-shadow: 0 6px 34px rgba(0, 0, 0, 0.8);
  }
  .tagline {
    margin: 24px 0 0;
    color: #eee8dc;
    font-size: 24px;
    line-height: 1.45;
  }
  .meta-line {
    display: flex;
    flex-wrap: wrap;
    gap: 9px 20px;
    margin-top: 18px;
    color: #ddd7ce;
    font-size: 16px;
    font-weight: 650;
  }
  .meta-line span:not(:first-child)::before {
    margin-right: 18px;
    color: var(--reel-film);
    content: '/';
  }
  .overview-trigger {
    display: block;
    width: var(--hero-content-width);
    max-width: none;
    margin: 16px 0 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: default;
  }
  .overview-trigger.interactive {
    cursor: pointer;
  }
  .overview-trigger.interactive:hover .overview {
    color: rgba(255, 255, 255, 0.94);
  }
  .overview {
    display: -webkit-box;
    width: 100%;
    max-width: none;
    overflow: hidden;
    color: rgba(240, 241, 244, 0.8);
    font-size: 17px;
    line-height: 1.7;
    text-shadow: 0 2px 14px #000;
    transition: color 0.18s ease;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .hero-progress {
    display: grid;
    width: var(--hero-content-width);
    gap: 7px;
    margin-top: 19px;
  }
  .hero-progress-copy {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    color: rgba(255, 255, 255, 0.66);
    font-size: 12px;
    font-weight: 650;
  }
  .hero-progress-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hero-progress-copy strong {
    flex: 0 0 auto;
    margin-left: auto;
    color: rgba(255, 255, 255, 0.9);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .hero-progress-track {
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.22);
  }
  .hero-progress-track span {
    display: block;
    height: 100%;
    background: var(--reel-accent);
    transition: width 0.3s ease;
  }
  .hero-actions {
    display: flex;
    width: var(--hero-content-width);
    flex-wrap: nowrap;
    align-items: center;
    gap: 10px;
    margin-top: 22px;
  }
  .play-button {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    font-size: 15px;
    white-space: nowrap;
  }
  .secondary-action {
    display: inline-flex;
    height: 48px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 17px;
    border: 1px solid var(--reel-line-strong);
    border-radius: 5px;
    background: var(--reel-surface-glass);
    color: white;
    font: inherit;
    font-size: 14px;
    font-weight: 680;
    backdrop-filter: blur(12px);
  }
  .secondary-action:hover {
    border-color: rgba(112, 183, 173, 0.58);
    background: var(--reel-accent-wash);
  }
  .icon-action {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 1px solid var(--reel-line-strong);
    border-radius: 5px;
    background: var(--reel-surface-glass);
    color: white;
    backdrop-filter: blur(12px);
  }
  .icon-action:hover {
    border-color: rgba(112, 183, 173, 0.58);
    background: var(--reel-accent-wash);
  }
  .backdrop-fade-enter-active,
  .backdrop-fade-leave-active {
    transition: opacity 1.4s ease;
  }
  .backdrop-fade-enter-from,
  .backdrop-fade-leave-to {
    opacity: 0;
  }
  .copy-toast {
    position: fixed;
    z-index: 100;
    bottom: max(24px, env(safe-area-inset-bottom));
    left: 50%;
    padding: 12px 16px;
    border: 1px solid rgba(112, 183, 173, 0.4);
    border-radius: 5px;
    background: var(--reel-surface-overlay);
    color: var(--reel-text);
    font-size: 15px;
    box-shadow: 0 12px 35px rgba(0, 0, 0, 0.38);
    transform: translateX(-50%);
  }
  .copy-toast-enter-active,
  .copy-toast-leave-active {
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }
  .copy-toast-enter-from,
  .copy-toast-leave-to {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  @keyframes backdrop-zoom {
    from {
      transform: scale(1.015) translate3d(0, 0, 0);
    }
    to {
      transform: scale(1.06) translate3d(-0.45%, -0.25%, 0);
    }
  }
  @media (max-width: 760px) {
    .selection-shade {
      background: linear-gradient(0deg, rgba(17, 19, 18, 0.93) 0%, rgba(17, 19, 18, 0.68) 38%, rgba(17, 19, 18, 0.22) 68%, transparent 88%);
    }
    .selection-hero {
      height: calc(100svh - 64px);
      padding-bottom: 40px;
    }
    .selection-state h1 {
      font-size: 21px;
    }
    .title-lockup h1 {
      font-size: 52px;
    }
    .title-logo {
      max-width: 90vw;
      max-height: 170px;
    }
    .tagline {
      font-size: 18px;
    }
    .meta-line {
      font-size: 14px;
    }
    .overview {
      font-size: 14px;
      line-height: 1.65;
      -webkit-line-clamp: 4;
    }
    .hero-progress {
      margin-top: 15px;
    }
    .hero-progress-copy {
      font-size: 11px;
    }
    .play-button {
      min-width: 0;
    }
    .secondary-action {
      padding: 0 13px;
      font-size: 13px;
    }
    .copy-toast {
      font-size: 13px;
    }
  }
  @media (max-width: 420px) {
    .hero-actions {
      gap: 6px;
    }
    .secondary-action {
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      padding: 0;
    }
    .secondary-action span {
      display: none;
    }
    .icon-action {
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
    }
  }
  @media (max-height: 760px) and (min-width: 761px) {
    .selection-hero {
      padding-bottom: 28px;
    }
    .title-logo {
      max-height: 145px;
    }
    .title-lockup h1 {
      font-size: 88px;
    }
    .tagline {
      margin-top: 12px;
      font-size: 22px;
    }
    .meta-line {
      margin-top: 10px;
      font-size: 16px;
    }
    .overview-trigger {
      margin-top: 9px;
    }
    .overview {
      font-size: 17px;
      line-height: 1.6;
      -webkit-line-clamp: 2;
    }
    .hero-actions {
      margin-top: 14px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .selection-backdrop {
      animation: none;
      transform: scale(1.015);
    }
    .backdrop-fade-enter-active,
    .backdrop-fade-leave-active {
      transition: none;
    }
  }
</style>
