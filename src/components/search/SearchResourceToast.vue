<script lang="ts" setup>
  import { AlertCircle } from '@lucide/vue'

  defineProps<{
    message: string
  }>()
</script>

<template>
  <Transition name="resource-toast">
    <div v-if="message" class="resource-toast" role="status">
      <AlertCircle :size="16" />
      <span>{{ message }}</span>
    </div>
  </Transition>
</template>
