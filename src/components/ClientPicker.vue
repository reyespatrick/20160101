<script setup>
import { useI18n } from 'vue-i18n'
import { computed, ref, watch } from 'vue'
import { fullName, matchesClient } from '../models/client'
import { useClientsStore } from '../stores/clients'
const { t } = useI18n()

/** Pick a client already in Inmovilla (cod_cli). v-model: { remoteId, label } */
const props = defineProps({ modelValue: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const clients = useClientsStore()

const text = ref('')
const candidates = computed(() => {
  const q = text.value.trim()
  if (!q) return []
  return clients.active.filter((c) => c.remoteId && matchesClient(c, q)).slice(0, 8)
})
let timer
watch(text, (q) => {
  clearTimeout(timer)
  clients.ensureLoaded()
  if (clients.canSearchRemote || /^[\d\s+()-]{6,}$/.test(q)) timer = setTimeout(() => clients.searchRemote(q), 500)
})
function pick(c) {
  emit('update:modelValue', { remoteId: String(c.remoteId), label: fullName(c) })
  text.value = ''
}
function clear() {
  emit('update:modelValue', { remoteId: null, label: '' })
}
</script>

<template>
  <div class="picker">
    <div v-if="modelValue.remoteId" class="chosen">
      <span>👤 {{ modelValue.label || t('clients.picker.client', { id: modelValue.remoteId }) }}</span>
      <button type="button" :aria-label="t('clients.picker.remove')" @click="clear">×</button>
    </div>
    <template v-else>
      <input v-model="text" type="search" :placeholder="t('clients.picker.ph')" autocomplete="off" />
      <p v-if="clients.searching" class="muted small">{{ t('clients.searchingRemote') }}</p>
      <p v-else-if="text && !candidates.length" class="muted small">{{ t('clients.picker.onlyInmovilla') }}</p>
      <ul v-if="candidates.length" class="results">
        <li v-for="c in candidates" :key="c.id"><button type="button" @click="pick(c)">{{ fullName(c) }} <span class="muted">{{ c.mobile || c.phone || c.email }}</span></button></li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
input { width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; font-size: 1rem; background: var(--surface); }
input:focus { outline: 2px solid var(--brand); border-color: transparent; }
.chosen { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; background: var(--surface-2); color: var(--brand-dark); border-radius: 10px; padding: 0.6rem 0.85rem; font-weight: 600; }
.chosen button { border: 0; background: transparent; color: inherit; font-size: 1.3rem; line-height: 1; }
.results { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.results button { width: 100%; text-align: left; border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 0.6rem 0.8rem; font-weight: 600; display: flex; justify-content: space-between; gap: 0.5rem; }
.small { font-size: 0.8rem; margin: 0.35rem 0 0; }
</style>
