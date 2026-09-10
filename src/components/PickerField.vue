<script setup>
/**
 * A field that opens a list from the bottom of the screen instead of a native menu.
 *
 * The browser's own `<select>` is unusable here: on a phone it opens a floating column in the
 * middle of the screen, unsearchable, that covers the form and scrolls a hundred towns past the
 * thumb. This shows the same list as a sheet — full width, thumb at the bottom, a search field
 * as soon as there is enough to search — six entries — and the current choice ticked.
 *
 * The sheet is teleported to the body: every one of these fields sits inside something that
 * scrolls or clips (a form, another sheet), and a list clipped by its own parent is worse than
 * a native menu.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({
  modelValue: { type: [String, Number, null], default: null },
  options: { type: Array, default: () => [] }, // [{ value, label, hint }]
  title: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  emptyLabel: { type: String, default: '' }, // the "no choice" entry; absent when empty
  emptyValue: { type: [String, Number, null], default: null },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  id: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const query = ref('')
const search = ref(null)
const SEARCH_FROM = 6 // below that, a search field costs more taps than it saves

const same = (a, b) => String(a ?? '') === String(b ?? '')
const selected = computed(() => props.options.find((o) => same(o.value, props.modelValue)) || null)
const shownLabel = computed(() => selected.value?.label || (props.modelValue == null || props.modelValue === '' ? '' : String(props.modelValue)))
const searchable = computed(() => props.options.length >= SEARCH_FROM)

const plain = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const shown = computed(() => {
  const q = plain(query.value).trim()
  if (!q) return props.options
  return props.options.filter((o) => plain(o.label).includes(q) || plain(o.hint).includes(q))
})

watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  await nextTick()
  // Not focused on purpose when there is no search: raising the keyboard over a short list
  // hides the very thing the agent came to tap.
  if (searchable.value) search.value?.focus({ preventScroll: true })
})

function pick(option) {
  emit('update:modelValue', option.value)
  open.value = false
}
</script>

<template>
  <div class="picker" :class="{ compact }">
    <button
      :id="id"
      type="button"
      class="control"
      :class="{ invalid, empty: !shownLabel }"
      :disabled="disabled"
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      @click="open = true"
    >
      <span class="value">{{ shownLabel || placeholder || t('common.choose') }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" class="chevron"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>

    <Teleport to="body">
      <Transition name="picker">
        <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="title || placeholder" @click.self="open = false" @keydown.esc="open = false">
          <div class="panel">
            <header>
              <h2>{{ title || placeholder || t('common.choose') }}</h2>
              <button type="button" class="icon" :aria-label="t('common.close')" @click="open = false">✕</button>
            </header>
            <div v-if="searchable" class="search">
              <input ref="search" v-model="query" type="search" autocomplete="off" :placeholder="t('common.search')" />
            </div>
            <ul class="list" role="listbox">
              <li v-if="emptyLabel">
                <button type="button" class="row" :class="{ on: modelValue == null || modelValue === '' }" @click="pick({ value: emptyValue })">
                  <span class="muted">{{ emptyLabel }}</span>
                  <span v-if="modelValue == null || modelValue === ''" class="tick">✓</span>
                </button>
              </li>
              <li v-for="o in shown" :key="String(o.value)">
                <button type="button" class="row" :class="{ on: same(o.value, modelValue) }" @click="pick(o)">
                  <span class="text">
                    {{ o.label }}
                    <small v-if="o.hint" class="muted">{{ o.hint }}</small>
                  </span>
                  <span v-if="same(o.value, modelValue)" class="tick">✓</span>
                </button>
              </li>
              <li v-if="!shown.length" class="none muted">{{ t('common.noMatch') }}</li>
            </ul>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.control {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  font: inherit;
  font-size: 1rem;
  text-align: left;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
}
.control:focus-visible { outline: 2px solid var(--brand); border-color: transparent; }
.control:disabled { opacity: 0.55; cursor: not-allowed; }
.control.invalid { border-color: var(--danger); }
.control.empty .value { color: var(--muted); }
.value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { width: 18px; height: 18px; flex: none; color: var(--muted); }
.compact .control { min-height: 40px; padding: 0.4rem 0.6rem; font-size: 0.9rem; }

.backdrop { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-end; justify-content: center; background: rgba(12, 13, 31, 0.55); backdrop-filter: blur(2px); }
.panel { width: 100%; max-width: 560px; max-height: 85vh; display: flex; flex-direction: column; background: var(--surface); border-radius: var(--radius) var(--radius) 0 0; box-shadow: 0 -12px 40px rgba(12, 13, 31, 0.35); }
header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 1rem 1.1rem 0.6rem; border-bottom: 1px solid var(--border); }
header h2 { margin: 0; font-size: 1.05rem; }
.icon { border: 0; background: none; color: var(--muted); font-size: 1.1rem; min-width: 44px; min-height: 44px; cursor: pointer; }
.search { padding: 0.7rem 1.1rem 0.4rem; }
.search input { width: 100%; font-size: 1rem; border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; background: var(--surface); color: inherit; }
.search input:focus { outline: 2px solid var(--brand); border-color: transparent; }
.list { list-style: none; margin: 0; padding: 0.25rem 0.6rem calc(0.9rem + env(safe-area-inset-bottom)); overflow-y: auto; }
.row { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; min-height: 52px; padding: 0.7rem 0.75rem; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; font-size: 1rem; text-align: left; cursor: pointer; }
.row:hover { background: var(--surface-2); }
.row.on { background: var(--surface-2); font-weight: 700; }
.text { display: flex; flex-direction: column; gap: 0.1rem; }
.text small { font-weight: 400; font-size: 0.8rem; }
.tick { color: var(--brand); font-weight: 800; }
.none { padding: 1.2rem 0.75rem; text-align: center; }
.picker-enter-active, .picker-leave-active { transition: opacity 0.18s ease; }
.picker-enter-active .panel, .picker-leave-active .panel { transition: transform 0.22s ease; }
.picker-enter-from, .picker-leave-to { opacity: 0; }
.picker-enter-from .panel, .picker-leave-to .panel { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) { .picker-enter-active, .picker-leave-active, .picker-enter-active .panel, .picker-leave-active .panel { transition: none; } }
</style>
