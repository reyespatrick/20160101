<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { usePropertiesStore } from '../stores/properties'

const auth = useAuthStore()
const properties = usePropertiesStore()
const router = useRouter()

function logout() {
  auth.logout()
  properties.reset()
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
</style>
