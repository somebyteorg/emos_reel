<script lang="ts" setup>
  import { Film, LoaderCircle, Tv } from '@lucide/vue'
  import type { TodbVideoListItem } from '@/api/types'
  import { todbPosterUrl, todbSpotlightPosterUrl, todbVideoTypeLabel, todbYearLabel } from '@/utils/todb-video-list-item'

  const props = withDefaults(
    defineProps<{
      item: TodbVideoListItem
      muted?: boolean
      opening?: boolean
      spotlight?: boolean
      wide?: boolean
    }>(),
    {
      muted: false,
      opening: false,
      spotlight: false,
      wide: false,
    },
  )

  const emit = defineEmits<{
    open: [item: TodbVideoListItem]
    preview: [item: TodbVideoListItem]
  }>()

  function imageSource(item: TodbVideoListItem) {
    return props.spotlight ? todbSpotlightPosterUrl(item) : todbPosterUrl(item)
  }
</script>

<template>
  <button
    :aria-busy="opening"
    :class="[
      spotlight ? 'spotlight-card' : 'poster-card',
      {
        'is-opening-muted': muted,
        'is-opening-target': opening,
        'is-wide': wide && !spotlight,
      },
    ]"
    :disabled="opening || muted"
    type="button"
    @click="emit('open', item)"
    @focus="emit('preview', item)"
    @mouseenter="emit('preview', item)">
    <span v-if="opening" class="opening-overlay">
      <LoaderCircle :size="spotlight ? 28 : 24" class="animate-spin" />
    </span>
    <img v-if="imageSource(item)" :alt="item.video_title" :loading="spotlight ? 'eager' : 'lazy'" :src="imageSource(item)" />
    <span v-else class="poster-empty">
      <Film :size="spotlight ? 42 : 32" />
    </span>
    <span :class="spotlight ? 'spotlight-copy' : 'poster-card-copy'">
      <span class="poster-card-meta">
        <Tv v-if="item.video_type === 'tv'" :size="spotlight ? 13 : 12" />
        <Film v-else :size="spotlight ? 13 : 12" />
        {{ todbYearLabel(item) }} · {{ todbVideoTypeLabel(item.video_type) }}
      </span>
      <strong>{{ item.video_title }}</strong>
      <em v-if="item.origin_title && item.origin_title !== item.video_title">{{ item.origin_title }}</em>
    </span>
  </button>
</template>
