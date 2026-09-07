<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { usePropertiesStore } from '../stores/properties'
import { useClientsStore } from '../stores/clients'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { useEnumsStore } from '../stores/enums'
import { useFollowUpsStore } from '../stores/followUps'
import { useOwnersStore } from '../stores/owners'

const auth = useAuthStore()
const properties = usePropertiesStore()
const clients = useClientsStore()
const localProperties = useLocalPropertiesStore()
const followUps = useFollowUpsStore()
const owners = useOwnersStore()
const router = useRouter()
const confirming = ref(false)
const pending = computed(() => clients.pendingCount + localProperties.pendingCount + followUps.pendingCount + owners.pendingCount)

async function logout() {
  if (pending.value && !confirming.value) {
    // Try to flush first; if changes are still pending, ask before leaving them behind.
    await Promise.all([clients.sync(), localProperties.sync(), followUps.sync({ pull: false }), owners.sync()])
    if (pending.value) {
      confirming.value = true
      return
    }
  }
  confirming.value = false
  auth.logout()
  properties.reset()
  clients.reset()
  localProperties.reset()
  followUps.reset()
  owners.reset()
  useEnumsStore().reset()
  router.replace({ name: 'login' })
}
</script>

<template>
  <header class="header">
    <RouterLink to="/" class="brand">
      <img src="/icons/favicon-64.png" alt="" width="32" height="32" />
      <span>ALMA</span>
    </RouterLink>
    <div class="right">
      <span class="agency muted">Agencia {{ auth.numagencia }}</span>
      <button class="btn btn-ghost small" type="button" @click="logout">Salir</button>
    </div>
  </header>
  <div v-if="confirming" class="confirm-bar" role="alertdialog">
    <span>Hay {{ pending }} cambios sin sincronizar. Se conservan en este dispositivo, pero no estarán en otros hasta que vuelvas a entrar.</span>
    <button class="btn small" type="button" @click="logout">Salir igualmente</button>
    <button class="btn btn-ghost small" type="button" @click="confirming = false">Cancelar</button>
  </div>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  padding-top: calc(0.6rem + env(safe-area-inset-top));
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 800; color: var(--brand); letter-spacing: 0.05em; }
.right { display: flex; align-items: center; gap: 0.75rem; }
.agency { font-size: 0.85rem; }
.small { padding: 0.4rem 0.8rem; }
@media (max-width: 420px) { .agency { display: none; } }
.confirm-bar {
  display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
  background: #fdefd9; color: #7a4a00; padding: 0.6rem 1rem; font-size: 0.85rem;
  border-bottom: 1px solid #f5d8a8;
}
.confirm-bar span { flex: 1 1 240px; }
</style>
