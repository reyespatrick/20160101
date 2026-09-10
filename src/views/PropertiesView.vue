<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useOnlineRetry } from '../composables/useOnlineRetry'
import PickerField from '../components/PickerField.vue'
import FilterBar from '../components/FilterBar.vue'
import LocalPropertyCard from '../components/LocalPropertyCard.vue'
import PropertyCard from '../components/PropertyCard.vue'
import { LISTING_STATUSES } from '../models/property'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { usePropertiesStore } from '../stores/properties'
import { useAuthStore } from '../stores/auth'
const { t } = useI18n()

const store = usePropertiesStore()
const local = useLocalPropertiesStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const sentinel = ref(null)
let observer

/**
 * The agent's own listings are what opens: they are the ones being worked on, they are the only
 * ones that exist offline, and they are where the create button belongs. Inmovilla's catalogue is
 * the reference one steps over to, so it is the one that carries a query parameter.
 */
const source = computed(() => (route.query.source === 'inmovilla' ? 'inmovilla' : 'mine'))
/** The empty screen carries its own call to action; a second one in the bar is noise. */
const emptyCta = computed(() => source.value === 'mine' && !local.loading && !local.active.length)
function setSource(value) {
  router.replace({ name: 'properties', query: value === 'inmovilla' ? { source: 'inmovilla' } : {} })
}

// Back online while this screen is open: ask Inmovilla again, without the agent doing anything.
const { online } = useOnlineRetry(() => {
  if (source.value !== 'mine') store.load()
})

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
        <button type="button" role="tab" :aria-selected="source === 'mine'" :class="{ active: source === 'mine' }" @click="setSource('mine')">
          {{ t('props.mine') }} <span v-if="local.active.length" class="pill">{{ local.active.length }}</span>
        </button>
        <button type="button" role="tab" :aria-selected="source === 'inmovilla'" :class="{ active: source === 'inmovilla' }" @click="setSource('inmovilla')">{{ t('props.inmovilla') }}</button>
      </div>
      <RouterLink v-if="auth.canDraft && !emptyCta" :to="{ name: 'local-property-new' }" class="btn new-btn">+ {{ t('props.newProperty') }}</RouterLink>
    </div>

    <template v-if="source === 'mine'">
      <div class="local-tools">
        <input v-model="local.query" type="search" :placeholder="t('props.mineSearch')" :aria-label="t('props.mineSearch')" />
        <PickerField
          v-model="local.statusFilter"
          :options="LISTING_STATUSES.map((s) => ({ value: s.value, label: t(`props.statuses.${s.value}`) }))"
          :title="t('props.allStates')"
          :placeholder="t('props.allStates')"
          :empty-label="t('props.allStates')"
          empty-value=""
        />
      </div>
      <p class="sync muted">
        <span class="sync-dot" :class="{ pending: local.pendingCount, busy: local.syncing || local.uploading }"></span>
        <template v-if="local.syncing || local.uploading">{{ local.uploading ? t('props.syncingPhotos') : t('common.syncing') }}</template>
        <template v-else-if="local.pendingCount">{{ t('common.pending', local.pendingCount) }} <button type="button" class="link" @click="local.sync()">{{ t('common.sendNow') }}</button></template>
        <template v-else-if="local.lastSyncAt">{{ t('common.allInInmovilla') }}</template>
        <template v-else>{{ t('common.savedOnDevice') }}</template>
      </p>
      <p v-if="local.needsLogin" class="alert">{{ t('common.keysRejected') }}</p>
      <p v-else-if="local.syncError" class="alert">{{ local.syncError }}</p>

      <div v-if="local.loading" class="spinner"></div>
      <div v-else-if="!local.active.length" class="empty">
        <div class="empty-icon">🏠</div>
        <h2>{{ t('props.mineEmpty') }}</h2>
        <p class="muted">{{ t('props.mineEmptyBody') }}</p>
        <RouterLink v-if="auth.canDraft" :to="{ name: 'local-property-new' }" class="btn">{{ t('props.newProperty') }}</RouterLink>
      </div>
      <div v-else-if="!local.filtered.length" class="empty">
        <h2>{{ t('common.noResults') }}</h2>
        <p class="muted">{{ t('props.noMatchFilter') }}</p>
      </div>
      <div v-else class="grid">
        <LocalPropertyCard v-for="p in local.filtered" :key="p.id" :property="p" />
      </div>
      <RouterLink v-if="auth.canDraft && !emptyCta" :to="{ name: 'local-property-new' }" class="fab" :aria-label="t('props.newProperty')">+</RouterLink>
    </template>

    <template v-else>
    <FilterBar :filters="store.filters" :types="store.types" @update="store.setFilters" />

    <p v-if="store.offline" class="alert alert-info" role="status">
      {{ store.fromCache ? t('props.cached') : t('props.offlineList') }}
      <span class="muted">{{ t('props.offlineRetry') }}</span>
    </p>
    <p v-else-if="store.fromCache" class="alert alert-info">{{ t('props.cached') }}</p>
    <div v-else-if="store.needsApiweb" class="alert alert-info no-apiweb">
      <p>{{ t('props.needsApiweb') }}</p>
      <p class="muted">{{ t('props.needsApiwebBody') }}</p>
      <RouterLink v-if="auth.isAdmin" :to="{ name: 'agency-keys' }" class="btn btn-ghost small">{{ t('auth.goKeys') }}</RouterLink>
    </div>
    <p v-else-if="store.error" class="alert" role="alert">{{ store.error }}</p>

    <div v-if="store.loading" class="spinner" :aria-label="t('common.loading')"></div>

    <template v-else>
      <p class="count muted">
        <template v-if="store.total">{{ t('props.count', { n: store.total.toLocaleString() }) }}</template>
        <template v-else>{{ t('props.noMatch') }}</template>
      </p>
      <div class="grid">
        <PropertyCard v-for="p in store.items" :key="p.cod_ofer" :property="p" />
      </div>
      <div ref="sentinel" class="sentinel">
        <div v-if="store.loadingMore" class="spinner"></div>
        <button v-else-if="store.hasMore && !store.fromCache" class="btn btn-ghost" type="button" @click="store.loadMore()">{{ t('props.loadMore') }}</button>
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
.local-tools input { width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; background: var(--surface); font-size: 1rem; }
.sync { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 0.75rem; }
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.sync-dot.pending { background: var(--accent); }
.sync-dot.busy { background: var(--brand); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; text-decoration: underline; }
.empty { text-align: center; padding: 3rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.empty h2 { margin: 0; }
.empty p { margin: 0 0 0.75rem; }
.empty-icon { font-size: 3rem; }
.no-apiweb { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
.no-apiweb p { margin: 0; }
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
