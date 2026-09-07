<script setup>
/** Single or multi select rendered as big tappable chips. */
const props = defineProps({
  options: { type: Array, required: true }, // [{ value, label }]
  modelValue: { type: [String, Number, Array, null], default: null },
  multiple: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

function isSelected(v) {
  return props.multiple ? (props.modelValue || []).includes(v) : props.modelValue === v
}
function toggle(v) {
  if (props.multiple) {
    const current = props.modelValue || []
    emit('update:modelValue', current.includes(v) ? current.filter((x) => x !== v) : [...current, v])
  } else {
    emit('update:modelValue', v)
  }
}
</script>

<template>
  <div class="chips" :role="multiple ? 'group' : 'radiogroup'">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      class="chip"
      :class="{ selected: isSelected(o.value) }"
      :role="multiple ? 'checkbox' : 'radio'"
      :aria-checked="isSelected(o.value)"
      @click="toggle(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.chip {
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 999px;
  padding: 0.5rem 0.95rem;
  font-weight: 600;
  min-height: 40px;
}
.chip.selected { background: var(--brand); border-color: var(--brand); color: #fff; }
</style>
