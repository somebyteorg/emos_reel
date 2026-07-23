import { watch } from 'vue'
import { getUserBase } from '@/api/emos'
import { useSignStore } from '@/stores/sign'
import type { UserBase } from '@/api/types'

let loadedToken = ''
let pendingToken = ''
let pendingRequest: Promise<UserBase> | null = null

function loadUserBaseOnce(token: string) {
  const signStore = useSignStore()
  if (loadedToken === token && signStore.user) return Promise.resolve(signStore.user)
  if (pendingToken === token && pendingRequest) return pendingRequest

  pendingToken = token
  pendingRequest = getUserBase()
    .then((user) => {
      loadedToken = token
      return user
    })
    .finally(() => {
      if (pendingToken === token) {
        pendingToken = ''
        pendingRequest = null
      }
    })
  return pendingRequest
}

export function useUserBase() {
  const signStore = useSignStore()
  let requestVersion = 0

  watch(
    () => signStore.user_token,
    async (token) => {
      const currentRequest = ++requestVersion
      if (!token) {
        loadedToken = ''
        pendingToken = ''
        pendingRequest = null
        signStore.clearUser()
        return
      }

      try {
        const user = await loadUserBaseOnce(token)
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
