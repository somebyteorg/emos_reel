<script lang="ts" setup>
  import { AlertCircle, Film, LoaderCircle, Search } from '@lucide/vue'

  defineProps<{
    message: string
    retryable?: boolean
    state: 'empty' | 'error' | 'idle' | 'loading'
  }>()

  const emit = defineEmits<{
    retry: []
  }>()
</script>

<template>
  <section :class="`is-${state}`" aria-live="polite" class="search-state">
    <LoaderCircle v-if="state === 'loading'" :size="24" class="animate-spin" />
    <AlertCircle v-else-if="state === 'error'" :size="24" />
    <Search v-else-if="state === 'idle'" :size="26" />
    <Film v-else :size="26" />
    <span>{{ message }}</span>
    <button v-if="retryable" class="secondary-button" type="button" @click="emit('retry')">重试</button>
  </section>
</template>
