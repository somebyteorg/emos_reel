import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { UserBase } from '@/api/types'

const returnPathKey = 'emos_reel.sign.return_path'

export const useSignStore = defineStore(
  'sign',
  () => {
    const user_token = ref('')
    const user = ref<UserBase | null>(null)
    const isSignedIn = computed(() => Boolean(user_token.value))
    const username = computed(() => user.value?.username ?? '')

    function setToken(token: string) {
      if (token !== user_token.value) user.value = null
      user_token.value = token
    }

    function setUser(nextUser: UserBase) {
      user.value = nextUser
    }

    function clearUser() {
      user.value = null
    }

    function loginUrl() {
      const path = 'api/sign?state=emos_reel'
      return import.meta.env.DEV ? `/emos/${path}` : `https://emos.best/${path}`
    }

    function rememberReturnPath(path: string) {
      sessionStorage.setItem(returnPathKey, path.startsWith('/') ? path : '/')
    }

    function consumeReturnPath() {
      const path = sessionStorage.getItem(returnPathKey) || '/'
      sessionStorage.removeItem(returnPathKey)
      return path
    }

    async function signOut() {
      user.value = null
      user_token.value = ''
    }

    return {
      user,
      username,
      user_token,
      isSignedIn,
      clearUser,
      setUser,
      setToken,
      loginUrl,
      rememberReturnPath,
      consumeReturnPath,
      signOut,
    }
  },
  { persist: true },
)

export default useSignStore
