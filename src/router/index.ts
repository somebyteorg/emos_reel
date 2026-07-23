import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/home.vue'
import InView from '@/views/in.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/search',
      name: 'search',
      component: () => import('@/views/SearchView.vue'),
      meta: { keepAlive: true },
    },
    {
      path: '/video/:forgeReelUuid',
      name: 'video',
      component: () => import('@/views/VideoView.vue'),
      props: true,
    },
    {
      path: '/player/:mediaId',
      name: 'player',
      component: () => import('@/views/PlayerView.vue'),
      props: true,
    },
    {
      path: '/in',
      name: 'in',
      component: InView,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
})

export default router
