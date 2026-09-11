<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InmovillaState from '../components/InmovillaState.vue'
import { LISTING_STATUSES, activeFeatures, completeness, locationOf, priceOf, titleOf } from '../models/property'
import { useAuthStore } from '../stores/auth'
import BusyDialog from '../components/BusyDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MergeDialog from '../components/MergeDialog.vue'
import { reverseGeocode } from '../api/geocode'
import { searchClients } from '../api/inmovillaRest'
import { findMunicipality } from '../data/andalucia'
import { useSettingsStore } from '../stores/settings'
import { applyChoice, differingFields } from '../utils/merge'
import { hasFastNetwork } from '../utils/network'
import { useOnlineRetry } from '../composables/useOnlineRetry'
import { useEnumsStore } from '../stores/enums'
import { useEstimatesStore } from '../stores/estimates'
import { ownerIsComplete, useLocalPropertiesStore } from '../stores/localProperties'
import { useFollowUpsStore } from '../stores/followUps'
import FollowUpCard from '../components/FollowUpCard.vue'
import { PLACEHOLDER, formatDate } from '../utils/format'
const { t } = useI18n()

const props = defineProps({ id: { type: String, required: true } })
const store = useLocalPropertiesStore()
const followUps = useFollowUpsStore()
const auth = useAuthStore()
const enums = useEnumsStore()
const estimates = useEstimatesStore()
const propertyFollowUps = computed(() => (p.value?.codOfer ? followUps.forProperty(p.value.codOfer) : []))
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const confirmRemove = ref(false)
const active = ref(0)
const toast = ref(route.query.saved ? t('props.detail.saved') : '')

const p = computed(() => store.byId(props.id))
const status = computed(() => LISTING_STATUSES.find((s) => s.value === p.value?.status) || LISTING_STATUSES[0])
const photos = computed(() => [...(p.value?.photos || [])].sort((a, b) => a.order - b.order))
const pendingPhotos = computed(() => store.pendingPhotosOf(p.value))
/**
 * A valuation already made is one tap away, and the button should say so: running one costs a
 * call to Claude and a trip through the comparables, so "Estimate the value" on a listing that
 * already has one invites people to spend that twice.
 */
const savedEstimate = computed(() => estimates.get(`local:${props.id}`))
const estimateLabel = computed(() => {
  const e = savedEstimate.value
  if (!e?.result) return t('estimate.button')
  const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  return t('estimate.saved', { value: money.format(e.result.estimatedValue) })
})

