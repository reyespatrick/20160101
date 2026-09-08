<script setup>
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
const { t } = useI18n()

/** Where a record stands with respect to Inmovilla. `sent` = already exists there; `label` = its reference. */
const props = defineProps({
  record: { type: Object, required: true },
  sent: { type: Boolean, default: false },
  label: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})

const state = computed(() => {
  const r = props.record
  if (r.syncError) return { kind: 'error', label: t('common.rejected'), title: r.syncError }
  if (r.dirty && props.sent) return { kind: 'pending', label: t('common.changesToSend'), title: t('common.changesTitle') }
  if (r.dirty || !props.sent) return { kind: 'pending', label: t('common.pendingSend'), title: t('common.pendingTitle') }
  return { kind: 'ok', label: `${t('common.inInmovilla')}${props.label ? ` · ${props.label}` : ''}`, title: t('common.sentTitle') }
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
.ok .dot { background: var(--ok); }
.ok { color: var(--ok); }
.error .dot { background: var(--danger); }
.error { color: var(--danger); }
.pending .dot { animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
</style>
