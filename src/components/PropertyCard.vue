<script setup>
import { computed } from 'vue'
import { PLACEHOLDER, isRent, locationOf, operationLabel, photoOf, priceOf, surfaceOf } from '../utils/format'

const props = defineProps({ property: { type: Object, required: true } })
const p = computed(() => props.property)
const title = computed(() => [p.value.nbtipo, p.value.ciudad].filter(Boolean).join(' en ') || `Ref. ${p.value.ref}`)
</script>

<template>
  <RouterLink :to="{ name: 'property', params: { codOfer: p.cod_ofer } }" class="card">
    <div class="photo">
      <img :src="photoOf(p)" :alt="title" loading="lazy" decoding="async" @error="$event.target.src = PLACEHOLDER" />
      <span class="badge" :class="isRent(p) ? 'badge-rent' : 'badge-sale'">{{ operationLabel(p) }}</span>
      <span v-if="Number(p.destacado) === 1" class="badge badge-featured featured">Destacado</span>
    </div>
    <div class="body">
      <div class="price">{{ priceOf(p) }}</div>
      <h3 class="title">{{ title }}</h3>
      <div class="location muted">{{ locationOf(p) || '—' }}</div>
      <ul class="specs">
        <li v-if="Number(p.habitaciones)">{{ p.habitaciones }} hab.</li>
        <li v-if="Number(p.banyos)">{{ p.banyos }} baños</li>
        <li v-if="surfaceOf(p)">{{ surfaceOf(p) }}</li>
        <li v-if="Number(p.m_parcela)">{{ p.m_parcela }} m² parcela</li>
      </ul>
      <div class="ref muted">Ref. {{ p.ref }}</div>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
}
.card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(30, 33, 100, 0.14); }
.photo { position: relative; aspect-ratio: 4 / 3; background: #e6e7f5; }
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo .badge { position: absolute; top: 0.6rem; left: 0.6rem; }
.photo .featured { left: auto; right: 0.6rem; }
.body { padding: 0.85rem 1rem 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
.price { font-size: 1.15rem; font-weight: 800; color: var(--brand); }
.title { margin: 0; font-size: 1rem; font-weight: 600; }
.location { font-size: 0.9rem; }
.specs { display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; list-style: none; padding: 0; margin: 0.35rem 0 0; font-size: 0.85rem; }
.ref { font-size: 0.75rem; margin-top: 0.25rem; }
</style>
