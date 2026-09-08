<script setup>
import { useI18n } from 'vue-i18n'
import { computed, ref, watch } from 'vue'
import { useEnumsStore } from '../stores/enums'
const { t } = useI18n()

/** Search-as-you-type over Inmovilla's city list (key_loca). v-model: { key, name } */
const props = defineProps({ modelValue: { type: Object, required: true }, invalid: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])
const enums = useEnumsStore()

const text = ref(props.modelValue.name || '')
const open = ref(false)
const results = computed(() => (open.value ? enums.searchCities(text.value) : []))
const ready = computed(() => enums.ciudades.length > 0)

watch(
  () => props.modelValue.name,
  (n) => {
    if (n !== text.value) text.value = n || ''
  },
)

function onInput() {
  open.value = true
  if (props.modelValue.key) emit('update:modelValue', { key: null, name: text.value })
  else emit('update:modelValue', { key: null, name: text.value })
}
function pick(c) {
  text.value = c.ciudad
  open.value = false
  emit('update:modelValue', { key: c.key_loca, name: c.ciudad, province: c.provincia })
}
function onBlur() {
  setTimeout(() => (open.value = false), 150)
}
</script>

<template>
  <div class="city">
    <input
      :value="text"
      type="search"
      autocomplete="off"
      :class="{ invalid, picked: Boolean(modelValue.key) }"
      :placeholder="ready ? t('props.form.cityPh') : enums.loading.ciudades ? t('props.form.cityLoading') : t('props.form.city')"
      @input="text = $event.target.value; onInput()"
      @focus="open = true; enums.ensureCiudades()"
      @blur="onBlur"
    />
    <span v-if="modelValue.key" class="ok" :title="t('props.form.cityOk')">✓</span>
    <ul v-if="open && results.length" class="results" role="listbox">
      <li v-for="c in results" :key="c.key_loca" role="option" @mousedown.prevent="pick(c)">
        <strong>{{ c.ciudad }}</strong> <span class="muted">{{ c.provincia }}</span>
      </li>
    </ul>
    <small v-if="!ready && !enums.loading.ciudades && text" class="muted">{{ t('props.form.cityOffline') }}</small>
  </div>
</template>

<style scoped>
.city { position: relative; }
input { width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 2.2rem 0.7rem 0.85rem; font-size: 1rem; background: var(--surface); }
input:focus { outline: 2px solid var(--brand); border-color: transparent; }
input.invalid { border-color: var(--danger); }
input.picked { border-color: var(--ok); }
.ok { position: absolute; right: 0.8rem; top: 0.75rem; color: var(--ok); font-weight: 800; }
.results { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 0.25rem; list-style: none; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); max-height: 260px; overflow-y: auto; }
.results li { padding: 0.6rem 0.75rem; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 0.5rem; }
.results li:hover { background: var(--surface-2); }
</style>
