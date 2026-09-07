<script setup>
import { onMounted, ref } from 'vue'
import ClientCard from '../components/ClientCard.vue'
import { CLIENT_STATUSES } from '../models/client'
import { useClientsStore } from '../stores/clients'

const store = useClientsStore()
const searchInput = ref(null)

onMounted(async () => {
  await store.ensureLoaded()
  store.sync()
})

function syncLabel() {
  if (store.syncing) return 'Sincronizando…'
  if (store.pendingCount) return `${store.pendingCount} cambio${store.pendingCount === 1 ? '' : 's'} pendiente${store.pendingCount === 1 ? '' : 's'}`
  if (store.lastSyncAt) return 'Todo sincronizado'
  return 'Guardado en este dispositivo'
}
</script>

<template>
  <section class="container clients">
    <div class="toolbar">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" /></svg>
        <input
          ref="searchInput"
          v-model="store.query"
          type="search"
          placeholder="Buscar por nombre, teléfono o email"
          aria-label="Buscar clientes"
          autocomplete="off"
        />
        <button v-if="store.query" type="button" class="clear" aria-label="Limpiar búsqueda" @click="store.query = ''; searchInput.focus()">×</button>
      </div>
      <RouterLink :to="{ name: 'client-new' }" class="btn new-btn">+ Nuevo</RouterLink>
    </div>

    <div class="status-filters" role="tablist" aria-label="Filtrar por estado">
      <button type="button" role="tab" :class="{ active: !store.statusFilter }" :aria-selected="!store.statusFilter" @click="store.statusFilter = ''">Todos</button>
      <button
        v-for="s in CLIENT_STATUSES"
        :key="s.value"
        type="button"
        role="tab"
        :class="{ active: store.statusFilter === s.value }"
        :aria-selected="store.statusFilter === s.value"
        @click="store.statusFilter = store.statusFilter === s.value ? '' : s.value"
      >
        {{ s.label }}
      </button>
    </div>

    <p class="sync muted">
      <span class="sync-dot" :class="{ pending: store.pendingCount, busy: store.syncing }"></span>
      {{ syncLabel() }}
      <button v-if="!store.syncing && store.pendingCount" type="button" class="link" @click="store.sync()">Sincronizar ahora</button>
    </p>
    <p v-if="store.needsLogin" class="alert">La sesión ha caducado. Tus cambios están guardados en este dispositivo; vuelve a iniciar sesión para sincronizarlos.</p>
    <p v-else-if="store.syncError" class="alert">{{ store.syncError }}</p>

    <div v-if="store.loading" class="spinner"></div>

    <div v-else-if="!store.active.length" class="empty">
      <div class="empty-icon">👤</div>
      <h2>Aún no hay clientes</h2>
      <p class="muted">Añade tu primer cliente. Funciona también sin conexión.</p>
      <RouterLink :to="{ name: 'client-new' }" class="btn">Añadir cliente</RouterLink>
    </div>

    <div v-else-if="!store.filtered.length" class="empty">
      <h2>Sin resultados</h2>
      <p class="muted">Ningún cliente coincide con “{{ store.query }}”.</p>
      <RouterLink :to="{ name: 'client-new', query: { name: store.query } }" class="btn btn-ghost">Crear “{{ store.query }}”</RouterLink>
    </div>

    <div v-else class="list">
      <p class="count muted">{{ store.filtered.length }} de {{ store.active.length }} clientes</p>
      <ClientCard v-for="c in store.filtered" :key="c.id" :client="c" />
    </div>

    <RouterLink :to="{ name: 'client-new' }" class="fab" aria-label="Nuevo cliente">+</RouterLink>
  </section>
</template>

<style scoped>
.clients { padding-bottom: 5.5rem; }
.toolbar { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.75rem; }
.search-wrap { position: relative; flex: 1; }
.search-wrap svg { position: absolute; left: 0.8rem; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: var(--muted); }
.search-wrap input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.85rem 2.4rem 0.85rem 2.6rem;
  background: var(--surface);
  font-size: 1rem;
}
.search-wrap input:focus { outline: 2px solid var(--brand); border-color: transparent; }
.clear { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); border: 0; background: var(--border); border-radius: 50%; width: 26px; height: 26px; line-height: 1; font-size: 1.1rem; }
.new-btn { white-space: nowrap; }
.status-filters { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.4rem; scrollbar-width: none; }
.status-filters::-webkit-scrollbar { display: none; }
.status-filters button {
  flex: 0 0 auto;
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-weight: 600;
}
.status-filters button.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.sync { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 0.75rem; }
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: #2e7d32; }
.sync-dot.pending { background: var(--accent); }
.sync-dot.busy { background: var(--brand); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; text-decoration: underline; }
.count { margin: 0 0 0.25rem; font-size: 0.85rem; }
.list { display: flex; flex-direction: column; gap: 0.6rem; }
.empty { text-align: center; padding: 3rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.empty h2 { margin: 0; }
.empty p { margin: 0 0 0.75rem; }
.empty-icon { font-size: 3rem; }
.fab {
  position: fixed;
  right: 1.25rem;
  bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom));
  width: 58px; height: 58px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 2rem;
  line-height: 1;
  display: grid;
  place-items: center;
  box-shadow: 0 6px 18px rgba(243, 146, 0, 0.45);
}
@media (min-width: 720px) { .fab { display: none; } }
@media (max-width: 719px) { .new-btn { display: none; } }
</style>
