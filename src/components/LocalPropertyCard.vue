<script setup>
import { computed, onMounted } from 'vue'
import { LISTING_STATUSES, completeness, labelOf, locationOf, priceOf, titleOf } from '../models/property'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { PLACEHOLDER } from '../utils/format'

const props = defineProps({ property: { type: Object, required: true } })
const store = useLocalPropertiesStore()
const p = computed(() => props.property)
const status = computed(() => LISTING_STATUSES.find((s) => s.value === p.value.status) || LISTING_STATUSES[0])
const cover = computed(() => store.coverUrl(p.value) || PLACEHOLDER)
const pendingPhotos = computed(() => (p.value.photos || []).filter((ph) => store.photoMeta[ph.id] && !store.photoMeta[ph.id].uploaded).length)

onMounted(() => store.ensurePhotoUrls(p.value))
</script>

<template>
  <RouterLink :to="{ name: 'local-property', params: { id: p.id } }" class="card">
    <div class="photo">
      <img :src="cover" :alt="titleOf(p)" loading="lazy" />
      <span class="badge" :class="p.operation === 'rent' ? 'badge-rent' : 'badge-sale'">{{ p.operation === 'rent' ? 'Alquiler' : 'Venta' }}</span>
      <span class="count">📷 {{ p.photos?.length || 0 }}</span>
    </div>
    <div class="body">
      <div class="row">
        <div class="price">{{ priceOf(p) }}</div>
        <span class="status" :style="{ color: status.color, borderColor: status.color }">{{ labelOf(LISTING_STATUSES, p.status) }}</span>
      </div>
      <h3 class="title">{{ titleOf(p) }}</h3>
      <div class="location muted">{{ locationOf(p) || '—' }}</div>
      <ul class="specs">
        <li v-if="p.bedrooms != null">{{ p.bedrooms }} hab.</li>
        <li v-if="p.bathrooms != null">{{ p.bathrooms }} baños</li>
        <li v-if="p.builtArea">{{ p.builtArea }} m²</li>
      </ul>
      <div class="foot muted">
        <span>Ref. {{ p.ref || '—' }}</span>
        <span v-if="p.dirty || pendingPhotos" class="pending">● pendiente de sincronizar</span>
        <span v-else>{{ completeness(p) }}% completa</span>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.card { display: flex; flex-direction: column; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.photo { position: relative; aspect-ratio: 4 / 3; background: #e6e7f5; }
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo .badge { position: absolute; top: 0.6rem; left: 0.6rem; }
.count { position: absolute; bottom: 0.5rem; right: 0.6rem; background: rgba(28,29,51,0.7); color: #fff; font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; }
.body { padding: 0.85rem 1rem 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.price { font-size: 1.15rem; font-weight: 800; color: var(--brand); }
.status { font-size: 0.72rem; font-weight: 700; border: 1px solid; border-radius: 999px; padding: 0.1rem 0.55rem; white-space: nowrap; }
.title { margin: 0; font-size: 1rem; font-weight: 600; }
.location { font-size: 0.9rem; }
.specs { display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; list-style: none; padding: 0; margin: 0.35rem 0 0; font-size: 0.85rem; }
.foot { display: flex; justify-content: space-between; font-size: 0.75rem; margin-top: 0.25rem; }
.pending { color: var(--accent); font-weight: 600; }
</style>
