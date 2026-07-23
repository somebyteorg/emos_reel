<script lang="ts" setup>
  import { AlertCircle, LoaderCircle, RotateCw } from '@lucide/vue'
  import { onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { getErrorStatus, getRandomReel } from '@/api/emos'

  const router = useRouter()
  const loading = ref(true)
  const message = ref('')

  async function openRandomReel() {
    loading.value = true
    message.value = ''
    try {
      const reel = await getRandomReel()
      if (!reel.forge_reel_uuid) throw new Error('Missing forge_reel_uuid')
      await router.replace({ name: 'video', params: { forgeReelUuid: reel.forge_reel_uuid } })
    } catch (error) {
      message.value = getErrorStatus(error) === 404 ? '片库正在准备下一场放映' : '暂时无法连接片库'
    } finally {
      loading.value = false
    }
  }

  onMounted(() => void openRandomReel())
</script>

<template>
  <main class="home-gate">
    <section v-if="loading" aria-live="polite" class="gate-status">
      <span class="gate-brand">
        <strong>EMOS</strong>
        <small>REEL</small>
      </span>
      <LoaderCircle :size="20" class="animate-spin" />
      <p>正在为你选片</p>
    </section>
    <section v-else aria-live="polite" class="gate-status">
      <span class="gate-mark gate-mark-error"><AlertCircle :size="26" /></span>
      <h1>{{ message }}</h1>
      <button class="gate-retry" type="button" @click="openRandomReel">
        <RotateCw :size="17" />
        再试一次
      </button>
    </section>
  </main>
</template>
