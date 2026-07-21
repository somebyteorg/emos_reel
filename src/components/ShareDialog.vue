<script lang="ts" setup>
import dayjs from 'dayjs'
import durationPlugin from 'dayjs/plugin/duration'
import { Check, Clipboard, X } from '@lucide/vue'
import { useClipboard } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

dayjs.extend(durationPlugin)

  const props = defineProps<{ open: boolean; title: string; currentTime: number }>()
  const emit = defineEmits<{ close: [] }>()
  const route = useRoute()
  const includeProgress = ref(true)
  const progressLabel = computed(() => dayjs.duration(Math.max(0, props.currentTime), 'seconds').format(props.currentTime >= 3600 ? 'HH:mm:ss' : 'mm:ss'))
  const shareUrl = computed(() => {
    const url = new URL(route.fullPath, window.location.origin)
    url.searchParams.delete('t')
    if (includeProgress.value && props.currentTime >= 1) {
      url.searchParams.set('t', String(Math.floor(props.currentTime)))
    }
    return url.toString()
  })
  const { copy, copied } = useClipboard({ source: shareUrl, copiedDuring: 1600 })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="share-backdrop" @click.self="emit('close')">
        <section aria-labelledby="share-title" aria-modal="true" class="share-dialog" role="dialog">
          <header>
            <div>
              <span>分享放映</span>
              <h2 id="share-title">{{ title }}</h2>
            </div>
            <button aria-label="关闭" type="button" @click="emit('close')"><X :size="20" /></button>
          </header>
          <label class="progress-choice">
            <input v-model="includeProgress" type="checkbox" />
            <span>
              <strong>包含当前播放进度</strong>
              <small>{{ progressLabel }}</small>
            </span>
          </label>
          <div class="share-link">
            <span>{{ shareUrl }}</span>
          </div>
          <div class="share-actions">
            <button class="primary-button" type="button" @click="copy(shareUrl)">
              <Check v-if="copied" :size="17" />
              <Clipboard v-else :size="17" />
              {{ copied ? '已复制' : '复制链接' }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
  .share-backdrop {
    position: fixed;
    z-index: 100;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(12px);
  }
  .share-dialog {
    width: min(470px, 100%);
    padding: 22px;
    border: 1px solid var(--reel-line);
    border-radius: 7px;
    background: var(--reel-surface-raised);
    color: white;
    box-shadow: 0 28px 90px rgba(0, 0, 0, 0.65);
  }
  .share-dialog header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 20px;
  }
  .share-dialog header span {
    color: var(--reel-accent-soft);
    font-size: 12px;
    font-weight: 700;
  }
  .share-dialog h2 {
    margin: 6px 0 0;
    font-size: 25px;
    font-weight: 680;
    letter-spacing: 0;
  }
  .share-dialog header button {
    display: grid;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
  }
  .share-dialog header button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .progress-choice {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-top: 24px;
    padding: 13px;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-surface);
  }
  .progress-choice input {
    width: 17px;
    height: 17px;
    accent-color: var(--reel-accent);
  }
  .progress-choice span {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .progress-choice strong {
    font-size: 15px;
  }
  .progress-choice small {
    color: var(--reel-muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .share-link {
    overflow: hidden;
    margin-top: 10px;
    padding: 13px 14px;
    border: 1px solid var(--reel-line);
    border-radius: 4px;
    background: var(--reel-bg);
    color: var(--reel-muted);
    font-size: 13px;
  }
  .share-link span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .share-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 19px;
  }
  .modal-fade-enter-active,
  .modal-fade-leave-active {
    transition: opacity 0.2s ease;
  }
  .modal-fade-enter-from,
  .modal-fade-leave-to {
    opacity: 0;
  }
  @media (max-width: 620px) {
    .share-dialog {
      padding: 19px;
    }
    .share-dialog header span {
      font-size: 12px;
    }
    .share-dialog h2 {
      font-size: 21px;
    }
    .progress-choice strong {
      font-size: 14px;
    }
    .progress-choice small {
      font-size: 12px;
    }
    .share-link {
      font-size: 12px;
    }
    .share-actions {
      display: grid;
    }
  }
</style>
