<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref, watch } from 'vue'
import ClientCard from '../components/ClientCard.vue'
import { useClientsStore } from '../stores/clients'
import { useAuthStore } from '../stores/auth'
const { t } = useI18n()

const store = useClientsStore()
const auth = useAuthStore()
const searchInput = ref(null)
/** The empty screen carries its own call to action; a second one in the bar is noise. */
const emptyCta = computed(() => !store.loading && !store.active.length && !store.query)

onMounted(async () => {
  await store.ensureLoaded()
  store.sync()
})

// A phone number or an email can also be looked up in Inmovilla (its only search keys)
let timer
watch(
  () => store.query,
  (q) => {
    clearTimeout(timer)
    if (store.canSearchRemote && q.trim() !== store.remoteResultsFor) timer = setTimeout(() => store.searchRemote(q), 600)
  },
)

function syncLabel() {
  if (store.syncing) return t('common.syncing')
  if (store.rateLimitedUntil > Date.now()) return t('common.rateLimited')
  if (store.pendingCount) return t('common.pending', store.pendingCount)
  return t('common.allInInmovilla')
}
</script>

<template>
  <section class="container clients">
    <div class="toolbar">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" /></svg>
        <input ref="searchInput" v-model="store.query" type="search" :placeholder="t('clients.searchPh')" :aria-label="t('common.search')" autocomplete="off" />
        <button v-if="store.query" type="button" class="clear" :aria-label="t('common.close')" @click="store.query = ''; searchInput.focus()">×</button>
      </div>
      <RouterLink v-if="auth.canDraft && !emptyCta" :to="{ name: 'client-new' }" class="btn new-btn">+ {{ t('common.new') }}</RouterLink>
    </div>

    <p class="sync muted">
      <span class="sync-dot" :class="{ pending: store.pendingCount, busy: store.syncing || store.searching }"></span>
      <template v-if="store.searching">{{ t('clients.searchingRemote') }}</template>
      <template v-else>{{ syncLabel() }}</template>
      <button v-if="!store.syncing && store.pendingCount && store.rateLimitedUntil < Date.now()" type="button" class="link" @click="store.sync()">{{ t('common.sendNow') }}</button>
    </p>
    <p v-if="store.needsLogin" class="alert">{{ t('common.keysRejected') }}</p>
    <p v-else-if="store.syncError" class="alert">{{ store.syncError }}</p>

    <div v-if="store.loading" class="spinner"></div>

    <div v-else-if="!store.active.length && !store.query" class="empty">
      <div class="empty-icon">👤</div>
      <h2>{{ t('clients.empty') }}</h2>
      <p class="muted">{{ t('clients.emptyBody') }}</p>
      <RouterLink v-if="auth.canDraft" :to="{ name: 'client-new' }" class="btn">{{ t('clients.addClient') }}</RouterLink>
    </div>

    <div v-else-if="!store.filtered.length" class="empty">
      <h2>{{ t('common.noResults') }}</h2>
      <p v-if="store.canSearchRemote" class="muted">
        <template v-if="store.searching">{{ t('clients.searchingRemote') }}</template>
        <template v-else-if="store.remoteResultsFor === store.query.trim()">{{ t('clients.noRemote') }}</template>
        <template v-else><button type="button" class="link" @click="store.searchRemote()">{{ t('clients.searchRemote') }}</button></template>
      </p>
      <p v-else class="muted">{{ t('clients.nameOnlyLocal') }}</p>
      <RouterLink v-if="auth.canDraft" :to="{ name: 'client-new', query: { q: store.query } }" class="btn btn-ghost">{{ t('clients.create', { q: store.query }) }}</RouterLink>
    </div>

    <div v-else class="list">
      <p class="count muted">
        {{ t('clients.count', { n: store.filtered.length, total: store.active.length }) }}
        <template v-if="store.canSearchRemote && store.remoteResultsFor !== store.query.trim()">
          · <button type="button" class="link" @click="store.searchRemote()">{{ t('clients.alsoRemote') }}</button>
        </template>
      </p>
      <ClientCard v-for="c in store.filtered" :key="c.id" :client="c" />
    </div>

    <RouterLink v-if="auth.canDraft && !emptyCta" :to="{ name: 'client-new' }" class="fab" :aria-label="t('clients.new')">+</RouterLink>
  </section>
</template>

<style scoped>
.clients { padding-bottom: 5.5rem; }
.toolbar { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.75rem; }
.search-wrap { position: relative; flex: 1; }
.search-wrap svg { position: absolute; left: 0.8rem; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: var(--muted); }
.search-wrap input { width: 100%; border: 1px solid var(--border); border-radius: 12px; padding: 0.85rem 2.4rem 0.85rem 2.6rem; background: var(--surface); font-size: 1rem; }
.search-wrap input:focus { outline: 2px solid var(--brand); border-color: transparent; }
.clear { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); border: 0; background: var(--border); border-radius: 50%; width: 26px; height: 26px; line-height: 1; font-size: 1.1rem; }
.new-btn { white-space: nowrap; }
.sync { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 0.75rem; }
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.sync-dot.pending { background: var(--accent); }
.sync-dot.busy { background: var(--brand); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; text-decoration: underline; font-size: inherit; }
.count { margin: 0 0 0.25rem; font-size: 0.85rem; }
.list { display: flex; flex-direction: column; gap: 0.6rem; }
.empty { text-align: center; padding: 3rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.empty h2 { margin: 0; }
.empty p { margin: 0 0 0.75rem; }
.empty-icon { font-size: 3rem; }
.fab { position: fixed; right: 1.25rem; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); width: 58px; height: 58px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 2rem; line-height: 1; display: grid; place-items: center; box-shadow: 0 6px 18px rgba(243, 146, 0, 0.45); }
@media (min-width: 720px) { .fab { display: none; } }
@media (max-width: 719px) { .new-btn { display: none; } }
</style>
