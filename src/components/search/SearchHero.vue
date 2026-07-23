<script lang="ts" setup>
import { ExternalLink, Search, X } from '@lucide/vue'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'

const props = defineProps<{
    modelValue: string
    progress: number
    showProgress: boolean
  }>()

  const emit = defineEmits<{
    clear: []
    submit: []
    'update:modelValue': [value: string]
  }>()

  const searchIntroRef = ref<HTMLElement | null>(null)
  const searchControlsRef = ref<HTMLElement | null>(null)
  const isSearchIntroStuck = ref(false)
  const isSearchControlsStuck = ref(false)
  let stickyFrame: number | undefined
  let listening = false

  const inputValue = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value),
  })

  function isMobileLayout() {
    return window.matchMedia('(max-width: 720px)').matches
  }

  function cssPixelValue(value: string, fallback: number) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function isStickyElementStuck(element: HTMLElement, fallbackTop: number) {
    const stickyTop = cssPixelValue(window.getComputedStyle(element).top, fallbackTop)
    const documentTop = element.getBoundingClientRect().top + window.scrollY
    return window.scrollY > 0 && window.scrollY >= documentTop - stickyTop - 0.5
  }

  function updateStickyState() {
    stickyFrame = undefined
    const mobileLayout = isMobileLayout()
    isSearchIntroStuck.value = !mobileLayout && Boolean(searchIntroRef.value && isStickyElementStuck(searchIntroRef.value, 0))
    isSearchControlsStuck.value = mobileLayout && Boolean(searchControlsRef.value && isStickyElementStuck(searchControlsRef.value, 8))
  }

  function scheduleStickyState() {
    if (stickyFrame != null) return
    stickyFrame = window.requestAnimationFrame(updateStickyState)
  }

  function addListeners() {
    if (listening) return
    listening = true
    window.addEventListener('scroll', scheduleStickyState, { passive: true })
    window.addEventListener('resize', scheduleStickyState, { passive: true })
    scheduleStickyState()
  }

  function removeListeners() {
    if (!listening) return
    listening = false
    window.removeEventListener('scroll', scheduleStickyState)
    window.removeEventListener('resize', scheduleStickyState)
    if (stickyFrame != null) {
      window.cancelAnimationFrame(stickyFrame)
      stickyFrame = undefined
    }
    isSearchIntroStuck.value = false
    isSearchControlsStuck.value = false
  }

  onMounted(addListeners)
  onActivated(addListeners)
  onDeactivated(removeListeners)
  onBeforeUnmount(removeListeners)
</script>

<template>
  <section ref="searchIntroRef" :class="{ 'is-stuck': isSearchIntroStuck }" class="search-intro">
    <header class="search-heading">
      <a class="section-kicker" href="https://theotherdb.org" target="_blank">
        <Search :size="15" />
        TODB
        <ExternalLink :size="12" />
      </a>
      <h1>找影片</h1>
      <p>先查资料，再进详情确认 EMOS REEL 是否可播。</p>
    </header>

    <form ref="searchControlsRef" :class="{ 'is-stuck': isSearchControlsStuck }" class="search-controls" role="search" @submit.prevent="emit('submit')">
      <label class="title-field">
        <Search :size="19" />
        <input v-model="inputValue" autocomplete="off" autofocus placeholder="输入影片名" type="text" />
        <button v-if="modelValue" aria-label="清除影片名" type="button" @click="emit('clear')">
          <X :size="18" />
        </button>
      </label>
      <div v-if="showProgress" aria-hidden="true" class="result-progress">
        <span :style="{ width: `${progress}%` }"></span>
      </div>
    </form>
  </section>
</template>
