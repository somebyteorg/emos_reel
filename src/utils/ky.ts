import ky from 'ky'
import { useSignStore } from '@/stores/sign'

const emos = ky.create({
  prefixUrl: import.meta.env.PROD ? 'https://emos.best/' : '/emos',
  timeout: 30_000,
  retry: 0,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useSignStore().user_token
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) await useSignStore().signOut()
      },
    ],
  },
})

const todb = ky.create({
  prefixUrl: import.meta.env.PROD ? 'https://theotherdb.org/api' : '/todb',
  timeout: 30_000,
  retry: 0,
})

export { emos, todb }
