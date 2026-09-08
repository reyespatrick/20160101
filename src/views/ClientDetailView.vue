<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InmovillaState from '../components/InmovillaState.vue'
import { fullName, initials, primaryPhone, whatsappLink } from '../models/client'
import { useClientsStore } from '../stores/clients'
import { useAuthStore } from '../stores/auth'
import { useFollowUpsStore } from '../stores/followUps'
import FollowUpCard from '../components/FollowUpCard.vue'
import { formatDate } from '../utils/format'
const { t } = useI18n()

const props = defineProps({ id: { type: String, required: true } })
const store = useClientsStore()
const followUps = useFollowUpsStore()
const auth = useAuthStore()
const router = useRouter()
const clientFollowUps = computed(() => (client.value?.remoteId ? followUps.forClient(client.value.remoteId) : []))
const route = useRoute()

const loading = ref(true)
const confirmDelete = ref(false)
const toast = ref(route.query.saved ? t('clients.detail.saved') : '')
const client = computed(() => store.byId(props.id))
const address = computed(() => {
  const c = client.value
  if (!c) return ''
  return [[c.street, c.number].filter(Boolean).join(' '), [c.postalCode, c.city].filter(Boolean).join(' '), c.province].filter(Boolean).join(', ')
})

onMounted(async () => {
  await store.ensureLoaded()
  followUps.ensureLoaded()
  loading.value = false
  store.refresh(props.id)
  if (toast.value) setTimeout(() => (toast.value = ''), 2500)
})

async function remove() {
  await store.remove(props.id)
  router.replace({ name: 'clients' })
}
</script>

<template>
  <section class="container client-detail">
    <div class="top">
      <RouterLink :to="{ name: 'clients' }" class="btn btn-ghost">← {{ t('clients.detail.back') }}</RouterLink>
      <RouterLink v-if="client && auth.canWrite" :to="{ name: 'client-edit', params: { id } }" class="btn">{{ t('common.edit') }}</RouterLink>
    </div>

    <div v-if="loading" class="spinner"></div>
    <p v-else-if="!client" class="alert">{{ t('clients.detail.gone') }}</p>

    <template v-else>
      <header class="hero">
        <div class="avatar" :style="{ background: client.remoteId ? '#2e3192' : '#f39200' }">{{ initials(client) }}</div>
        <div>
          <h1>{{ fullName(client) }}</h1>
          <p class="muted"><InmovillaState :record="client" :sent="Boolean(client.remoteId)" :label="client.remoteId ? t('clients.num', { id: client.remoteId }) : ''" /></p>
          <p v-if="client.syncError" class="alert">{{ t('clients.detail.rejected', { msg: client.syncError }) }}</p>
        </div>
      </header>

      <div class="actions">
        <a v-if="primaryPhone(client)" class="action" :href="`tel:${primaryPhone(client)}`"><span class="icon">📞</span>{{ t('common.call') }}</a>
        <a v-if="whatsappLink(client.mobile)" class="action" :href="whatsappLink(client.mobile)" target="_blank" rel="noopener"><span class="icon">💬</span>WhatsApp</a>
        <a v-if="client.email" class="action" :href="`mailto:${client.email}`"><span class="icon">✉️</span>{{ t('common.email') }}</a>
      </div>

      <article class="block">
        <h2>{{ t('clients.detail.contact') }}</h2>
        <dl class="rows">
          <dt>{{ t('clients.detail.mobile') }}</dt><dd>{{ client.mobile || '—' }}</dd>
          <dt>{{ t('clients.detail.phone') }}</dt><dd>{{ client.phone || '—' }}</dd>
          <dt>{{ t('clients.detail.email') }}</dt><dd>{{ client.email || '—' }}</dd>
          <dt>{{ t('clients.detail.nif') }}</dt><dd>{{ client.nif || '—' }}</dd>
          <dt>{{ t('clients.detail.address') }}</dt><dd>{{ address || '—' }}</dd>
          <template v-if="client.agentName"><dt>{{ t('clients.detail.agent') }}</dt><dd>{{ client.agentName }}</dd></template>
        </dl>
      </article>

      <article class="block">
        <div class="block-head">
          <h2>{{ t('clients.detail.followUps') }}</h2>
          <RouterLink v-if="client.remoteId && auth.canWrite" :to="{ name: 'followup-new', query: { clientId: client.remoteId, clientLabel: fullName(client) } }" class="btn small">+ {{ t('common.new') }}</RouterLink>
        </div>
        <p v-if="!client.remoteId" class="muted">{{ t('clients.detail.notInInmovilla') }}</p>
        <p v-else-if="!clientFollowUps.length" class="muted">{{ t('clients.detail.noFollowUps') }}</p>
        <div v-else class="fu-list"><FollowUpCard v-for="f in clientFollowUps.slice(0, 5)" :key="f.id" :follow-up="f" compact /></div>
      </article>

      <article v-if="client.notes" class="block">
        <h2>{{ t('clients.detail.notes') }}</h2>
        <p class="notes">{{ client.notes }}</p>
      </article>

      <p class="dates muted">{{ t('clients.detail.created') }} {{ formatDate(new Date(client.createdAt).toISOString()) }} · {{ t('clients.detail.updated') }} {{ formatDate(new Date(client.updatedAt).toISOString()) }}</p>

      <div v-if="auth.canDelete || (!client.remoteId && auth.canWrite)" class="danger-zone">
        <button v-if="!confirmDelete" type="button" class="btn btn-ghost danger" @click="confirmDelete = true">{{ t('clients.detail.delete') }}</button>
        <div v-else class="confirm">
          <span>{{ t('clients.detail.confirm', { name: fullName(client), also: client.remoteId ? t('clients.detail.alsoInmovilla') : '' }) }}</span>
          <button type="button" class="btn danger-fill" @click="remove">{{ t('common.yes') }}</button>
          <button type="button" class="btn btn-ghost" @click="confirmDelete = false">{{ t('common.no') }}</button>
        </div>
      </div>
    </template>

    <Transition name="toast"><div v-if="toast" class="toast" role="status">{{ toast }}</div></Transition>
  </section>
</template>

<style scoped>
.client-detail { padding-bottom: 5rem; }
.top { display: flex; justify-content: space-between; margin-bottom: 1rem; }
.hero { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.hero h1 { margin: 0; font-size: 1.4rem; }
.hero p { margin: 0.15rem 0 0; }
.avatar { flex: 0 0 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 1.4rem; }
.actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.6rem; margin-bottom: 1rem; }
.action { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 0.85rem 0.5rem; font-weight: 700; color: var(--brand); }
.action .icon { font-size: 1.4rem; }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; margin-bottom: 0.85rem; }
.block h2 { margin: 0 0 0.7rem; font-size: 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
.block-head h2 { margin: 0; }
.small { padding: 0.4rem 0.8rem; font-size: 0.9rem; }
.fu-list { display: flex; flex-direction: column; gap: 0.5rem; }
.rows { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1.25rem; margin: 0; }
.rows dt { color: var(--muted); }
.rows dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.notes { margin: 0; white-space: pre-line; line-height: 1.55; }
.dates { font-size: 0.8rem; text-align: center; }
.danger-zone { margin-top: 1.5rem; display: flex; justify-content: center; }
.danger { color: var(--danger); }
.danger-fill { background: var(--danger); }
.confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; justify-content: center; }
.toast { position: fixed; left: 50%; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); transform: translateX(-50%); background: var(--text); color: #fff; padding: 0.6rem 1.1rem; border-radius: 999px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }
</style>
