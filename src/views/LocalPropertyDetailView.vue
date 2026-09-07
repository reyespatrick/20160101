<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CONDITIONS, LISTING_STATUSES, activeFeatures, completeness, labelOf, locationOf, priceOf, titleOf } from '../models/property'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { PLACEHOLDER, formatDate } from '../utils/format'

const props = defineProps({ id: { type: String, required: true } })
const store = useLocalPropertiesStore()
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const confirmDelete = ref(false)
const active = ref(0)
const toast = ref(route.query.saved ? 'Propiedad guardada' : '')

const p = computed(() => store.byId(props.id))
const status = computed(() => LISTING_STATUSES.find((s) => s.value === p.value?.status) || LISTING_STATUSES[0])
const photos = computed(() => [...(p.value?.photos || [])].sort((a, b) => a.order - b.order))
const pendingPhotos = computed(() => photos.value.filter((ph) => store.photoMeta[ph.id] && !store.photoMeta[ph.id].uploaded).length)
const rows = computed(() => {
  const d = p.value || {}
  return [
    ['Referencia', d.ref],
    ['Tipo', d.type],
    ['Dormitorios', d.bedrooms],
    ['Baños', d.bathrooms],
    ['Construidos', d.builtArea ? `${d.builtArea} m²` : ''],
    ['Útiles', d.usableArea ? `${d.usableArea} m²` : ''],
    ['Parcela', d.plotArea ? `${d.plotArea} m²` : ''],
    ['Planta', d.floor],
    ['Año', d.yearBuilt],
    ['Estado', labelOf(CONDITIONS, d.condition)],
    ['Orientación', d.orientation],
    ['Certificado energético', d.energyRating],
    ['Dirección', d.address],
    ['Código postal', d.postalCode],
    ['Provincia', d.province],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
})

onMounted(async () => {
  await store.ensureLoaded()
  if (p.value) await store.ensurePhotoUrls(p.value)
  loading.value = false
  if (toast.value) setTimeout(() => (toast.value = ''), 2500)
})
watch(() => p.value?.photos?.length, () => p.value && store.ensurePhotoUrls(p.value))

async function setStatus(value) {
  if (!p.value || p.value.status === value) return
  await store.save({ ...p.value, status: value })
  toast.value = `Estado: ${labelOf(LISTING_STATUSES, value)}`
  setTimeout(() => (toast.value = ''), 2000)
}

async function remove() {
  await store.remove(props.id)
  router.replace({ name: 'properties', query: { source: 'mine' } })
}
</script>

<template>
  <section class="container detail">
    <div class="top">
      <RouterLink :to="{ name: 'properties', query: { source: 'mine' } }" class="btn btn-ghost">← Mis propiedades</RouterLink>
      <RouterLink v-if="p" :to="{ name: 'local-property-edit', params: { id } }" class="btn">Editar</RouterLink>
    </div>

    <div v-if="loading" class="spinner"></div>
    <p v-else-if="!p" class="alert">Esta propiedad no existe o fue eliminada.</p>

    <template v-else>
      <div class="gallery">
        <img :src="photos.length ? store.photoUrls[photos[active]?.id] || PLACEHOLDER : PLACEHOLDER" :alt="titleOf(p)" />
        <span class="badge" :class="p.operation === 'rent' ? 'badge-rent' : 'badge-sale'">{{ p.operation === 'rent' ? 'Alquiler' : 'Venta' }}</span>
        <span v-if="!photos.length" class="no-photos">Sin fotos todavía</span>
        <div v-if="photos.length > 1" class="thumbs">
          <button v-for="(ph, i) in photos" :key="ph.id" type="button" :class="{ active: i === active }" @click="active = i">
            <img :src="store.photoUrls[ph.id] || PLACEHOLDER" alt="" />
          </button>
        </div>
      </div>

      <header class="head">
        <div>
          <h1>{{ titleOf(p) }}</h1>
          <p class="muted">{{ locationOf(p) || 'Sin ubicación' }}</p>
        </div>
        <div class="price">{{ priceOf(p) }}</div>
      </header>

      <p class="sync muted">
        <template v-if="p.dirty || pendingPhotos">
          <span class="dot pending"></span>
          Pendiente de sincronizar<span v-if="pendingPhotos"> · {{ pendingPhotos }} foto{{ pendingPhotos === 1 ? '' : 's' }} por subir</span>
        </template>
        <template v-else><span class="dot"></span> Sincronizada · ficha {{ completeness(p) }}% completa</template>
      </p>

      <article class="block">
        <h2>Estado de la ficha</h2>
        <div class="statuses">
          <button
            v-for="s in LISTING_STATUSES"
            :key="s.value"
            type="button"
            :class="{ active: p.status === s.value }"
            :style="p.status === s.value ? { background: s.color, borderColor: s.color } : {}"
            @click="setStatus(s.value)"
          >
            {{ s.label }}
          </button>
        </div>
        <p v-if="p.status === 'ready'" class="hint muted">La publicación en Inmovilla requiere su API de escritura; mientras tanto la ficha queda lista para copiarla al CRM.</p>
      </article>

      <article v-if="p.description" class="block">
        <h2>Descripción</h2>
        <p class="description">{{ p.description }}</p>
      </article>

      <article v-if="activeFeatures(p).length" class="block">
        <h2>Extras</h2>
        <ul class="features"><li v-for="f in activeFeatures(p)" :key="f">{{ f }}</li></ul>
      </article>

      <article class="block">
        <h2>Detalles</h2>
        <dl class="rows">
          <template v-for="[label, value] in rows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
        </dl>
      </article>

      <article v-if="p.ownerName || p.ownerPhone || p.notes" class="block">
        <h2>Interno</h2>
        <dl class="rows">
          <template v-if="p.ownerName"><dt>Propietario</dt><dd>{{ p.ownerName }}</dd></template>
          <template v-if="p.ownerPhone"><dt>Teléfono</dt><dd><a :href="`tel:${p.ownerPhone}`">{{ p.ownerPhone }}</a></dd></template>
        </dl>
        <p v-if="p.notes" class="description notes">{{ p.notes }}</p>
      </article>

      <p class="dates muted">Creada {{ formatDate(new Date(p.createdAt).toISOString()) }} · Actualizada {{ formatDate(new Date(p.updatedAt).toISOString()) }}</p>

      <div class="danger-zone">
        <button v-if="!confirmDelete" type="button" class="btn btn-ghost danger" @click="confirmDelete = true">Eliminar propiedad</button>
        <div v-else class="confirm">
          <span>¿Eliminar “{{ titleOf(p) }}” y sus fotos?</span>
          <button type="button" class="btn danger-fill" @click="remove">Sí, eliminar</button>
          <button type="button" class="btn btn-ghost" @click="confirmDelete = false">No</button>
        </div>
      </div>
    </template>

    <Transition name="toast"><div v-if="toast" class="toast" role="status">{{ toast }}</div></Transition>
  </section>
</template>

<style scoped>
.detail { padding-bottom: 5rem; }
.top { display: flex; justify-content: space-between; margin-bottom: 0.75rem; }
.gallery { position: relative; border-radius: var(--radius); overflow: hidden; background: #e6e7f5; }
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
.sync { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; margin: 0.25rem 0 1rem; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #2e7d32; }
.dot.pending { background: var(--accent); }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; margin-bottom: 0.85rem; }
.block h2 { margin: 0 0 0.7rem; font-size: 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.statuses { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.statuses button { border: 1.5px solid var(--border); background: var(--surface); border-radius: 999px; padding: 0.5rem 0.9rem; font-weight: 600; min-height: 40px; color: var(--text); }
.statuses button.active { color: #fff; }
.hint { font-size: 0.8rem; margin: 0.6rem 0 0; }
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
.toast { position: fixed; left: 50%; bottom: calc(var(--nav-height) + 1rem + env(safe-area-inset-bottom)); transform: translateX(-50%); background: var(--text); color: #fff; padding: 0.6rem 1.1rem; border-radius: 999px; font-weight: 600; font-size: 0.9rem; box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }
@media (max-width: 520px) { .head { flex-direction: column; } }
</style>
