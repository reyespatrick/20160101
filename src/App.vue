<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import BottomNav from './components/BottomNav.vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import Toasts from './components/Toasts.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import { useAuthStore } from './stores/auth'
import { useClientsStore } from './stores/clients'
import { useEnumsStore } from './stores/enums'
import { useFollowUpsStore } from './stores/followUps'
import { useLocalPropertiesStore } from './stores/localProperties'
import { useOwnersStore } from './stores/owners'

const auth = useAuthStore()
const clients = useClientsStore()
const localProperties = useLocalPropertiesStore()
const followUps = useFollowUpsStore()
const owners = useOwnersStore()
const enums = useEnumsStore()
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const online = ref(navigator.onLine)

// When the server rejects the session (expired, deactivated), go back to the login screen
watch(
  () => auth.isAuthenticated,
  (ok) => {
    if (!ok && !route.meta.public) router.replace({ name: 'login' })
  },
)

const syncing = computed(() => clients.syncing || localProperties.syncing || localProperties.uploading > 0 || followUps.syncing || followUps.pulling || owners.syncing)

function syncAll() {
  if (!auth.isAuthenticated) return
  clients.sync().catch(() => {})
  localProperties.sync().catch(() => {})
  followUps.sync().catch(() => {})
  owners.sync().catch(() => {})
}

onMounted(async () => {
  await auth.restore()
  window.addEventListener('online', () => {
    online.value = true
    syncAll()
  })
  window.addEventListener('offline', () => (online.value = false))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncAll())
  if (auth.isAuthenticated) {
    enums.restore()
    Promise.all([clients.load(), localProperties.load(), followUps.load()]).then(syncAll).catch(() => {})
  }
})
</script>

<template>
  <div class="app">
    <UpdateBanner />
    <AppHeader v-if="auth.isAuthenticated" />
    <div v-if="!online" class="offline-bar">{{ t('common.offlineBar') }}</div>
    <div v-if="auth.isAuthenticated && !auth.hasRest && $route.name !== 'agency-keys'" class="keys-bar">
      <span>{{ auth.isAdmin ? t('auth.noKeysAdmin') : t('auth.noKeysAgent') }}</span>
      <RouterLink v-if="auth.isAdmin" :to="{ name: 'agency-keys' }" class="btn small">{{ t('auth.goKeys') }}</RouterLink>
    </div>
    <div v-if="auth.isAuthenticated && auth.writesLocked && auth.hasKeys && $route.name !== 'agency-keys'" class="lock-bar">
      <span>🔒 {{ t('lock.bar') }}</span>
      <RouterLink v-if="auth.isAdmin" :to="{ name: 'agency-keys' }" class="btn small">{{ t('lock.manage') }}</RouterLink>
    </div>
    <div class="sync-bar" :class="{ on: syncing }" aria-hidden="true"></div>
    <main>
      <ErrorBoundary>
        <RouterView v-slot="{ Component, route }">
          <Transition name="screen" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </ErrorBoundary>
    </main>
    <BottomNav v-if="auth.isAuthenticated" />
    <Toasts />
  </div>
</template>

<style scoped>
.app { min-height: 100dvh; display: flex; flex-direction: column; }
main { flex: 1; }
.keys-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: center; background: var(--surface-2); color: var(--brand-dark); font-size: 0.85rem; padding: 0.5rem 1rem; text-align: center; }
.keys-bar .small { padding: 0.35rem 0.7rem; font-size: 0.85rem; }
.lock-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: center; background: var(--accent); color: #fff; font-size: 0.85rem; font-weight: 600; padding: 0.4rem 1rem; text-align: center; }
.lock-bar .btn { background: rgba(255, 255, 255, 0.22); color: #fff; padding: 0.25rem 0.6rem; font-size: 0.8rem; }
.offline-bar { background: var(--accent); color: #fff; text-align: center; font-size: 0.85rem; padding: 0.35rem; font-weight: 600; }
.sync-bar { height: 3px; background: transparent; position: sticky; top: 0; z-index: 11; }
.sync-bar.on { background: linear-gradient(90deg, transparent, var(--brand), transparent); background-size: 40% 100%; animation: slide 1.1s linear infinite; }
@keyframes slide { from { background-position: -40% 0; } to { background-position: 140% 0; } }
.screen-enter-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.screen-leave-active { transition: opacity 0.12s ease; }
.screen-enter-from { opacity: 0; transform: translateY(8px); }
.screen-leave-to { opacity: 0; }
</style>
