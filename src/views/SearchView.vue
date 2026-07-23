<script lang="ts" setup>
import { LoaderCircle } from '@lucide/vue'
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import SearchBackdrop from '@/components/search/SearchBackdrop.vue'
import SearchHero from '@/components/search/SearchHero.vue'
import SearchResourceToast from '@/components/search/SearchResourceToast.vue'
import SearchResultWall from '@/components/search/SearchResultWall.vue'
import SearchState from '@/components/search/SearchState.vue'
import { useSearchBackdrop } from '@/composables/useSearchBackdrop'
import { useTodbSearch } from '@/composables/useTodbSearch'
import { useUserBase } from '@/composables/useUserBase'
import { useSignStore } from '@/stores/sign'

const PAGE_SIZE = 7

  const router = useRouter()
  const signStore = useSignStore()
  useUserBase()

  const {
    canLoadMore,
    clearTitle,
    dispose: disposeSearch,
    errorMessage,
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
  } = useTodbSearch(PAGE_SIZE)

  const { backgroundImage, dispose: disposeBackdrop, outgoingBackgroundImage, restoreDefault, schedulePreview, setFromItem } = useSearchBackdrop(isOpeningResult)
  const firstResultId = computed(() => items.value[0]?.video_id ?? null)

  function goBack() {
    router.back()
  }

  watch([title, firstResultId], () => {
    if (!title.value) {
      void setFromItem(undefined)
      return
    }
    void setFromItem(items.value[0], true)
  })

  onBeforeUnmount(() => {
    disposeSearch()
    disposeBackdrop()
  })
</script>

<template>
  <main class="search-page">
    <SearchBackdrop :current="backgroundImage" :outgoing="outgoingBackgroundImage" />
    <div class="search-shade"></div>
    <AppHeader :avatar="signStore.user?.avatar" :signed-in="signStore.isSignedIn" :username="signStore.username" show-back @back="goBack" @brand="openRandomReel" @signout="signStore.signOut" />

    <section class="search-shell">
      <SearchHero v-model="searchInput" :progress="resultProgress" :show-progress="showResultProgress" @clear="clearTitle" @submit="submitSearch" />

      <SearchState v-if="loading" message="正在查找片名" state="loading" />
      <SearchState v-else-if="errorMessage && !items.length" :message="errorMessage" :retryable="Boolean(title)" state="error" @retry="loadSearch(title)" />
      <SearchState v-else-if="!title" message="输入影视名后开始搜索" state="idle" />
      <SearchState v-else-if="!items.length" message="TODB 没找到这个片名" state="empty" />
      <SearchResultWall v-else :items="items" :opening-video-id="openingVideoId" :page-size="PAGE_SIZE" @open="openResult" @preview="schedulePreview" @restore="restoreDefault(items[0])" />

      <div v-if="canLoadMore || loadingMore" class="load-more-row">
        <button :disabled="loadingMore" class="secondary-button" type="button" @click="loadMore">
          <LoaderCircle v-if="loadingMore" :size="16" class="animate-spin" />
          {{ loadingMore ? '继续查找中' : '继续找' }}
        </button>
      </div>
    </section>
    <SearchResourceToast :message="resourceMessage" />
  </main>
</template>

