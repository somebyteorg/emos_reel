<script lang="ts" setup>
  defineProps<{
    current?: string
    outgoing?: string
  }>()
</script>

<template>
  <img v-if="outgoing" :key="`out-${outgoing}`" :src="outgoing" alt="" aria-hidden="true" class="search-backdrop search-backdrop-outgoing" />
  <img v-if="current" :key="`in-${current}`" :src="current" alt="" aria-hidden="true" class="search-backdrop search-backdrop-current" />
</template>
