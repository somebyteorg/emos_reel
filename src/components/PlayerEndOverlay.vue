<script lang="ts" setup>
  import { LoaderCircle, Play, RotateCcw, X } from '@lucide/vue'

  defineProps<{
    resolving: boolean
    hasNext: boolean
    episodeLabel: string
    episodeTitle: string
    countdown: number
  }>()

  defineEmits<{
    next: []
    replay: []
    close: []
  }>()
</script>

<template>
  <aside class="end-overlay">
    <button aria-label="关闭" class="end-close" type="button" @click="$emit('close')"><X :size="18" /></button>
    <span>{{ resolving ? '正在检查可播放资源' : hasNext ? `${countdown} 秒后播放` : '播放结束' }}</span>
    <strong v-if="resolving" class="resolving-title">
      <LoaderCircle :size="18" class="animate-spin" />
      正在准备下一集
    </strong>
    <strong v-else>{{ hasNext ? episodeLabel : '感谢观看' }}</strong>
    <p v-if="hasNext && !resolving">{{ episodeTitle }}</p>
    <button v-if="hasNext && !resolving" class="end-action" type="button" @click="$emit('next')">
      <Play :size="17" fill="currentColor" />
      立即播放
    </button>
    <button v-else-if="!resolving" class="end-action" type="button" @click="$emit('replay')">
      <RotateCcw :size="17" />
      重新播放
    </button>
    <i v-if="hasNext && !resolving" :style="{ '--countdown-progress': `${(countdown / 8) * 100}%` }"></i>
  </aside>
</template>

<style scoped>
  .end-overlay {
    position: absolute;
    z-index: 7;
    right: clamp(14px, 3vw, 38px);
    bottom: 104px;
    display: grid;
    width: min(350px, calc(100vw - 28px));
    gap: 6px;
    overflow: hidden;
    padding: 17px 48px 17px 18px;
    border: 1px solid var(--reel-line);
    border-radius: 6px;
    background: var(--reel-surface-overlay);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(12px);
  }
  .end-overlay > span {
    color: var(--reel-film);
    font-size: 11px;
    font-weight: 700;
  }
  .end-overlay > strong {
    overflow: hidden;
    font-size: 18px;
    font-weight: 680;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .end-overlay > strong.resolving-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .end-overlay > p {
    overflow: hidden;
    margin: 0;
    color: rgba(255, 255, 255, 0.62);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .end-close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: rgba(255, 255, 255, 0.62);
  }
  .end-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  .end-action {
    display: inline-flex;
    width: max-content;
    min-height: 38px;
    align-items: center;
    gap: 7px;
    margin-top: 7px;
    padding: 0 13px;
    border: 0;
    border-radius: 4px;
    background: var(--reel-action);
    color: var(--reel-on-action);
    font: inherit;
    font-size: 13px;
    font-weight: 750;
  }
  .end-action:hover {
    background: var(--reel-action-hover);
  }
  .end-overlay > i {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--reel-accent) var(--countdown-progress), rgba(255, 255, 255, 0.12) var(--countdown-progress));
    transition: background 0.2s linear;
  }
  @media (max-width: 620px) {
    .end-overlay {
      right: 10px;
      bottom: 128px;
      width: min(330px, calc(100vw - 20px));
      padding: 14px 44px 14px 15px;
    }
    .end-overlay > strong {
      font-size: 16px;
    }
    .end-overlay > p {
      font-size: 12px;
    }
  }
</style>
