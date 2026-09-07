<script setup>
import { onMounted, ref } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'

/**
 * Over-the-air updates. The service worker is checked every CHECK_MS, when the app comes
 * back to the foreground and when the network returns. When a new version is found a banner
 * announces it, the new worker is activated and the page reloads.
 */
const CHECK_MS = 30 * 60_000
const APPLY_DELAY_MS = 1800

const status = ref('idle') // idle | updating | ready
const { needRefresh, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine !== false) registration.update().catch(() => {})
    }
    setInterval(check, CHECK_MS)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
    window.addEventListener('online', check)
  },
  onRegisterError(err) {
    console.warn('[pwa] service worker registration failed', err)
  },
})

onMounted(() => {
  // Apply updates automatically after a short, visible pause
  const stop = setInterval(() => {
    if (needRefresh.value && status.value === 'idle') {
      status.value = 'updating'
      setTimeout(async () => {
        status.value = 'ready'
        try {
          await updateServiceWorker(true) // reloads the page once the new worker controls it
        } catch {
          window.location.reload()
        }
      }, APPLY_DELAY_MS)
    }
  }, 500)
  return () => clearInterval(stop)
})
</script>

<template>
  <Transition name="banner">
    <div v-if="status !== 'idle'" class="update" role="status" aria-live="polite">
      <span class="spinner-sm"></span>
      <span v-if="status === 'updating'">Nueva versión disponible · actualizando la app…</span>
      <span v-else>Listo · recargando</span>
    </div>
  </Transition>
</template>

<style scoped>
.update { display: flex; align-items: center; justify-content: center; gap: 0.6rem; background: var(--brand); color: #fff; font-weight: 600; font-size: 0.9rem; padding: 0.55rem 1rem; }
.spinner-sm { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.banner-enter-active, .banner-leave-active { transition: transform 0.3s, opacity 0.3s; }
.banner-enter-from, .banner-leave-to { transform: translateY(-100%); opacity: 0; }
</style>
