<script lang="ts" setup>
  import { X } from '@lucide/vue'
  import { useEventListener, useScrollLock } from '@vueuse/core'
  import { watch } from 'vue'

  const props = defineProps<{ open: boolean; title: string; description: string }>()
  const emit = defineEmits<{ close: [] }>()
  const bodyLocked = useScrollLock(document.body)

  watch(
    () => props.open,
    (open) => {
      bodyLocked.value = open
    },
    { immediate: true },
  )
  useEventListener(document, 'keydown', (event) => {
    if (props.open && event.key === 'Escape') emit('close')
  })
</script>

<template>
  <Teleport to="body">
    <Transition name="description-drawer">
      <div v-if="open" class="description-backdrop" @click.self="emit('close')">
        <aside aria-labelledby="description-title" aria-modal="true" class="description-panel" role="dialog">
          <header>
            <div>
              <span>影片简介</span>
              <h2 id="description-title">{{ title }}</h2>
            </div>
            <button aria-label="关闭" type="button" @click="emit('close')"><X :size="20" /></button>
          </header>
          <p>{{ description }}</p>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
  .description-backdrop {
    position: fixed;
    z-index: 95;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    background: rgba(0, 0, 0, 0.68);
    backdrop-filter: blur(10px);
  }
  .description-panel {
    display: grid;
    width: min(560px, 100%);
    height: 100%;
    grid-template-rows: auto 1fr;
    border-left: 1px solid rgba(112, 183, 173, 0.28);
    background: var(--reel-surface-raised);
    color: var(--reel-text);
    box-shadow: -28px 0 80px rgba(0, 0, 0, 0.5);
  }
  .description-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 26px 30px;
    border-bottom: 1px solid var(--reel-line);
    background: var(--reel-surface-elevated);
  }
  .description-panel header span {
    color: var(--reel-film);
    font-size: 12px;
    font-weight: 700;
  }
  .description-panel h2 {
    margin: 8px 0 0;
    overflow-wrap: anywhere;
    color: var(--reel-text);
    font-size: 27px;
    font-weight: 650;
    letter-spacing: 0;
  }
  .description-panel button {
    display: grid;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--reel-muted);
  }
  .description-panel button:hover {
    background: var(--reel-hover);
    color: white;
  }
  .description-panel > p {
    overflow-y: auto;
    margin: 0;
    padding: 30px;
    color: var(--reel-text-secondary);
    font-size: 16px;
    line-height: 1.9;
  }
  .description-drawer-enter-active,
  .description-drawer-leave-active {
    transition: opacity 0.22s ease;
  }
  .description-drawer-enter-active .description-panel,
  .description-drawer-leave-active .description-panel {
    transition: transform 0.28s cubic-bezier(0.22, 0.72, 0.25, 1);
  }
  .description-drawer-enter-from,
  .description-drawer-leave-to {
    opacity: 0;
  }
  .description-drawer-enter-from .description-panel,
  .description-drawer-leave-to .description-panel {
    transform: translateX(100%);
  }
  @media (max-width: 600px) {
    .description-backdrop {
      align-items: flex-end;
    }
    .description-panel {
      width: 100%;
      height: min(52svh, 520px);
      border-top: 1px solid rgba(112, 183, 173, 0.28);
      border-left: 0;
      border-radius: 7px 7px 0 0;
      box-shadow: 0 -20px 54px rgba(0, 0, 0, 0.44);
    }
    .description-panel header,
    .description-panel > p {
      padding-right: 20px;
      padding-left: 20px;
    }
    .description-panel header span {
      font-size: 12px;
    }
    .description-panel h2 {
      font-size: 22px;
    }
    .description-panel > p {
      font-size: 15px;
      line-height: 1.8;
    }
    .description-drawer-enter-from .description-panel,
    .description-drawer-leave-to .description-panel {
      transform: translateY(100%);
    }
  }
</style>
