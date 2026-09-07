<script setup>
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import BottomNav from './components/BottomNav.vue'
import { useAuthStore } from './stores/auth'
import { useClientsStore } from './stores/clients'
import { useLocalPropertiesStore } from './stores/localProperties'
import { useEnumsStore } from './stores/enums'

const auth = useAuthStore()
const clients = useClientsStore()
const localProperties = useLocalPropertiesStore()
const enums = useEnumsStore()
const online = ref(navigator.onLine)

function syncAll() {
  clients.sync()
  localProperties.sync()
}

onMounted(() => {
  auth.restore()
  window.addEventListener('online', () => {
    online.value = true
    syncAll() // flush edits made while offline
  })
  window.addEventListener('offline', () => (online.value = false))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth.isAuthenticated) syncAll()
  })
  if (auth.isAuthenticated) {
    enums.restore()
    clients.load().then(() => clients.sync())
    localProperties.load().then(() => localProperties.sync())
  }
})
</script>

<template>
  <div class="app">
    <AppHeader v-if="auth.isAuthenticated" />
    <div v-if="!online" class="offline-bar">Sin conexión · los cambios se guardan en este dispositivo</div>
    <main>
      <RouterView />
    </main>
    <BottomNav v-if="auth.isAuthenticated" />
  </div>
</template>

<style scoped>
.app { min-height: 100dvh; display: flex; flex-direction: column; }
main { flex: 1; }
.offline-bar {
  background: var(--accent);
  color: #fff;
  text-align: center;
  font-size: 0.85rem;
  padding: 0.35rem;
  font-weight: 600;
}
</style>