<style>
  .search-page {
    position: relative;
    min-height: 100svh;
    overflow-x: clip;
    background: var(--reel-bg);
    color: var(--reel-text);
  }
  .search-page::before {
    position: fixed;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(17, 19, 18, 0.98) 0%, rgba(17, 19, 18, 0.9) 46%, rgba(17, 19, 18, 0.74) 100%),
      linear-gradient(180deg, rgba(112, 183, 173, 0.14) 0%, transparent 32%, rgba(0, 0, 0, 0.2) 100%);
    content: '';
    pointer-events: none;
  }
  .search-backdrop {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 24%;
    opacity: 0.56;
    filter: saturate(1) contrast(1.02) brightness(0.8);
    transform: scale(1.025);
    pointer-events: none;
  }
  .search-backdrop-current {
    animation: search-backdrop-in 0.72s ease both;
  }
  .search-backdrop-outgoing {
    z-index: 0;
    animation: search-backdrop-out 0.9s ease both;
    filter: saturate(0.96) contrast(1.02) brightness(0.74) blur(1.5px);
  }
  .search-shade {
    position: fixed;
    inset: 0;
    background:
      radial-gradient(ellipse 74% 96% at 0% 35%, rgba(17, 19, 18, 0.88) 0%, rgba(17, 19, 18, 0.64) 48%, rgba(17, 19, 18, 0.28) 100%),
      linear-gradient(180deg, rgba(17, 19, 18, 0.36) 0%, rgba(17, 19, 18, 0.12) 42%, rgba(17, 19, 18, 0.88) 100%),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 84px);
    pointer-events: none;
  }
  .search-shell {
    position: relative;
    z-index: 2;
    width: min(1320px, 100%);
    margin: 0 auto;
    padding: clamp(8px, 1.8vw, 24px) clamp(18px, 4vw, 64px) 56px;
  }
  .search-intro {
    position: sticky;
    top: 0;
    z-index: 12;
    display: grid;
    grid-template-columns: minmax(260px, 0.82fr) minmax(360px, 1fr);
    gap: 20px clamp(28px, 5vw, 72px);
    align-items: end;
    min-height: clamp(136px, 18vh, 210px);
    margin-bottom: 22px;
    padding: 10px 0 16px;
    isolation: isolate;
  }
  .search-intro::before {
    position: absolute;
    z-index: -1;
    inset: 0 calc(clamp(18px, 4vw, 64px) * -1) -12px;
    background: linear-gradient(180deg, rgba(17, 19, 18, 0.94) 0%, rgba(17, 19, 18, 0.86) 74%, rgba(17, 19, 18, 0) 100%), rgba(17, 19, 18, 0.18);
    content: '';
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
    backdrop-filter: blur(18px);
  }
  .search-intro.is-stuck::before {
    opacity: 1;
  }
  .search-heading {
    display: grid;
    gap: 10px;
    max-width: 560px;
    margin: 0;
    padding-bottom: 8px;
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.7);
  }
  .section-kicker {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 7px;
    color: var(--reel-accent-soft);
    font-size: 12px;
    font-weight: 750;
    text-decoration: none;
    transition:
      color 0.18s ease,
      opacity 0.18s ease;
  }
  .section-kicker:hover {
    color: var(--reel-accent);
  }
  .section-kicker:focus-visible {
    border-radius: 3px;
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 4px;
  }
  .search-heading h1 {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: clamp(42px, 5.8vw, 86px);
    font-weight: 720;
    line-height: 0.96;
    letter-spacing: 0;
  }
  .search-heading p {
    margin: 0;
    color: var(--reel-text-secondary);
    font-size: 15px;
    line-height: 1.72;
  }
  .search-controls {
    position: relative;
    width: 100%;
    padding: 0;
    isolation: isolate;
  }
  .title-field {
    position: relative;
    z-index: 1;
    display: flex;
    height: 56px;
    min-width: 0;
    align-items: center;
    gap: 10px;
    padding: 0 15px;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.055);
    color: var(--reel-muted);
    transition:
      border-color 0.18s ease,
      background 0.18s ease;
  }
  .title-field:focus-within {
    border-color: rgba(112, 183, 173, 0.66);
    background: rgba(255, 255, 255, 0.078);
  }
  .title-field input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--reel-text);
    font: inherit;
    font-size: 18px;
  }
  .title-field button {
    display: grid;
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
  }
  .title-field button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .result-progress {
    position: relative;
    z-index: 1;
    height: 2px;
    margin: 8px 4px 0;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
  }
  .result-progress span {
    display: block;
    height: 100%;
    background: rgba(112, 183, 173, 0.58);
    transition: width 0.28s ease;
  }
  .search-state {
    position: relative;
    z-index: 2;
    display: grid;
    min-height: 330px;
    padding: 36px 0;
    overflow: hidden;
    place-content: center;
    justify-items: center;
    gap: 13px;
    color: var(--reel-muted);
    text-align: center;
  }
  .search-state::before {
    position: absolute;
    inset: 0;
    border-block: 1px solid rgba(255, 255, 255, 0.06);
    background: radial-gradient(ellipse 48% 70% at 50% 50%, rgba(255, 255, 255, 0.065), transparent 70%), linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.028), transparent);
    content: '';
    pointer-events: none;
  }
  .search-state > * {
    position: relative;
    z-index: 1;
  }
  .search-state svg {
    color: rgba(245, 243, 238, 0.52);
  }
  .search-state span {
    max-width: min(420px, 100%);
    color: rgba(245, 243, 238, 0.72);
    font-size: 15px;
    font-weight: 650;
    line-height: 1.6;
  }
  .search-state.is-loading svg,
  .search-state.is-idle svg {
    color: var(--reel-accent-soft);
  }
  .search-state.is-empty::before {
    background: radial-gradient(ellipse 42% 70% at 50% 50%, rgba(112, 183, 173, 0.09), transparent 70%), linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.026), transparent);
  }
  .search-state.is-empty svg {
    color: var(--reel-film);
  }
  .search-state.is-error::before {
    border-block-color: rgba(220, 138, 132, 0.18);
    background: radial-gradient(ellipse 42% 70% at 50% 50%, rgba(220, 138, 132, 0.12), transparent 72%), linear-gradient(90deg, transparent, rgba(220, 138, 132, 0.05), transparent);
  }
  .search-state.is-error svg {
    color: var(--reel-danger);
  }
  .search-state.is-error span {
    color: var(--reel-text);
  }
  .cinema-wall {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(320px, 0.82fr) minmax(0, 1fr);
    gap: 16px;
    align-items: stretch;
  }
  .spotlight-card,
  .poster-card {
    position: relative;
    overflow: hidden;
    min-width: 0;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 7px;
    background: var(--reel-surface-raised);
    color: inherit;
    font: inherit;
    text-align: left;
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      filter 0.18s ease,
      transform 0.18s ease;
  }
  .spotlight-card {
    display: block;
    min-height: min(620px, 58vh);
    aspect-ratio: 5 / 6;
  }
  .poster-wall {
    display: grid;
    grid-auto-flow: dense;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 14px;
  }
  .poster-card {
    display: block;
    grid-column: span 2;
    aspect-ratio: 2 / 3;
  }
  .poster-card.is-wide {
    grid-column: span 3;
    aspect-ratio: 4 / 3;
  }
  .spotlight-card::after,
  .poster-card::after {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.02) 28%, rgba(0, 0, 0, 0.5) 72%, rgba(0, 0, 0, 0.84) 100%), linear-gradient(90deg, rgba(0, 0, 0, 0.42) 0%, transparent 48%);
    content: '';
    pointer-events: none;
  }
  .spotlight-card::after {
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.03) 18%, rgba(0, 0, 0, 0.34) 58%, rgba(0, 0, 0, 0.9) 100%), linear-gradient(90deg, rgba(0, 0, 0, 0.54) 0%, transparent 58%);
  }
  .spotlight-card img,
  .poster-card img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .spotlight-card:hover,
  .poster-card:hover {
    border-color: rgba(112, 183, 173, 0.62);
    filter: brightness(1.08);
    transform: translateY(-2px);
  }
  .spotlight-card:focus-visible,
  .poster-card:focus-visible {
    outline: 2px solid var(--reel-accent-soft);
    outline-offset: 3px;
  }
  .spotlight-card:disabled,
  .poster-card:disabled {
    opacity: 1;
    color: inherit;
    cursor: progress;
  }
  .spotlight-card:disabled:hover,
  .poster-card:disabled:hover {
    transform: none;
  }
  .spotlight-card.is-opening-muted,
  .poster-card.is-opening-muted {
    filter: saturate(0.7) brightness(0.68);
    transform: none;
  }
  .spotlight-card.is-opening-target,
  .poster-card.is-opening-target {
    border-color: rgba(112, 183, 173, 0.78);
    box-shadow:
      0 0 0 1px rgba(112, 183, 173, 0.2),
      0 22px 52px rgba(0, 0, 0, 0.42);
    filter: brightness(1.04);
  }
  .opening-overlay {
    position: absolute;
    z-index: 3;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.56);
    color: white;
    backdrop-filter: blur(2px);
  }
  .poster-empty {
    position: absolute;
    inset: 0;
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    gap: 10px;
    padding: 18px;
    background: linear-gradient(135deg, rgba(112, 183, 173, 0.16), transparent 46%), var(--reel-surface-elevated);
    color: rgba(255, 255, 255, 0.34);
    text-align: center;
  }
  .spotlight-copy,
  .poster-card-copy {
    position: absolute;
    z-index: 2;
    display: grid;
    min-width: 0;
  }
  .spotlight-copy {
    right: 24px;
    bottom: 24px;
    left: 24px;
    gap: 8px;
  }
  .poster-card-copy {
    right: 13px;
    bottom: 13px;
    left: 13px;
    gap: 5px;
  }
  .spotlight-copy strong,
  .poster-card-copy strong {
    display: -webkit-box;
    overflow: hidden;
    color: var(--reel-text);
    font-size: 16px;
    font-weight: 720;
    line-height: 1.22;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .spotlight-copy strong {
    font-size: clamp(20px, 2.4vw, 31px);
    line-height: 1.06;
  }
  .poster-card-meta,
  .spotlight-copy em,
  .poster-card-copy em {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    color: var(--reel-muted);
    font-size: 12px;
    font-style: normal;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .poster-card-meta {
    color: var(--reel-film);
    font-weight: 720;
  }
  .load-more-row {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: center;
    padding-top: 34px;
  }
  .load-more-row button {
    min-width: 148px;
  }
  .more-poster-wall {
    position: relative;
    z-index: 2;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 12px;
    margin-top: 18px;
  }
  .more-poster-wall .poster-card {
    grid-column: span 2;
  }
  .more-poster-wall .poster-card.is-wide {
    grid-column: span 2;
    aspect-ratio: 2 / 3;
  }
  .more-poster-wall .poster-card-copy {
    right: 11px;
    bottom: 11px;
    left: 11px;
  }
  .more-poster-wall .poster-card-copy strong {
    font-size: 14px;
  }
  .resource-toast {
    position: fixed;
    z-index: 80;
    right: clamp(18px, 4vw, 64px);
    bottom: max(24px, env(safe-area-inset-bottom));
    display: inline-flex;
    align-items: center;
    gap: 9px;
    max-width: min(360px, calc(100vw - 36px));
    min-height: 42px;
    padding: 0 14px;
    border: 1px solid rgba(220, 138, 132, 0.42);
    border-radius: 5px;
    background: rgba(26, 29, 27, 0.92);
    color: var(--reel-text);
    font-size: 14px;
    font-weight: 720;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(14px);
  }
  .resource-toast svg {
    flex: 0 0 auto;
    color: var(--reel-danger);
  }
  .resource-toast-enter-active,
  .resource-toast-leave-active {
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }
  .resource-toast-enter-from,
  .resource-toast-leave-to {
    opacity: 0;
    transform: translateY(8px);
  }
  @keyframes search-backdrop-in {
    from {
      opacity: 0;
      transform: scale(1.04);
    }
    to {
      opacity: 0.56;
      transform: scale(1.025);
    }
  }
  @keyframes search-backdrop-out {
    from {
      opacity: 0.42;
      transform: scale(1.025);
    }
    to {
      opacity: 0;
      transform: scale(1.045);
    }
  }
  @media (min-width: 1180px) {
    .cinema-wall {
      gap: 18px;
    }
    .poster-wall {
      gap: 16px;
    }
  }
  @media (max-width: 980px) {
    .cinema-wall {
      grid-template-columns: 1fr;
    }
    .spotlight-card {
      min-height: 0;
      aspect-ratio: 16 / 9;
    }
    .poster-wall {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .more-poster-wall {
      grid-template-columns: repeat(8, minmax(0, 1fr));
    }
    .poster-card {
      grid-column: span 2;
    }
    .poster-card.is-wide {
      grid-column: span 2;
      aspect-ratio: 2 / 3;
    }
  }
  @media (max-width: 720px) {
    .search-page::before {
      background: linear-gradient(180deg, rgba(17, 19, 18, 0.92) 0%, rgba(17, 19, 18, 0.78) 42%, rgba(17, 19, 18, 0.96) 100%), linear-gradient(180deg, rgba(112, 183, 173, 0.12) 0%, transparent 34%);
    }
    .search-shell {
      padding-top: 2px;
      padding-bottom: 36px;
    }
    .search-backdrop {
      opacity: 0.44;
      object-position: center top;
    }
    .resource-toast {
      right: 18px;
      bottom: max(18px, env(safe-area-inset-bottom));
      left: 18px;
      justify-content: center;
    }
    .search-intro {
      display: contents;
    }
    .search-intro::before {
      display: none;
    }
    .search-heading {
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 0;
    }
    .search-heading h1 {
      font-size: 42px;
    }
    .search-heading p {
      font-size: 14px;
    }
    .search-controls {
      position: sticky;
      top: max(8px, env(safe-area-inset-top));
      z-index: 20;
      margin-bottom: 16px;
    }
    .search-controls::before {
      position: absolute;
      z-index: 0;
      inset: calc((max(8px, env(safe-area-inset-top)) + 2px) * -1) calc(clamp(18px, 4vw, 64px) * -1) -14px;
      background: linear-gradient(180deg, rgba(17, 19, 18, 0.94) 0%, rgba(17, 19, 18, 0.86) 74%, rgba(17, 19, 18, 0) 100%), rgba(17, 19, 18, 0.18);
      content: '';
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
      backdrop-filter: blur(16px);
    }
    .search-controls.is-stuck::before {
      opacity: 1;
    }
    .title-field {
      height: 50px;
    }
    .title-field input {
      font-size: 15px;
    }
    .search-state {
      min-height: 236px;
      padding: 28px 12px;
    }
    .search-state span {
      font-size: 14px;
    }
    .cinema-wall {
      gap: 10px;
    }
    .spotlight-card {
      aspect-ratio: 4 / 5;
    }
    .poster-wall {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px 10px;
    }
    .more-poster-wall {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px 8px;
      margin-top: 10px;
    }
    .more-poster-wall .poster-card,
    .more-poster-wall .poster-card.is-wide {
      grid-column: span 1;
    }
    .more-poster-wall .poster-card-copy {
      right: 7px;
      bottom: 7px;
      left: 7px;
      gap: 2px;
    }
    .more-poster-wall .poster-card-meta,
    .more-poster-wall .poster-card-copy em {
      display: none;
    }
    .more-poster-wall .poster-card-copy strong {
      font-size: 12px;
      line-height: 1.2;
    }
    .poster-card,
    .poster-card.is-wide {
      grid-column: span 1;
      aspect-ratio: 2 / 3;
    }
    .spotlight-copy {
      right: 16px;
      bottom: 16px;
      left: 16px;
    }
    .poster-card-copy {
      right: 10px;
      bottom: 10px;
      left: 10px;
    }
    .spotlight-copy strong,
    .poster-card-copy strong,
    .poster-card.is-wide .poster-card-copy strong {
      font-size: 14px;
      line-height: 1.25;
    }
    .spotlight-copy strong {
      font-size: 22px;
      line-height: 1.08;
    }
    .spotlight-card,
    .poster-card {
      border-radius: 5px;
    }
    .load-more-row {
      padding-top: 24px;
      padding-bottom: 54px;
    }
  }
  @media (max-width: 420px) {
    .search-shell {
      padding-right: 14px;
      padding-left: 14px;
    }
    .search-heading h1 {
      font-size: 36px;
    }
    .search-heading p {
      font-size: 13px;
      line-height: 1.6;
    }
    .search-controls {
      padding: 0;
    }
    .title-field {
      height: 46px;
      padding: 0 11px;
    }
    .poster-wall {
      gap: 12px 8px;
    }
    .resource-toast {
      min-height: 40px;
      padding: 0 12px;
      font-size: 13px;
    }
  }
</style>
