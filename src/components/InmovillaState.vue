<script setup>
import { computed } from 'vue'

/** Where a record stands with respect to Inmovilla (device-side flags: dirty / remoteId / syncError). */
const props = defineProps({
  record: { type: Object, required: true },
  compact: { type: Boolean, default: false },
})

const state = computed(() => {
  const r = props.record
  if (r.syncError) return { kind: 'error', label: 'Rechazado por Inmovilla', title: r.syncError }
  if (r.dirty && r.remoteId) return { kind: 'pending', label: 'Cambios por enviar', title: 'Se enviarán a Inmovilla al recuperar la conexión' }
  if (r.dirty || !r.remoteId) return { kind: 'pending', label: 'Pendiente de enviar', title: 'Guardado en este dispositivo, se enviará a Inmovilla al sincronizar' }
  return { kind: 'ok', label: `En Inmovilla · ref. ${r.remoteId}`, title: 'Guardado en Inmovilla' }
})
</script>

<template>
  <span class="inmo" :class="[state.kind, { compact }]" :title="state.title">
    <span class="dot"></span>
    <template v-if="!compact">{{ state.label }}</template>
  </span>
</template>

<style scoped>
.inmo { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; font-weight: 600; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.ok .dot { background: #2e7d32; }
.ok { color: #2e7d32; }
.error .dot { background: var(--danger); }
.error { color: var(--danger); }
.pending .dot { animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
</style>
