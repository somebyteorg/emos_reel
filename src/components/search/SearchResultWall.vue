<script lang="ts" setup>
import { computed } from 'vue'
import type { TodbVideoListItem } from '@/api/types'
import SearchResultCard from '@/components/search/SearchResultCard.vue'

const props = defineProps<{
    items: TodbVideoListItem[]
    openingVideoId: number | null
    pageSize: number
  }>()

  const emit = defineEmits<{
    open: [item: TodbVideoListItem]
    preview: [item: TodbVideoListItem]
    restore: []
  }>()

  const firstItem = computed(() => props.items[0])
  const firstPageItems = computed(() => props.items.slice(1, props.pageSize))
  const moreItems = computed(() => props.items.slice(props.pageSize))
  const opening = computed(() => props.openingVideoId != null)

  function isOpeningTarget(item: TodbVideoListItem) {
    return props.openingVideoId === item.video_id
  }

  function isMuted(item: TodbVideoListItem) {
    return opening.value && !isOpeningTarget(item)
  }

  function posterCardClass(index: number) {
    return index >= 6 && index % 9 === 4
  }
</script>

<template>
  <section v-if="firstItem" :class="{ 'is-opening': opening }" aria-label="搜索结果" class="cinema-wall" @mouseleave="emit('restore')">
    <SearchResultCard :item="firstItem" :muted="isMuted(firstItem)" :opening="isOpeningTarget(firstItem)" spotlight @open="emit('open', $event)" @preview="emit('preview', $event)" />

    <div v-if="firstPageItems.length" class="poster-wall">
      <SearchResultCard
        v-for="(item, index) in firstPageItems"
        :key="item.video_id"
        :item="item"
        :muted="isMuted(item)"
        :opening="isOpeningTarget(item)"
        :wide="posterCardClass(index)"
        @open="emit('open', $event)"
        @preview="emit('preview', $event)" />
    </div>
  </section>

  <section v-if="moreItems.length" :class="{ 'is-opening': opening }" aria-label="更多搜索结果" class="poster-wall more-poster-wall" @mouseleave="emit('restore')">
    <SearchResultCard
      v-for="(item, index) in moreItems"
      :key="item.video_id"
      :item="item"
      :muted="isMuted(item)"
      :opening="isOpeningTarget(item)"
      :wide="posterCardClass(index + pageSize - 1)"
      @open="emit('open', $event)"
      @preview="emit('preview', $event)" />
  </section>
</template>
