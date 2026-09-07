<script setup>
import { computed } from 'vue'
import InmovillaState from './InmovillaState.vue'
import { bucketOf, formatWhen } from '../models/followUp'
import { useFollowUpsStore } from '../stores/followUps'
import { useEnumsStore } from '../stores/enums'

const props = defineProps({ followUp: { type: Object, required: true }, compact: { type: Boolean, default: false } })
const store = useFollowUpsStore()
const enums = useEnumsStore()
const f = computed(() => props.followUp)
const typeName = computed(() => f.value.typeName || enums.followUpTypeLabel(f.value.typeKey))
const bucket = computed(() => bucketOf(f.value))
const color = computed(() => ({ overdue: '#c0392b', today: '#f39200', upcoming: '#2e3192', closed: '#6b6e85' })[bucket.value])

async function toggle(e) {
  e.preventDefault()
  e.stopPropagation()
  await store.setClosed(f.value.id, !f.value.closed)
}
</script>

<template>
  <RouterLink :to="{ name: 'followup-edit', params: { id: f.id } }" class="fu" :class="{ closed: f.closed, compact }">
    <button type="button" class="check" :class="{ on: f.closed }" :aria-label="f.closed ? 'Reabrir' : 'Marcar como hecho'" :style="{ borderColor: color }" @click="toggle">
      <svg v-if="f.closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="3" /></svg>
    </button>
    <div class="body">
      <div class="when" :style="{ color }">{{ formatWhen(f.remindAt) }}<span v-if="typeName" class="type"> · {{ typeName }}</span></div>
      <div class="subject">{{ f.subject || 'Sin asunto' }}</div>
      <div v-if="!compact && (f.propertyLabel || f.propertyCodOfer || f.clientLabel || f.clientRemoteId)" class="links muted">
        <span v-if="f.propertyLabel || f.propertyCodOfer">🏠 {{ f.propertyLabel || `Propiedad ${f.propertyCodOfer}` }}</span>
        <span v-if="f.clientLabel || f.clientRemoteId">👤 {{ f.clientLabel || `Cliente nº ${f.clientRemoteId}` }}</span>
      </div>
      <div v-if="!compact && f.description" class="desc muted">{{ f.description }}</div>
      <InmovillaState :record="f" :sent="Boolean(f.remoteId)" compact />
    </div>
  </RouterLink>
</template>

<style scoped>
.fu { display: flex; gap: 0.8rem; align-items: flex-start; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 0.8rem 0.9rem; }
.fu.closed .subject { text-decoration: line-through; color: var(--muted); }
.check { flex: 0 0 28px; width: 28px; height: 28px; margin-top: 0.15rem; border-radius: 50%; border: 2.5px solid; background: var(--surface); color: #fff; display: grid; place-items: center; padding: 0; }
.check.on { background: #6b6e85; border-color: #6b6e85 !important; }
.check svg { width: 16px; height: 16px; }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.when { font-size: 0.8rem; font-weight: 700; }
.type { color: var(--muted); font-weight: 600; }
.subject { font-weight: 700; font-size: 1rem; }
.links { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; font-size: 0.82rem; }
.desc { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.compact { padding: 0.6rem 0.8rem; }
</style>
