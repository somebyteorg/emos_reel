<script lang="ts" setup>
  import { AlertCircle, ExternalLink, House, RotateCw } from '@lucide/vue'
  import PlayerErrorVersionPicker from '@/components/PlayerErrorVersionPicker.vue'
  import type { MediaVersion } from '@/api/types'

  defineProps<{
    manifestNotFound: boolean
    message: string
    selectedMediaId: string
    switchingVersion: boolean
    technicalMessage: string
    versions: MediaVersion[]
  }>()

  defineEmits<{
    reload: []
    returnHome: []
    selectVersion: [mediaId: string]
  }>()
</script>

<template>
  <section class="player-error-overlay">
    <div class="player-error-heading">
      <AlertCircle :size="27" />
      <h1>{{ message }}</h1>
    </div>
    <div v-if="technicalMessage" class="player-error-cause">
      <span>错误详情</span>
      <code>{{ technicalMessage }}</code>
    </div>
    <div v-if="manifestNotFound" class="player-error-actions">
      <button class="primary-button" type="button" @click="$emit('returnHome')">
        <House :size="17" />
        返回主页
      </button>
    </div>
    <div v-else :class="{ 'has-version-switcher': versions.length > 1 }" class="player-error-actions">
      <button class="primary-button" type="button" @click="$emit('reload')">
        <RotateCw :size="17" />
        重新载入
      </button>
      <PlayerErrorVersionPicker v-if="versions.length > 1" :selected-media-id="selectedMediaId" :switching="switchingVersion" :versions="versions" @select="$emit('selectVersion', $event)" />
      <a class="secondary-button" href="https://voice.somebyte.org/project/250823" rel="noopener noreferrer" target="_blank">
        <ExternalLink :size="17" />
        反馈问题
      </a>
    </div>
  </section>
</template>

<style scoped>
  .player-error-overlay {
    position: absolute;
    z-index: 7;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    padding: 24px;
    background: rgba(0, 0, 0, 0.66);
    color: rgba(255, 255, 255, 0.68);
    text-align: center;
    backdrop-filter: blur(8px);
  }
  .player-error-heading {
    display: flex;
    width: min(900px, 92vw);
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .player-error-heading svg {
    flex: 0 0 auto;
  }
  .player-error-heading h1 {
    min-width: 0;
    overflow-wrap: anywhere;
    margin: 0;
    color: white;
    font-size: 24px;
    line-height: 1.45;
  }
  .player-error-cause {
    display: grid;
    width: min(720px, 92vw);
    max-height: 120px;
    gap: 5px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    background: rgba(12, 13, 15, 0.76);
    color: rgba(255, 255, 255, 0.58);
    text-align: left;
  }
  .player-error-cause span {
    font-size: 10px;
    font-weight: 700;
  }
  .player-error-cause code {
    color: rgba(255, 255, 255, 0.82);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .player-error-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }

  @media (max-width: 620px) {
    .player-error-heading h1 {
      font-size: 20px;
    }
    .player-error-cause {
      font-size: 11px;
    }
    .player-error-actions {
      display: grid;
      width: min(300px, 100%);
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .player-error-actions > .primary-button {
      grid-column: 1 / -1;
      width: 100%;
    }
    .player-error-actions > .secondary-button {
      grid-column: 1 / -1;
      width: 100%;
    }
    .player-error-actions.has-version-switcher > .secondary-button {
      grid-column: auto;
    }
  }
</style>
