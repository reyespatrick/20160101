<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FilterBar from '../components/FilterBar.vue'
import LocalPropertyCard from '../components/LocalPropertyCard.vue'
import PropertyCard from '../components/PropertyCard.vue'
import { LISTING_STATUSES } from '../models/property'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { usePropertiesStore } from '../stores/properties'

const store = usePropertiesStore()
const local = useLocalPropertiesStore()
const route = useRoute()
const router = useRouter()
const sentinel = ref(null)
let observer

const source = computed(() => (route.query.source === 'mine' ? 'mine' : 'inmovilla'))
function setSource(value) {
  router.replace({ name: 'properties', query: value === 'mine' ? { source: 'mine' } : {} })
}

onMounted(async () => {
  await local.ensureLoaded()
  local.sync()
  if (!store.items.length) store.load()
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) store.loadMore()
    },
    { rootMargin: '400px' },
  )
})

// The sentinel is re-created whenever the list re-renders (loading toggles),
// so follow the current element instead of observing once on mount.
watch(sentinel, (el, prev) => {
  if (prev) observer?.unobserve(prev)
  if (el) observer?.observe(el)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="container properties">
    <div class="source-bar">
      <div class="segments" role="tablist" aria-label="Origen">
        <button type="button" role="tab" :aria-selected="source === 'inmovilla'" :class="{ active: source === 'inmovilla' }" @click="setSource('inmovilla')">Inmovilla</button>
        <button type="button" role="tab" :aria-selected="source === 'mine'" :class="{ active: source === 'mine' }" @click="setSource('mine')">
          Mis propiedades <span v-if="local.active.length" class="pill">{{ local.active.length }}</span>
        </button>
      </div>
      <RouterLink :to="{ name: 'local-property-new' }" class="btn new-btn">+ Nueva propiedad</RouterLink>
    </div>

    <template v-if="source === 'mine'">
      <div class="local-tools">
        <input v-model="local.query" type="search" placeholder="Buscar por referencia, ciudad, título…" aria-label="Buscar mis propiedades" />
        <select v-model="local.statusFilter" aria-label="Estado de la ficha">
          <option value="">Todos los estados</option>
          <option v-for="s in LISTING_STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
      <p class="sync muted">
        <span class="sync-dot" :class="{ pending: local.pendingCount, busy: local.syncing || local.uploading }"></span>
        <template v-if="local.syncing || local.uploading">Sincronizando{{ local.uploading ? ' fotos' : '' }}…</template>
        <template v-else-if="local.pendingCount">{{ local.pendingCount }} cambio{{ local.pendingCount === 1 ? '' : 's' }} pendiente{{ local.pendingCount === 1 ? '' : 's' }} <button type="button" class="link" @click="local.sync()">Sincronizar ahora</button></template>
        <template v-else-if="local.lastSyncAt">Todo en Inmovilla</template>
        <template v-else>Guardado en este dispositivo</template>
      </p>
      <p v-if="local.needsLogin" class="alert">Inmovilla rechazó la clave de la API REST. Tus propiedades están guardadas en este dispositivo; vuelve a iniciar sesión con una clave válida para enviarlas.</p>
      <p v-else-if="local.syncError" class="alert">{{ local.syncError }}</p>

      <div v-if="local.loading" class="spinner"></div>
      <div v-else-if="!local.active.length" class="empty">
        <div class="empty-icon">🏠</div>
        <h2>Aún no has dado de alta propiedades</h2>
        <p class="muted">Crea una ficha con fotos desde el móvil, incluso sin conexión.</p>
        <RouterLink :to="{ name: 'local-property-new' }" class="btn">Nueva propiedad</RouterLink>
      </div>
      <div v-else-if="!local.filtered.length" class="empty">
        <h2>Sin resultados</h2>
        <p class="muted">Ninguna propiedad coincide con el filtro.</p>
      </div>
      <div v-else class="grid">
        <LocalPropertyCard v-for="p in local.filtered" :key="p.id" :property="p" />
      </div>
      <RouterLink :to="{ name: 'local-property-new' }" class="fab" aria-label="Nueva propiedad">+</RouterLink>
    </template>

    <template v-else>
    <FilterBar :filters="store.filters" :types="store.types" @update="store.setFilters" />

    <p v-if="store.fromCache" class="alert alert-info">Sin conexión con Inmovilla. Mostrando el último listado guardado.</p>
    <p v-else-if="store.error" class="alert" role="alert">{{ store.error }}</p>

    <div v-if="store.loading" class="spinner" aria-label="Cargando"></div>

    <template v-else>
      <p class="count muted">
        <template v-if="store.total">{{ store.total.toLocaleString('es-ES') }} propiedades</template>
        <template v-else>No hay propiedades que coincidan</template>
      </p>
      <div class="grid">
        <PropertyCard v-for="p in store.items" :key="p.cod_ofer" :property="p" />
      </div>
      <div ref="sentinel" class="sentinel">
        <div v-if="store.loadingMore" class="spinner"></div>
        <button v-else-if="store.hasMore && !store.fromCache" class="btn btn-ghost" type="button" @click="store.loadMore()">Cargar más</button>
      </div>
    </template>
    </template>
  </section>
</template>

<style scoped>
.properties { padding-bottom: 5.5rem; }
.source-bar { display: flex; gap: 0.6rem; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; }
.segments { display: inline-flex; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 3px; }
.segments button { border: 0; background: transparent; border-radius: 8px; padding: 0.5rem 0.9rem; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; gap: 0.4rem; }
.segments button.active { background: var(--brand); color: #fff; }
.pill { background: rgba(255,255,255,0.25); border-radius: 999px; padding: 0 0.45rem; font-size: 0.75rem; }
.segments button:not(.active) .pill { background: var(--border); color: var(--text); }
.new-btn { white-space: nowrap; }
.local-tools { display: grid; grid-template-columns: 1fr; gap: 0.6rem; margin-bottom: 0.5rem; }
@media (min-width: 720px) { .local-tools { grid-template-columns: 2fr 1fr; } }
.local-tools input, .local-tools select { width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; background: var(--surface); font-size: 1rem; }
.sync { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 0.75rem; }
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: #2e7d32; }
.sync-dot.pending { background: var(--accent); }
.sync-dot.busy { background: var(--brand); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; text-decoration: underline; }
.empty { text-align: center; padding: 3rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.empty h2 { margin: 0; }
.empty p { margin: 0 0 0.75rem; }
.empty-icon { font-size: 3rem; }
.fab { position: fixed; right: 1.25rem; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); width: 58px; height: 58px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 2rem; line-height: 1; display: grid; place-items: center; box-shadow: 0 6px 18px rgba(243, 146, 0, 0.45); }
@media (min-width: 720px) { .fab { display: none; } }
@media (max-width: 719px) { .new-btn { display: none; } }
.count { margin: 0 0 0.75rem; font-size: 0.9rem; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.sentinel { display: flex; justify-content: center; padding: 1.5rem 0 2rem; min-height: 60px; }
</style>
