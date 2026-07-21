<script lang="ts" setup>
import { ArrowDown01, ArrowDown10 } from '@lucide/vue'

const props = defineProps<{
    modelValue: 'asc' | 'desc'
  }>()

  const emit = defineEmits<{
    'update:modelValue': [order: 'asc' | 'desc']
  }>()

  function toggleOrder() {
    emit('update:modelValue', props.modelValue === 'asc' ? 'desc' : 'asc')
  }
</script>

<template>
  <div class="episode-sort">
    <button :aria-label="modelValue === 'asc' ? '当前按集数正序，点击切换为倒序' : '当前按集数倒序，点击切换为正序'" type="button" @click="toggleOrder">
      <ArrowDown01 v-if="modelValue === 'asc'" :size="17" />
      <ArrowDown10 v-else :size="17" />
    </button>
  </div>
</template>

<style scoped>
  .episode-sort {
    display: grid;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    place-items: center;
  }
  .episode-sort button {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.52);
  }
  .episode-sort button:hover {
    border-color: rgba(255, 255, 255, 0.24);
    background: rgba(255, 255, 255, 0.055);
    color: white;
  }
  @media (max-width: 620px) {
    .episode-sort {
      width: 40px;
      height: 40px;
    }
  }
</style>
