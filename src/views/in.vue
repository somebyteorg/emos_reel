<script lang="ts" setup>
  import { LoaderCircle, TriangleAlert } from '@lucide/vue'
  import { onMounted, ref } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useSignStore } from '@/stores/sign'

  type Status = 'loading' | 'error'

  const route = useRoute()
  const router = useRouter()
  const signStore = useSignStore()
  const status = ref<Status>('loading')
  const message = ref('正在确认登录状态')

  function finishSignIn() {
    const token = typeof route.query.token === 'string' ? route.query.token : ''
    if (!token) {
      status.value = 'error'
      message.value = '登录失败，请重试。'
      return
    }
    signStore.setToken(token)
    void router.replace(signStore.consumeReturnPath())
  }

  onMounted(finishSignIn)
</script>

<template>
  <main class="signin-page">
    <section aria-live="polite" class="signin-status">
      <LoaderCircle v-if="status === 'loading'" :size="28" class="animate-spin" />
      <TriangleAlert v-else :size="28" />
      <h1>{{ message }}</h1>
      <button v-if="status === 'error'" class="secondary-button" type="button" @click="router.replace('/')">回到首页</button>
    </section>
  </main>
</template>
