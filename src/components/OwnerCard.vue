<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onMounted } from 'vue'
import InmovillaState from './InmovillaState.vue'
import { ownerName } from '../models/owner'
import { whatsappLink } from '../models/client'
import { useOwnersStore } from '../stores/owners'
import { useAuthStore } from '../stores/auth'
const { t } = useI18n()

/** Owner section for an Inmovilla listing (by cod_ofer). */
const props = defineProps({ codOfer: { type: [String, Number], required: true }, refCode: { type: String, default: '' } })
const store = useOwnersStore()
const auth = useAuthStore()
const owner = computed(() => store.forProperty(props.codOfer))
const loading = computed(() => Boolean(store.loadingFor[String(props.codOfer)]))
const otherProperties = computed(() => (owner.value?.properties || []).filter((p) => String(p.codOfer) !== String(props.codOfer)))

onMounted(() => store.loadForProperty(props.codOfer))
</script>

<template>
  <article class="block owner">
    <div class="head">
      <h2>{{ t('owner.title') }}</h2>
      <RouterLink v-if="owner && auth.canWrite" :to="{ name: 'owner-edit', params: { id: owner.id } }" class="btn btn-ghost small">{{ t('common.edit') }}</RouterLink>
      <RouterLink v-else-if="!owner && auth.canWrite" :to="{ name: 'owner-new', query: { codOfer, ref: refCode } }" class="btn small">{{ t('common.add') }}</RouterLink>
    </div>
    <div v-if="loading && !owner" class="spinner small-spinner"></div>
    <p v-else-if="!owner" class="muted">{{ t('owner.none') }}</p>
    <template v-else>
      <p class="name">{{ ownerName(owner) }} <InmovillaState :record="owner" :sent="Boolean(owner.remoteId)" :label="owner.remoteId ? `nº ${owner.remoteId}` : ''" compact /></p>
      <p v-if="owner.syncError" class="alert">{{ t('owner.rejected', { msg: owner.syncError }) }}</p>
      <div class="actions">
        <a v-if="owner.mobile || owner.phone" class="btn btn-ghost small" :href="`tel:${owner.mobile || owner.phone}`">📞 {{ t('common.call') }}</a>
        <a v-if="whatsappLink(owner.mobile)" class="btn btn-ghost small" :href="whatsappLink(owner.mobile)" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a v-if="owner.email" class="btn btn-ghost small" :href="`mailto:${owner.email}`">✉️ {{ t('common.email') }}</a>
      </div>
      <dl class="rows">
        <template v-if="owner.mobile"><dt>{{ t('owner.mobile') }}</dt><dd>{{ owner.mobile }}</dd></template>
        <template v-if="owner.phone"><dt>{{ t('owner.phone') }}</dt><dd>{{ owner.phone }}</dd></template>
        <template v-if="owner.email"><dt>{{ t('owner.email') }}</dt><dd>{{ owner.email }}</dd></template>
        <template v-if="owner.nif"><dt>{{ t('owner.nif') }}</dt><dd>{{ owner.nif }}</dd></template>
        <template v-if="owner.notes"><dt>{{ t('owner.notes') }}</dt><dd class="notes">{{ owner.notes }}</dd></template>
      </dl>
      <p v-if="otherProperties.length" class="others muted">
        {{ t('owner.also') }}
        <RouterLink v-for="p in otherProperties" :key="p.codOfer" :to="{ name: 'property', params: { codOfer: p.codOfer } }" class="chip">{{ p.ref || p.codOfer }}<span v-if="!p.available"> · {{ t('owner.unavailable') }}</span></RouterLink>
      </p>
    </template>
  </article>
</template>

<style scoped>
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.25rem; margin-bottom: 1rem; }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.head h2 { margin: 0; font-size: 1.05rem; }
.small { padding: 0.4rem 0.8rem; font-size: 0.9rem; }
.small-spinner { margin: 0.5rem auto; width: 22px; height: 22px; }
.name { font-weight: 700; font-size: 1.05rem; margin: 0 0 0.5rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.6rem; }
.rows { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; margin: 0; font-size: 0.95rem; }
.rows dt { color: var(--muted); }
.rows dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.notes { white-space: pre-line; font-weight: 400; }
.others { font-size: 0.85rem; margin: 0.6rem 0 0; display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.chip { background: var(--surface-2); color: var(--brand-dark); border-radius: 999px; padding: 0.15rem 0.6rem; font-weight: 600; }
</style>
