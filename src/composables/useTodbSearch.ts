import { useDebounceFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { type LocationQuery, useRoute, useRouter } from 'vue-router'
import { getErrorStatus, getRandomReel, getVideoIdByTodbId } from '@/api/emos'
import { getTodbVideoList } from '@/api/todb'
import type { TodbVideoListItem } from '@/api/types'

function firstQueryValue(value: LocationQuery[string]) {
  return Array.isArray(value) ? value[0] : value
}

function routeTitle(query: LocationQuery) {
  return String(firstQueryValue(query.title) ?? '').trim()
}

function mergeItems(current: TodbVideoListItem[], nextItems: TodbVideoListItem[]) {
  const seen = new Set(current.map((item) => item.video_id))
  return [
    ...current,
    ...nextItems.filter((item) => {
      if (seen.has(item.video_id)) return false
      seen.add(item.video_id)
      return true
    }),
  ]
}

export function useTodbSearch(pageSize: number) {
  const route = useRoute()
  const router = useRouter()

  const searchInput = ref('')
  const items = ref<TodbVideoListItem[]>([])
  const total = ref(0)
  const loadedPage = ref(0)
  const loadedTitle = ref('')
  const loading = ref(false)
  const loadingMore = ref(false)
  const randomLoading = ref(false)
  const hasSearched = ref(false)
  const openingVideoId = ref<number | null>(null)
  const errorMessage = ref('')
  const resourceMessage = ref('')
  let requestSequence = 0
  let resourceMessageTimer: ReturnType<typeof setTimeout> | undefined

  const title = computed(() => routeTitle(route.query))
  const searchRouteTitle = computed(() => (route.name === 'search' ? title.value : null))
  const visibleCount = computed(() => items.value.length)
  const canLoadMore = computed(() => hasSearched.value && !loading.value && !loadingMore.value && visibleCount.value < total.value)
  const isOpeningResult = computed(() => openingVideoId.value != null)
  const resultProgress = computed(() => (total.value > 0 ? Math.min(100, Math.round((visibleCount.value / total.value) * 100)) : 0))
  const showResultProgress = computed(() => title.value && hasSearched.value && total.value > 0)

  function clearResourceMessage() {
    if (resourceMessageTimer) {
      clearTimeout(resourceMessageTimer)
      resourceMessageTimer = undefined
    }
    resourceMessage.value = ''
  }

  function showResourceMessage(message: string) {
    if (resourceMessageTimer) clearTimeout(resourceMessageTimer)
    resourceMessage.value = message
    resourceMessageTimer = setTimeout(() => {
      resourceMessage.value = ''
      resourceMessageTimer = undefined
    }, 2600)
  }

  function updateSearchRoute(nextTitle: string) {
    void router.replace({
      name: 'search',
      query: nextTitle ? { title: nextTitle } : {},
    })
  }

  const updateTitleRoute = useDebounceFn(() => {
    const nextTitle = searchInput.value.trim()
    if (nextTitle === title.value) return
    updateSearchRoute(nextTitle)
  }, 320)

  async function loadSearch(nextTitle: string) {
    const currentRequest = ++requestSequence
    errorMessage.value = ''
    clearResourceMessage()
    loadedPage.value = 0
    items.value = []
    total.value = 0

    if (!nextTitle) {
      loadedTitle.value = ''
      hasSearched.value = false
      loading.value = false
      loadingMore.value = false
      return
    }

    hasSearched.value = true
    loading.value = true
    loadingMore.value = false

    try {
      const response = await getTodbVideoList({
        title: nextTitle,
        page: 1,
        pageSize,
      })
      if (currentRequest !== requestSequence) return
      items.value = response.items
      total.value = response.total
      loadedPage.value = response.page
      loadedTitle.value = nextTitle
    } catch {
      if (currentRequest !== requestSequence) return
      loadedTitle.value = nextTitle
      errorMessage.value = '暂时查不了片名，稍后再试'
    } finally {
      if (currentRequest === requestSequence) loading.value = false
    }
  }

  async function loadMore() {
    if (!canLoadMore.value || !title.value) return
    const currentRequest = ++requestSequence
    loadingMore.value = true
    errorMessage.value = ''
    clearResourceMessage()
    try {
      const response = await getTodbVideoList({
        title: title.value,
        page: loadedPage.value + 1,
        pageSize,
      })
      if (currentRequest !== requestSequence) return
      items.value = mergeItems(items.value, response.items)
      total.value = response.total
      loadedPage.value = response.page
    } catch {
      if (currentRequest !== requestSequence) return
      showResourceMessage('暂时加载不了更多结果')
    } finally {
      if (currentRequest === requestSequence) loadingMore.value = false
    }
  }

  function submitSearch() {
    const nextTitle = searchInput.value.trim()
    if (nextTitle === title.value) {
      void loadSearch(nextTitle)
      return
    }
    updateSearchRoute(nextTitle)
  }

  function clearTitle() {
    searchInput.value = ''
    updateSearchRoute('')
  }

  async function openResult(item: TodbVideoListItem) {
    if (openingVideoId.value != null) return
    openingVideoId.value = item.video_id
    clearResourceMessage()
    try {
      const videoId = await getVideoIdByTodbId(item.video_id)
      await router.push({ name: 'video', params: { forgeReelUuid: String(videoId) } })
    } catch (error) {
      showResourceMessage(getErrorStatus(error) === 404 ? 'EMOS REEL 暂不可播' : '详情暂时打不开')
    } finally {
      openingVideoId.value = null
    }
  }

  async function openRandomReel() {
    if (randomLoading.value) return
    randomLoading.value = true
    try {
      const reel = await getRandomReel()
      if (reel.forge_reel_uuid) await router.push({ name: 'video', params: { forgeReelUuid: reel.forge_reel_uuid } })
    } finally {
      randomLoading.value = false
    }
  }

  watch(searchInput, () => {
    if (searchInput.value.trim() === title.value) return
    void updateTitleRoute()
  })

  watch(
    searchRouteTitle,
    (nextTitle) => {
      if (nextTitle == null) return
      if (searchInput.value !== nextTitle) searchInput.value = nextTitle
      if (loadedTitle.value === nextTitle) return
      void loadSearch(nextTitle)
    },
    { immediate: true },
  )

  function dispose() {
    clearResourceMessage()
    requestSequence += 1
  }

  return {
    canLoadMore,
    clearTitle,
    dispose,
    errorMessage,
    hasSearched,
    isOpeningResult,
    items,
    loadMore,
    loadSearch,
    loading,
    loadingMore,
    openRandomReel,
    openResult,
    openingVideoId,
    resourceMessage,
    resultProgress,
    searchInput,
    showResultProgress,
    submitSearch,
    title,
    total,
    visibleCount,
  }
}
