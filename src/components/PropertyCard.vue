<script setup>
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { bedroomsOf, PLACEHOLDER, isRent, locationOf, operationLabel, photoOf, priceOf, surfaceOf } from '../utils/format'
const { t } = useI18n()

const props = defineProps({ property: { type: Object, required: true } })
const p = computed(() => props.property)
const title = computed(() => [p.value.nbtipo, p.value.ciudad].filter(Boolean).join(' · ') || `${t('common.ref')} ${p.value.ref}`)
</script>

<template>
  <RouterLink :to="{ name: 'property', params: { codOfer: p.cod_ofer } }" class="card">
    <div class="photo">
      <img :src="photoOf(p)" :alt="title" loading="lazy" decoding="async" @error="$event.target.src = PLACEHOLDER" />
      <span class="badge" :class="isRent(p) ? 'badge-rent' : 'badge-sale'">{{ isRent(p) ? t('common.rent') : t('common.sale') }}</span>
      <span v-if="Number(p.destacado) === 1" class="badge badge-featured featured">{{ t('common.featured') }}</span>
    </div>
    <div class="body">
      <div class="price">{{ priceOf(p) }}</div>
      <h3 class="title">{{ title }}</h3>
      <div class="location muted">{{ locationOf(p) || '—' }}</div>
      <ul class="specs">
        <li v-if="bedroomsOf(p)">{{ t('common.rooms', { n: bedroomsOf(p) }) }}</li>
        <li v-if="Number(p.banyos)">{{ t('common.baths', { n: p.banyos }) }}</li>
        <li v-if="surfaceOf(p)">{{ surfaceOf(p) }}</li>
        <li v-if="Number(p.m_parcela)">{{ t('common.plot', { n: p.m_parcela }) }}</li>
      </ul>
      <div class="ref muted">{{ t('common.ref') }} {{ p.ref }}</div>
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
.photo { position: relative; aspect-ratio: 4 / 3; background: var(--photo-bg); }
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