const rows = computed(() => {
  const d = p.value || {}
  return [
    [t('props.rows.ref'), d.ref],
    [t('props.rows.type'), d.typeName],
    [t('props.rows.bedrooms'), d.bedrooms],
    [t('props.rows.baths'), d.bathrooms],
    [t('props.rows.builtShort'), d.builtArea ? `${d.builtArea} m²` : ''],
    [t('props.rows.usable'), d.usableArea ? `${d.usableArea} m²` : ''],
    [t('props.rows.plot'), d.plotArea ? `${d.plotArea} m²` : ''],
    [t('props.rows.floor'), d.floor],
    [t('props.rows.year'), d.yearBuilt],
    [t('props.rows.condition'), enums.label('conservacion', d.conservation)],
    [t('props.rows.orientation'), enums.label('keyori', d.orientation)],
    [t('props.rows.energy'), d.energyRating],
    [t('props.rows.publish'), enums.label('eninternet', d.publish)],
    [t('props.rows.address'), [d.street, d.number].filter(Boolean).join(' ')],
    [t('props.rows.cp'), d.postalCode],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
})

/**
 * What could not be done in the field, done now.
 *
 * A listing written in front of a house with no data comes back with a position and a phone
 * number and little else. Opening it on a real connection is the moment to finish the job: read
 * the address the position points at, and ask Inmovilla whether that phone already belongs to
 * someone. Both are announced while they run — they take seconds against remote registers — and
 * both are cancellable.
 */
const busy = ref('') // '' | 'address' | 'owner'
const catchUpNote = ref('')
const merge = ref(null) // { title, intro, rows, apply }
let cancelled = false

const needsAddress = (d) => d && d.latitude != null && !d.cadastralRef && !d.street && !d.cityName
const needsOwner = (d) => d && d.ownerPhone && !d.ownerCheckedAt && !d.ownerRemoteId

async function catchUp() {
  const d = p.value
  // One question at a time: an unsettled conflict is the bigger one, and stacking a second
  // dialog on top of it is how people answer the wrong question.
  if (!d || d.conflict || busy.value || !hasFastNetwork()) return
  cancelled = false
  if (needsAddress(d)) await readAddress(d)
  if (!cancelled && needsOwner(p.value) && auth.hasRest) await findOwner(p.value)
}

async function readAddress(d) {
  busy.value = 'address'
  try {
    const { address, cadastre } = await reverseGeocode({ lat: d.latitude, lon: d.longitude, lang: useSettingsStore().locale })
    if (cancelled) return
    const hit = findMunicipality(address.city, address.province)
    await store.save({
      ...JSON.parse(JSON.stringify(p.value)),
      street: address.street || '',
      number: address.number || '',
      postalCode: address.postalCode || '',
      cityName: hit ? hit.municipality.l : address.city || '',
      cityCatastro: hit ? hit.municipality.c : '',
      province: hit ? hit.province : p.value.province,
      cadastralRef: cadastre?.reference || '',
      cadastralUrl: cadastre?.mapUrl || '',
    })
    catchUpNote.value = t('merge.addressDone')
  } catch {
    /* No address today: the position is still there, and the button on the form still works. */
  } finally {
    busy.value = ''
  }
}

/** Fields Inmovilla holds for an owner, in the order a person reads them. */
const OWNER_FIELDS = [
  { key: 'ownerName', labelKey: 'props.form.ownerName', read: (c) => c.name || c.nombre || '' },
  { key: 'ownerSurname', labelKey: 'props.form.ownerSurname', read: (c) => c.surname || c.apellidos || '' },
  { key: 'ownerEmail', labelKey: 'props.form.ownerEmail', read: (c) => c.email || '' },
]

async function findOwner(d) {
  busy.value = 'owner'
  try {
    const found = await searchClients({ telefono: d.ownerPhone })
    if (cancelled) return
    const first = Array.isArray(found) ? found[0] : found
    const base = { ...JSON.parse(JSON.stringify(p.value)), ownerCheckedAt: Date.now() }
    if (!first) {
      // Nothing to merge and nothing to send: only the note that the question has been asked.
      await store.note(d.id, { ownerCheckedAt: base.ownerCheckedAt })
      catchUpNote.value = t('merge.ownerNone')
      return
    }
    base.ownerRemoteId = first.remoteId || first.cod_cli || null
    const rows = differingFields(base, first, OWNER_FIELDS.map((f) => ({ ...f, label: t(f.labelKey) })))
    if (!rows.length) {
      await store.note(d.id, { ownerCheckedAt: base.ownerCheckedAt, ownerRemoteId: base.ownerRemoteId })
      catchUpNote.value = t('merge.ownerFound', { id: base.ownerRemoteId || '—' })
      return
    }
    merge.value = {
      title: t('merge.ownerTitle'),
      intro: t('merge.ownerIntro'),
      rows,
      apply: async (choice) => {
        const { next, taken } = applyChoice(base, rows, choice)
        // Taking nothing is a decision too, and it is not a change to send.
        if (!taken) await store.note(d.id, { ownerCheckedAt: next.ownerCheckedAt, ownerRemoteId: next.ownerRemoteId })
        // Every difference resolved in Inmovilla's favour: the owner now says what Inmovilla
        // says, so there is nothing to write back.
        else await store.save(next, { ownerIsRemote: taken === rows.length })
        catchUpNote.value = t('merge.ownerFound', { id: next.ownerRemoteId || '—' })
      },
    }
  } catch {
    /* Inmovilla is not answering: leave ownerCheckedAt null so the next opening tries again. */
  } finally {
    busy.value = ''
  }
}

function cancelCatchUp() {
  cancelled = true
  busy.value = ''
}

/**
 * The office changed the listing too. Nothing has been sent, and nothing will be until the agent
 * has seen both versions side by side and said what the listing should say.
 */
const conflictRows = computed(() =>
  (p.value?.conflict?.rows || []).map((row) => ({ key: row.key, label: t(row.labelKey), mine: row.mine, theirs: row.theirs, prefer: row.prefer })),
)

function openConflict() {
  merge.value = {
    title: t('merge.conflictTitle'),
    intro: p.value?.remoteChangedAt ? t('merge.conflictIntroDated', { when: p.value.remoteChangedAt }) : t('merge.conflictIntro'),
    rows: conflictRows.value,
    apply: async (choice) => {
      const taken = {}
      for (const row of conflictRows.value) if (choice[row.key] === 'theirs') taken[row.key] = row.theirs
      await store.resolveConflict(props.id, taken)
      catchUpNote.value = t('merge.conflictSettled')
    },
  }
}

async function applyMerge(choice) {
  const pending = merge.value
  merge.value = null
  await pending?.apply(choice)
}

useOnlineRetry(() => catchUp())

onMounted(async () => {
  await store.ensureLoaded()
  followUps.ensureLoaded()
  enums.restore()
  estimates.ensureLoaded()
  if (p.value) await store.ensurePhotoUrls(p.value)
  loading.value = false
  if (toast.value) setTimeout(() => (toast.value = ''), 2500)
  catchUp()
})
watch(() => p.value?.photos?.length, () => p.value && store.ensurePhotoUrls(p.value))

async function remove() {
  const wasDraft = p.value?.status === 'draft'
  await store.remove(props.id)
  confirmRemove.value = false
  if (wasDraft) router.replace({ name: 'properties' })
  else {
    toast.value = t('props.detail.markedUnavailable')
    setTimeout(() => (toast.value = ''), 2500)
  }
}
async function reactivate() {
  await store.reactivate(props.id)
  toast.value = t('props.detail.available')
  setTimeout(() => (toast.value = ''), 2500)
}
</script>

<template>
  <section class="container detail">
    <div class="top">
      <RouterLink :to="{ name: 'properties' }" class="btn btn-ghost">← {{ t('props.detail.back') }}</RouterLink>
      <RouterLink v-if="p && auth.canDraft" :to="{ name: 'local-property-edit', params: { id } }" class="btn">{{ t('common.edit') }}</RouterLink>
    </div>

    <div v-if="loading" class="spinner"></div>
    <p v-else-if="!p" class="alert">{{ t('common.notFound') }}</p>

    <template v-else>
      <div v-if="p.conflict" class="alert conflict" role="alert">
        <p>
          <strong>{{ t('merge.conflictBanner') }}</strong>
          <span class="muted">{{ p.remoteChangedAt ? t('merge.conflictWhen', { when: p.remoteChangedAt }) : t('merge.conflictHeld') }}</span>
        </p>
        <button type="button" class="btn small" @click="openConflict">{{ t('merge.conflictCompare') }}</button>
      </div>

      <p v-if="catchUpNote" class="alert alert-info catch-up" role="status">
        {{ catchUpNote }}
        <button type="button" class="link" @click="catchUpNote = ''">{{ t('common.close') }}</button>
      </p>

      <div class="gallery">
        <img :src="photos.length ? store.photoUrls[photos[active]?.id] || PLACEHOLDER : PLACEHOLDER" :alt="titleOf(p)" />
        <span class="badge" :class="Number(p.operation) === 2 ? 'badge-rent' : 'badge-sale'">{{ Number(p.operation) === 2 ? t('common.rent') : t('common.sale') }}</span>
        <span v-if="!photos.length" class="no-photos">{{ t('props.detail.noPhotos') }}</span>
        <div v-if="photos.length > 1" class="thumbs">
          <button v-for="(ph, i) in photos" :key="ph.id" type="button" :class="{ active: i === active }" @click="active = i">
            <img :src="store.photoUrls[ph.id] || PLACEHOLDER" alt="" />
          </button>
        </div>
      </div>

      <header class="head">
        <div>
          <h1>{{ titleOf(p) }}</h1>
          <p class="muted">{{ locationOf(p) || t('props.detail.noLocation') }}</p>
        </div>
        <div class="price">{{ priceOf(p) }}</div>
      </header>

      <p class="sync muted">
        <InmovillaState :record="p" :sent="p.status !== 'draft'" :label="`ref. ${p.ref}`" />
        <span v-if="pendingPhotos" class="pending-photos">· {{ t('props.detail.photosToUpload', pendingPhotos) }}</span>
        <span>· {{ t('props.form.complete', { n: completeness(p) }) }}</span>
      </p>
      <div v-if="auth.canEstimate && (Number(p.operation) === 2 ? p.priceRent : p.price)" class="estimate-cta">
        <RouterLink v-if="auth.hasAnthropic && auth.hasApiweb" :to="{ name: 'estimate', params: { source: 'local', id } }" class="btn">✦ {{ estimateLabel }}</RouterLink>
        <small v-if="savedEstimate?.at && auth.hasAnthropic && auth.hasApiweb" class="muted">{{ t('estimate.savedAt', { at: formatDate(savedEstimate.at) }) }}</small>
        <template v-else>
          <button type="button" class="btn" disabled>✦ {{ t('estimate.button') }}</button>
          <small v-if="auth.isAdmin" class="muted">{{ !auth.hasApiweb ? t('estimate.needsApiweb') : t('estimate.addKeyHint') }}</small>
        </template>
      </div>
      <p v-if="p.syncError" class="alert">{{ t('props.detail.rejected', { msg: p.syncError }) }}</p>
      <p v-else-if="p.status === 'unavailable'" class="alert alert-info">
        {{ t('props.detail.unavailable') }} <button v-if="auth.canWrite" type="button" class="link" @click="reactivate">{{ t('props.detail.reactivate') }}</button>
      </p>
      <p v-else-if="p.codOfer" class="alert alert-info">
        {{ t('props.detail.inInmovilla', { cod: p.codOfer }) }} <RouterLink :to="{ name: 'property', params: { codOfer: p.codOfer } }">{{ t('props.detail.viewFicha') }}</RouterLink>.
      </p>
      <p v-else-if="p.status === 'sent'" class="alert alert-info">{{ t('props.detail.sentPending') }}</p>

      <article v-if="p.description" class="block">
        <h2>{{ t('props.description') }}</h2>
        <p class="description">{{ p.description }}</p>
      </article>

      <article v-if="activeFeatures(p).length" class="block">
        <h2>{{ t('props.extras') }}</h2>
        <ul class="features"><li v-for="f in activeFeatures(p)" :key="f">{{ f }}</li></ul>
      </article>

      <article class="block">
        <h2>{{ t('props.details') }}</h2>
        <dl class="rows">
          <template v-for="[label, value] in rows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
        </dl>
      </article>

      <article v-if="p.codOfer" class="block">
        <div class="block-head">
          <h2>{{ t('props.followUps') }}</h2>
          <RouterLink v-if="auth.canWrite" :to="{ name: 'followup-new', query: { codOfer: p.codOfer, propertyLabel: `${t('common.ref')} ${p.ref} · ${titleOf(p)}` } }" class="btn small">+ {{ t('common.new') }}</RouterLink>
        </div>
        <p v-if="!propertyFollowUps.length" class="muted">{{ t('props.detail.noFollowUps') }}</p>
        <div v-else class="fu-list"><FollowUpCard v-for="f in propertyFollowUps.slice(0, 5)" :key="f.id" :follow-up="f" compact /></div>
      </article>

      <article v-if="p.ownerPhone && !ownerIsComplete(p)" class="block owner-todo">
        <h2>{{ t('props.detail.ownerIncomplete') }}</h2>
        <p class="muted">{{ t('props.detail.ownerIncompleteBody', { phone: p.ownerPhone }) }}</p>
        <RouterLink v-if="auth.canWrite" :to="{ name: 'local-property-edit', params: { id } }" class="btn btn-ghost small">{{ t('props.detail.ownerComplete') }}</RouterLink>
      </article>

      <article v-if="p.ownerName || p.ownerPhone || p.notes" class="block">
        <h2>{{ t('props.detail.ownerNotes') }}</h2>
        <dl class="rows">
          <template v-if="p.ownerName"><dt>{{ t('props.form.owner') }}</dt><dd>{{ [p.ownerName, p.ownerSurname].filter(Boolean).join(' ') }} <span v-if="p.ownerRemoteId" class="muted">· {{ t('props.detail.ownerInInmovilla', { id: p.ownerRemoteId }) }}</span><span v-else-if="p.status !== 'draft'" class="muted">· {{ t('props.detail.ownerPending') }}</span></dd></template>
          <template v-if="p.ownerPhone"><dt>{{ t('props.form.ownerPhone') }}</dt><dd><a :href="`tel:${p.ownerPhone}`">{{ p.ownerPhone }}</a></dd></template>
          <template v-if="p.ownerEmail"><dt>{{ t('common.email') }}</dt><dd><a :href="`mailto:${p.ownerEmail}`">{{ p.ownerEmail }}</a></dd></template>
        </dl>
        <p v-if="p.notes" class="description notes">{{ p.notes }}</p>
      </article>

      <p class="dates muted">{{ t('props.detail.created') }} {{ formatDate(new Date(p.createdAt).toISOString()) }} · {{ t('props.detail.updated') }} {{ formatDate(new Date(p.updatedAt).toISOString()) }} · <span :style="{ color: status.color }">{{ t(status.labelKey) }}</span></p>

      <div v-if="p.status !== 'unavailable' && auth.canWrite" class="danger-zone">
        <button type="button" class="btn btn-ghost danger" @click="confirmRemove = true">
          {{ p.status === 'draft' ? t('props.detail.deleteDraft') : t('props.detail.unpublish') }}
        </button>
      </div>
      <BusyDialog
        :open="Boolean(busy)"
        :message="busy === 'address' ? t('merge.reading') : t('merge.searching')"
        :detail="busy === 'address' ? t('merge.readingDetail') : ''"
        @cancel="cancelCatchUp"
      />

      <MergeDialog
        :open="Boolean(merge)"
        :title="merge?.title || ''"
        :intro="merge?.intro || ''"
        :rows="merge?.rows || []"
        @apply="applyMerge"
        @close="merge = null"
      />

      <ConfirmDialog
        :open="confirmRemove"
        :message="p.status === 'draft' ? t('props.detail.confirmDraft', { t: titleOf(p) }) : t('props.detail.confirmUnpublish', { t: titleOf(p) })"
        :confirm-label="p.status === 'draft' ? t('props.detail.deleteDraft') : t('props.detail.unpublish')"
        @confirm="remove"
        @cancel="confirmRemove = false"
      />
    </template>

    <Transition name="toast"><div v-if="toast" class="toast" role="status">{{ toast }}</div></Transition>
  </section>
</template>

<style scoped>
.detail { padding-bottom: 5rem; }
.top { display: flex; justify-content: space-between; margin-bottom: 0.75rem; }
.gallery { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--photo-bg); }
.gallery > img { width: 100%; aspect-ratio: 16 / 10; max-height: 60vh; object-fit: cover; display: block; }
.gallery .badge { position: absolute; top: 0.75rem; left: 0.75rem; }
.no-photos { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-weight: 600; }
.thumbs { display: flex; gap: 0.4rem; padding: 0.5rem; overflow-x: auto; background: var(--surface); }
.thumbs button { flex: 0 0 72px; height: 54px; border: 2px solid transparent; border-radius: 8px; padding: 0; overflow: hidden; background: none; }
.thumbs button.active { border-color: var(--brand); }
.thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin: 1.25rem 0 0.25rem; }
.head h1 { margin: 0 0 0.2rem; font-size: 1.4rem; }
.head p { margin: 0; }
.price { font-size: 1.5rem; font-weight: 800; color: var(--brand); white-space: nowrap; }
.owner-todo { border-left: 4px solid var(--accent); }
.owner-todo h2 { margin-bottom: 0.35rem; }
.owner-todo p { margin: 0 0 0.7rem; }
.estimate-cta { margin: 0 0 0.85rem; display: flex; flex-direction: column; gap: 0.35rem; }
.estimate-cta .btn { width: 100%; }
.estimate-cta small { text-align: center; font-size: 0.78rem; }
.sync { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 1rem; }
.pending-photos { color: var(--accent); font-weight: 600; }
.link { border: 0; background: none; color: var(--brand); font-weight: 600; padding: 0; text-decoration: underline; font-size: inherit; }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; margin-bottom: 0.85rem; }
.block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
.block-head h2 { margin: 0; }
.small { padding: 0.4rem 0.8rem; font-size: 0.9rem; }
.fu-list { display: flex; flex-direction: column; gap: 0.5rem; }
.block h2 { margin: 0 0 0.7rem; font-size: 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.description { white-space: pre-line; margin: 0; line-height: 1.55; }
.notes { margin-top: 0.6rem; }
.features { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.4rem; list-style: none; padding: 0; margin: 0; }
.features li::before { content: '✓ '; color: var(--brand); font-weight: 700; }
.rows { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1.25rem; margin: 0; }
.rows dt { color: var(--muted); }
.rows dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.dates { font-size: 0.8rem; text-align: center; }
.danger-zone { margin-top: 1.5rem; display: flex; justify-content: center; }
.danger { color: var(--danger); }
.danger-fill { background: var(--danger); }
.confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; justify-content: center; }
.conflict { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.conflict p { margin: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.conflict .small { padding: 0.45rem 0.9rem; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
.catch-up { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.catch-up .link { border: 0; background: none; color: inherit; font-weight: 700; text-decoration: underline; padding: 0; font-size: 0.85rem; }
.toast { position: fixed; left: 50%; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); transform: translateX(-50%); background: var(--text); color: #fff; padding: 0.6rem 1.1rem; border-radius: 999px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }
@media (max-width: 520px) { .head { flex-direction: column; } }
</style>
