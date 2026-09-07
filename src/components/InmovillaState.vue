<script setup>
import { computed } from 'vue'

/** Shows where a record stands with respect to the Inmovilla CRM (server-owned `remote` field). */
const props = defineProps({
  record: { type: Object, required: true },
  compact: { type: Boolean, default: false },
})

const state = computed(() => {
  const r = props.record
  if (r.dirty) return { kind: 'pending', label: 'Pendiente de enviar', title: 'Guardado en este dispositivo, se enviará a Inmovilla al sincronizar' }
  const remote = r.remote
  if (!remote) return { kind: 'pending', label: 'En cola para Inmovilla', title: 'El servidor lo enviará a Inmovilla en breve' }
  if (remote.state === 'synced' && remote.syncedVersion === r.updatedAt) {
    const ref = remote.id && !String(remote.id).startsWith('dry-') ? ` · ref. ${remote.id}` : ''
    return { kind: 'ok', label: `En Inmovilla${ref}`, title: `Enviado a Inmovilla ${new Date(remote.syncedAt).toLocaleString('es-ES')}` }
  }
  if (remote.state === 'error') return { kind: 'error', label: 'Error al enviar a Inmovilla', title: remote.error || 'Se reintentará automáticamente' }
  return { kind: 'pending', label: 'Actualizando en Inmovilla', title: 'Cambios pendientes de enviar al CRM' }
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
