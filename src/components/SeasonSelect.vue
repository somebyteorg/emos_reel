<script lang="ts" setup>
import { Check, ChevronDown } from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'
import type { SeasonInfo } from '@/api/types'

const props = defineProps<{
    seasons: SeasonInfo[]
    modelValue: number | null
  }>()

  const emit = defineEmits<{ select: [seasonNumber: number] }>()
  const root = ref<HTMLElement>()
  const trigger = ref<HTMLButtonElement>()
  const open = ref(false)
  const selectedSeason = computed(() => props.seasons.find((season) => season.season_number === props.modelValue) ?? props.seasons[0])

  function closeMenu(restoreFocus = false) {
    open.value = false
    if (restoreFocus) nextTick(() => trigger.value?.focus())
  }

  function chooseSeason(seasonNumber: number) {
    emit('select', seasonNumber)
    closeMenu(true)
  }

  function openWithKeyboard() {
    open.value = true
    nextTick(() => {
      const selected = root.value?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      selected?.focus()
    })
  }

  onClickOutside(root, () => closeMenu())
  watch(
    () => props.modelValue,
    () => {
      open.value = false
    },
  )
</script>

<template>
  <div ref="root" class="season-select-root" @keydown.esc.stop.prevent="closeMenu(true)">
    <button
      ref="trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      aria-label="选择季"
      class="season-trigger"
      type="button"
      @click="open = !open"
      @keydown.down.prevent="openWithKeyboard"
      @keydown.up.prevent="openWithKeyboard">
      <span>{{ selectedSeason?.season_title || '选择季' }}</span>
      <ChevronDown :class="{ rotated: open }" :size="16" />
    </button>

    <Transition name="season-menu">
      <div v-if="open" aria-label="选择季" class="season-menu" role="listbox">
        <button
          v-for="season in seasons"
          :key="season.season_id"
          :aria-selected="season.season_number === modelValue"
          :class="{ active: season.season_number === modelValue }"
          role="option"
          type="button"
          @click="chooseSeason(season.season_number)">
          <span>{{ season.season_title }}</span>
          <Check v-if="season.season_number === modelValue" :size="15" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
  .season-select-root {
    position: relative;
    min-width: 128px;
  }
  .season-trigger {
    display: grid;
    width: 100%;
    height: 44px;
    grid-template-columns: minmax(0, 1fr) 18px;
    align-items: center;
    gap: 10px;
    padding: 0 12px 0 14px;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-hover);
    color: rgba(255, 255, 255, 0.9);
    font: inherit;
    font-size: 16px;
    font-weight: 600;
    text-align: left;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.04);
    transition:
      border-color 0.16s ease,
      background-color 0.16s ease,
      color 0.16s ease;
  }
  .season-trigger:hover,
  .season-trigger[aria-expanded='true'] {
    border-color: var(--reel-line-strong);
    background: var(--reel-accent-wash);
    color: white;
  }
  .season-trigger:focus-visible {
    border-color: var(--reel-accent);
  }
  .season-trigger span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .season-trigger svg {
    color: var(--reel-muted);
    transition:
      color 0.16s ease,
      transform 0.18s ease;
  }
  .season-trigger:hover svg,
  .season-trigger[aria-expanded='true'] svg {
    color: var(--reel-accent-soft);
  }
  .season-trigger svg.rotated {
    transform: rotate(180deg);
  }
  .season-menu {
    position: absolute;
    z-index: 60;
    top: calc(100% + 8px);
    left: 0;
    width: max(100%, 220px);
    max-width: min(300px, calc(100vw - 40px));
    max-height: min(320px, 48svh);
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--reel-line);
    border-radius: 6px;
    background: var(--reel-surface-elevated);
    box-shadow: 0 20px 55px rgba(0, 0, 0, 0.48);
    scrollbar-color: rgba(255, 255, 255, 0.24) transparent;
  }
  .season-menu button {
    display: grid;
    width: 100%;
    min-height: 42px;
    grid-template-columns: minmax(0, 1fr) 18px;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font: inherit;
    font-size: 14px;
    text-align: left;
  }
  .season-menu button:hover,
  .season-menu button:focus-visible {
    background: var(--reel-hover);
    color: white;
  }
  .season-menu button.active {
    background: var(--reel-accent-wash);
    color: white;
  }
  .season-menu button span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .season-menu button svg {
    color: var(--reel-accent-soft);
  }
  .season-menu-enter-active,
  .season-menu-leave-active {
    transition:
      opacity 0.16s ease,
      transform 0.16s ease;
    transform-origin: top left;
  }
  .season-menu-enter-from,
  .season-menu-leave-to {
    opacity: 0;
    transform: translateY(-5px) scale(0.98);
  }

  @media (max-width: 620px) {
    .season-select-root {
      min-width: 0;
    }
    .season-trigger {
      height: 40px;
      gap: 5px;
      padding-right: 8px;
      padding-left: 9px;
      font-size: 13px;
    }
    .season-menu {
      width: min(240px, calc(100vw - 40px));
    }
    .season-menu button {
      min-height: 40px;
      font-size: 13px;
    }
  }
</style>
