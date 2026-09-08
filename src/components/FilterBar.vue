<script setup>
import { useI18n } from 'vue-i18n'
import { ref, watch } from 'vue'
import { ORDER_OPTIONS } from '../api/inmovilla'
const { t } = useI18n()

const props = defineProps({
  filters: { type: Object, required: true },
  types: { type: Array, default: () => [] },
})
const emit = defineEmits(['update'])

const search = ref(props.filters.search)
let timer
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => emit('update', { search: value }), 400)
})

function set(key, value) {
  emit('update', { [key]: value })
}
</script>

<template>
  <form class="filters" @submit.prevent="emit('update', { search })">
    <div class="search">
      <input v-model="search" type="search" :placeholder="t('props.searchPlaceholder')" :aria-label="t('common.search')" />
    </div>
    <div class="segments" role="tablist" aria-label="Operación">
      <button
        v-for="opt in [
          { v: 'all', l: t('props.all') },
          { v: 'sale', l: t('common.sale') },
          { v: 'rent', l: t('common.rent') },
        ]"
        :key="opt.v"
        type="button"
        role="tab"
        :aria-selected="filters.operation === opt.v"
        :class="{ active: filters.operation === opt.v }"
        @click="set('operation', opt.v)"
      >
        {{ opt.l }}
      </button>
    </div>
    <select :value="filters.typeKey" :aria-label="t('props.allTypes')" @change="set('typeKey', $event.target.value)">
      <option value="">{{ t('props.allTypes') }}</option>
      <option v-for="t in types" :key="t.key_tipo" :value="t.key_tipo">{{ t.nbtipo || t.tipo }}</option>
    </select>
    <select :value="filters.order" :aria-label="t('props.sortRecent')" @change="set('order', $event.target.value)">
      <option v-for="o in ORDER_OPTIONS" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
    </select>
  </form>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
  margin-bottom: 1rem;
}
@media (min-width: 720px) {
  .filters { grid-template-columns: 2fr auto 1fr 1fr; align-items: center; }
}
.search input, select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.65rem 0.85rem;
  background: var(--surface);
}
.segments { display: inline-flex; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 3px; }
.segments button {
  flex: 1;
  border: 0;
  background: transparent;
  border-radius: 8px;
  padding: 0.45rem 0.9rem;
  font-weight: 600;
  color: var(--muted);
}
.segments button.active { background: var(--brand); color: #fff; }
</style>
