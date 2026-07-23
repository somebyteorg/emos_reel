<template>
  <RouterView v-slot="{ Component, route }">
    <KeepAlive>
      <component :is="Component" v-if="route.meta.keepAlive" />
    </KeepAlive>
    <component :is="Component" v-if="!route.meta.keepAlive" />
  </RouterView>
</template>
