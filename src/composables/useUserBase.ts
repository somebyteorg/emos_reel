import { watch } from 'vue'
import { getUserBase } from '@/api/emos'
import { useSignStore } from '@/stores/sign'

export function useUserBase() {
  const signStore = useSignStore()
  let requestVersion = 0

  watch(
    () => signStore.user_token,
    async (token) => {
      const currentRequest = ++requestVersion
      if (!token) {
        signStore.clearUser()
        return
      }

      try {
        const user = await getUserBase()
        if (currentRequest === requestVersion && signStore.user_token === token) {
          signStore.setUser(user)
        }
      } catch {
        // The ky 401 hook signs out; transient failures keep the last known profile.
      }
    },
    { immediate: true },
  )
}
