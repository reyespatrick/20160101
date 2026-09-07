<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePropertiesStore } from '../stores/properties'
import { PLACEHOLDER, featuresOf, formatDate, isRent, locationOf, operationLabel, photoOf, priceOf, surfaceOf } from '../utils/format'

const props = defineProps({ codOfer: { type: String, required: true } })
const store = usePropertiesStore()
const router = useRouter()

const detail = ref(null)
const loading = ref(true)
const error = ref('')
const activePhoto = ref(0)

const summary = computed(() => store.summaryFor(props.codOfer))
const p = computed(() => detail.value || summary.value)
const photos = computed(() => {
  const list = Array.isArray(detail.value?.fotos) ? detail.value.fotos.filter((u) => /^https?:\/\//.test(u)) : []
  return list.length ? list : [photoOf(p.value)]
})
const description = computed(() => {
  const d = detail.value?.descripciones
  if (Array.isArray(d)) return d.filter(Boolean).join('\n\n')
  if (typeof d === 'string') return d
  return detail.value?.descrip || ''
})
const title = computed(() => (p.value ? [p.value.nbtipo, p.value.ciudad].filter(Boolean).join(' en ') || `Ref. ${p.value.ref}` : ''))
const agent = computed(() => {
  const d = p.value || {}
  const name = [d.nombreagente, d.apellidosagente].filter(Boolean).join(' ')
  return { name, phone: d.telefono1agente || d.telefono, email: d.emailagente || d.email }
})
const details = computed(() => {
  const d = p.value || {}
  const rows = [
    ['Referencia', d.ref],
    ['Operación', operationLabel(d)],
    ['Tipo', d.nbtipo],
    ['Dormitorios', d.habitaciones],
    ['Baños', d.banyos],
    ['Superficie construida', surfaceOf(d)],
    ['Parcela', Number(d.m_parcela) ? `${d.m_parcela} m²` : ''],
    ['Planta', d.planta],
    ['Antigüedad', Number(d.antiguedad) ? `${d.antiguedad} años` : ''],
    ['Estado', d.nbconservacion],
    ['Certificado energético', d.energialetra],
    ['Provincia', d.provincia],
    ['Código postal', d.cp],
    ['Actualizado', formatDate(d.fechaact)],
  ]
  return rows.filter(([, v]) => {
    if (v === undefined || v === null) return false
    const text = String(v).trim()
    return text !== '' && text !== '0'
  })
})

function back() {
  if (window.history.length > 1) router.back()
  else router.push({ name: 'properties' })
}

onMounted(async () => {
  try {
    detail.value = await store.loadDetail(props.codOfer)
    if (!detail.value && !summary.value) error.value = 'Propiedad no encontrada'
  } catch (err) {
    error.value = summary.value ? '' : err.message || 'No se pudo cargar la ficha'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="container detail">
    <button class="btn btn-ghost back" type="button" @click="back">← Volver</button>

    <div v-if="loading && !p" class="spinner"></div>
    <p v-else-if="error && !p" class="alert" role="alert">{{ error }}</p>

    <template v-else-if="p">
      <div class="gallery">
        <img :src="photos[activePhoto]" :alt="title" @error="$event.target.src = PLACEHOLDER" />
        <span class="badge" :class="isRent(p) ? 'badge-rent' : 'badge-sale'">{{ operationLabel(p) }}</span>
        <div v-if="photos.length > 1" class="thumbs">
          <button v-for="(url, i) in photos" :key="url" type="button" :class="{ active: i === activePhoto }" @click="activePhoto = i">
            <img :src="url" alt="" loading="lazy" />
          </button>
        </div>
      </div>

      <header class="head">
        <div>
          <h1>{{ title }}</h1>
          <p class="muted">{{ locationOf(p) }}</p>
        </div>
        <div class="price">{{ priceOf(p) }}</div>
      </header>

      <ul class="quick">
        <li v-if="Number(p.habitaciones)"><strong>{{ p.habitaciones }}</strong> hab.</li>
        <li v-if="Number(p.banyos)"><strong>{{ p.banyos }}</strong> baños</li>
        <li v-if="surfaceOf(p)"><strong>{{ surfaceOf(p) }}</strong></li>
      </ul>

      <div v-if="loading" class="spinner" aria-label="Cargando ficha"></div>

      <article v-if="description" class="block">
        <h2>Descripción</h2>
        <p class="description">{{ description }}</p>
      </article>

      <article v-if="featuresOf(p).length" class="block">
        <h2>Características</h2>
        <ul class="features">
          <li v-for="f in featuresOf(p)" :key="f">{{ f }}</li>
        </ul>
      </article>

      <article class="block">
        <h2>Detalles</h2>
        <dl class="rows">
          <template v-for="[label, value] in details" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
      </article>

      <article v-if="agent.name || agent.phone || agent.email" class="block contact">
        <h2>Contacto</h2>
        <p v-if="agent.name"><strong>{{ agent.name }}</strong><span v-if="p.agencia" class="muted"> · {{ p.agencia }}</span></p>
        <div class="actions">
          <a v-if="agent.phone" class="btn" :href="`tel:${agent.phone}`">Llamar</a>
          <a v-if="agent.email" class="btn btn-ghost" :href="`mailto:${agent.email}?subject=Ref. ${p.ref}`">Email</a>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.detail { padding-bottom: 3rem; }
.back { margin-bottom: 0.75rem; }
.gallery { position: relative; border-radius: var(--radius); overflow: hidden; background: #e6e7f5; }
.gallery > img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; }
.gallery .badge { position: absolute; top: 0.75rem; left: 0.75rem; }
.thumbs { display: flex; gap: 0.4rem; padding: 0.5rem; overflow-x: auto; background: var(--surface); }
.thumbs button { flex: 0 0 72px; height: 54px; border: 2px solid transparent; border-radius: 8px; padding: 0; overflow: hidden; background: none; }
.thumbs button.active { border-color: var(--brand); }
.thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin: 1.25rem 0 0.5rem; }
.head h1 { margin: 0 0 0.2rem; font-size: 1.4rem; }
.head p { margin: 0; }
.price { font-size: 1.5rem; font-weight: 800; color: var(--brand); white-space: nowrap; }
.quick { display: flex; gap: 1.25rem; list-style: none; padding: 0; margin: 0.5rem 0 1rem; color: var(--muted); }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.25rem; margin-bottom: 1rem; }
.block h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
.description { white-space: pre-line; margin: 0; line-height: 1.55; }
.features { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.4rem; list-style: none; padding: 0; margin: 0; }
.features li::before { content: '✓ '; color: var(--brand); font-weight: 700; }
.rows { display: grid; grid-template-columns: max-content 1fr; gap: 0.45rem 1.25rem; margin: 0; }
.rows dt { color: var(--muted); }
.rows dd { margin: 0; font-weight: 600; }
.contact .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
@media (max-width: 520px) {
  .head { flex-direction: column; }
}
</style>
