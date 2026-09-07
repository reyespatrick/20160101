<script setup>
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const online = ref(navigator.onLine)

onMounted(() => {
  auth.restore()
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
})
</script>

<template>
  <div class="app">
    <AppHeader v-if="auth.isAuthenticated" />
    <div v-if="!online" class="offline-bar">Sin conexión · mostrando datos guardados</div>
    <main>
      <RouterView />
    </main>
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
