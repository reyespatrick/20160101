<script setup>
import { useI18n } from 'vue-i18n'
import { ref, watch } from 'vue'
import { fetchProperties, buildWhere } from '../api/inmovilla'
import { useAuthStore } from '../stores/auth'
import { useLocalPropertiesStore } from '../stores/localProperties'
const { t } = useI18n()

/** Pick an Inmovilla listing (cod_ofer) by reference or city. v-model: { codOfer, label } */
const props = defineProps({ modelValue: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const auth = useAuthStore()
const local = useLocalPropertiesStore()

const text = ref('')
const results = ref([])
const searching = ref(false)
const error = ref('')
let timer

watch(text, (q) => {
  clearTimeout(timer)
  error.value = ''
  if (!q.trim()) return (results.value = [])
  timer = setTimeout(search, 350)
})

async function search() {
  const q = text.value.trim()
  if (!q) return
  const mine = local.items
    .filter((p) => p.codOfer && !p.deleted && [p.ref, p.title, p.cityName].join(' ').toLowerCase().includes(q.toLowerCase()))
    .map((p) => ({ codOfer: String(p.codOfer), label: `${t('common.ref')} ${p.ref} · ${[p.typeName, p.cityName].filter(Boolean).join(' · ')}` }))
  if (navigator.onLine === false) {
    results.value = mine
    if (!mine.length) error.value = t('agenda.propertyPicker.offline')
    return
  }
  searching.value = true
  try {
    const { items } = await fetchProperties({ page: 1, pageSize: 8, where: buildWhere({ search: q }), order: 'fechaact desc' })
    const remote = items.map((p) => ({ codOfer: String(p.cod_ofer), label: `${t('common.ref')} ${p.ref} · ${[p.nbtipo, p.ciudad].filter(Boolean).join(' · ')}` }))
    const seen = new Set()
    results.value = [...mine, ...remote].filter((r) => !seen.has(r.codOfer) && seen.add(r.codOfer))
  } catch (err) {
    error.value = err.message || t('agenda.propertyPicker.failed')
    results.value = mine
  } finally {
    searching.value = false
  }
}
function pick(r) {
  emit('update:modelValue', r)
  text.value = ''
  results.value = []
}
function clear() {
  emit('update:modelValue', { codOfer: null, label: '' })
}
</script>

<template>
  <div class="picker">
    <div v-if="modelValue.codOfer" class="chosen">
      <span>🏠 {{ modelValue.label || t('agenda.property', { id: modelValue.codOfer }) }}</span>
      <button type="button" :aria-label="t('agenda.propertyPicker.remove')" @click="clear">×</button>
    </div>
    <template v-else>
      <input v-model="text" type="search" :placeholder="t('agenda.propertyPicker.ph')" autocomplete="off" />
      <p v-if="searching" class="muted small">{{ t('agenda.propertyPicker.searching') }}</p>
      <p v-else-if="error" class="err small">{{ error }}</p>
      <ul v-if="results.length" class="results">
        <li v-for="r in results" :key="r.codOfer"><button type="button" @click="pick(r)">{{ r.label }}</button></li>
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
.results button { width: 100%; text-align: left; border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 0.6rem 0.8rem; font-weight: 600; }
.small { font-size: 0.8rem; margin: 0.35rem 0 0; }
.err { color: var(--danger); }
</style>
