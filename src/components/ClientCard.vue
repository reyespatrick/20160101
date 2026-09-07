<script setup>
import { computed } from 'vue'
import { CLIENT_STATUSES, CLIENT_TYPES, fullName, initials, labelOf } from '../models/client'

const props = defineProps({ client: { type: Object, required: true } })
const c = computed(() => props.client)
const status = computed(() => CLIENT_STATUSES.find((s) => s.value === c.value.status) || CLIENT_STATUSES[0])
</script>

<template>
  <RouterLink :to="{ name: 'client', params: { id: c.id } }" class="client-card">
    <div class="avatar" :style="{ background: status.color }">{{ initials(c) }}</div>
    <div class="info">
      <div class="name">{{ fullName(c) }} <em v-if="c.dirty" class="pending" title="Pendiente de sincronizar">●</em></div>
      <div class="meta muted">
        <span v-if="c.phone">{{ c.phone }}</span>
        <span v-else-if="c.email">{{ c.email }}</span>
        <span v-else>Sin contacto</span>
      </div>
      <div class="tags">
        <span class="tag" :style="{ color: status.color, borderColor: status.color }">{{ status.label }}</span>
        <span class="tag">{{ labelOf(CLIENT_TYPES, c.type) || 'Cliente' }}</span>
      </div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
  </RouterLink>
</template>

<style scoped>
.client-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.85rem 1rem;
  min-height: 72px;
}
.avatar {
  flex: 0 0 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 1rem;
}
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.name { font-weight: 700; font-size: 1.02rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending { color: var(--accent); font-style: normal; font-size: 0.7rem; vertical-align: middle; }
.meta { font-size: 0.88rem; }
.tags { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.tag { font-size: 0.72rem; font-weight: 700; border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.55rem; color: var(--muted); }
.chevron { width: 22px; height: 22px; color: var(--muted); flex: 0 0 auto; }
</style>
