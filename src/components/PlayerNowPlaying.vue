<script lang="ts" setup>
defineProps<{
  title: string
  meta: string
}>()
</script>

<template>
  <section aria-label="当前播放" class="now-playing">
    <span v-if="meta">{{ meta }}</span>
    <strong>{{ title }}</strong>
  </section>
</template>

<style scoped>
.now-playing { display: grid; max-width: min(720px,70vw); gap: 5px; margin-bottom: 14px; text-shadow: 0 2px 14px rgba(0,0,0,.88); pointer-events: none; }
.now-playing span { color: var(--reel-film); font-size: 12px; font-weight: 700; }
.now-playing strong { overflow: hidden; font-size: 22px; font-weight: 680; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 620px) {
  .now-playing { display: none; }
}
</style>
