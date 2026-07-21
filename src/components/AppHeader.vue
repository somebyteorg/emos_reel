<script lang="ts" setup>
import { ArrowLeft, LogOut, UserRound } from '@lucide/vue'
import { ref, watch } from 'vue'

const props = withDefaults(
    defineProps<{
      signedIn: boolean
      username?: string
      avatar?: string | null
      showBack?: boolean
    }>(),
    {
      username: '',
      avatar: null,
      showBack: false,
    },
  )

  const emit = defineEmits<{
    back: []
    brand: []
    signout: []
  }>()

  const avatarUnavailable = ref(false)

  function signOut() {
    emit('signout')
  }

  watch(
    () => props.avatar,
    () => {
      avatarUnavailable.value = false
    },
  )
</script>

<template>
  <header class="app-header">
    <div class="header-leading">
      <button v-if="showBack" aria-label="返回" class="header-icon-button" type="button" @click="emit('back')">
        <ArrowLeft :size="20" />
      </button>
      <button aria-label="换一部影片" class="brand-button" type="button" @click="emit('brand')">
        <span class="brand-main">EMOS</span>
        <span class="brand-sub">REEL</span>
      </button>
    </div>

    <div v-if="signedIn" class="account-root">
      <div class="account-session">
        <div class="account-identity">
          <img v-if="avatar && !avatarUnavailable" :src="avatar" alt="" class="account-avatar" @error="avatarUnavailable = true" />
          <UserRound v-else :size="17" />
          <span>{{ username || '已登录' }}</span>
        </div>
        <button aria-label="退出登录" class="signout-button" type="button" @click="signOut">
          <LogOut :size="15" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
  .app-header {
    position: relative;
    z-index: 30;
    display: flex;
    min-height: 76px;
    align-items: center;
    justify-content: space-between;
    padding: 16px clamp(18px, 4vw, 64px);
  }
  .header-leading {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .header-icon-button,
  .account-session {
    display: inline-flex;
    height: 40px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid var(--reel-line);
    border-radius: 5px;
    background: var(--reel-surface-glass);
    color: var(--reel-text);
    backdrop-filter: blur(14px);
  }
  .header-icon-button {
    width: 40px;
    padding: 0;
  }
  .account-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }
  .header-icon-button:hover {
    border-color: var(--reel-accent);
    background: var(--reel-accent-wash);
  }
  .brand-button {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 8px 0;
    border: 0;
    background: transparent;
    color: white;
    font: inherit;
  }
  .brand-main {
    font-size: 30px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0;
  }
  .brand-sub {
    color: var(--reel-accent);
    font-size: 16px;
    font-weight: 750;
    line-height: 1;
    letter-spacing: 0;
  }
  .account-root {
    min-width: 0;
  }
  .account-session {
    height: 42px;
    gap: 0;
    overflow: hidden;
  }
  .account-identity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding: 0 13px;
  }
  .account-identity > span {
    max-width: min(220px, 24vw);
    overflow: hidden;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .signout-button {
    display: inline-grid;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    place-items: center;
    margin-right: 3px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
  }
  .signout-button:hover {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.82);
  }
  @media (max-width: 640px) {
    .app-header {
      min-height: 64px;
      padding-top: 12px;
      padding-bottom: 12px;
    }
    .account-identity {
      padding: 0 9px;
    }
    .account-identity > span {
      max-width: 72px;
      font-size: 12px;
    }
    .brand-main {
      font-size: 22px;
    }
    .brand-sub {
      font-size: 12px;
    }
  }
</style>
