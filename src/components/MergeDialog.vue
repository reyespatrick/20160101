<script setup>
/**
 * Two versions of the same person, side by side, one line per disagreement.
 *
 * A contact typed in the field and the same contact in Inmovilla will differ — a nickname, an
 * old phone, an address that moved. Neither side is automatically right: the agent met them
 * yesterday, the CRM has the paperwork. So nothing is merged silently. Only the fields that
 * actually differ are shown, each with its two values, and the choice defaults to what is on the
 * device — except where the device has nothing, which no one wants to keep.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  intro: { type: String, default: '' },
  rows: { type: Array, default: () => [] }, // [{ key, label, mine, theirs }]
})
const emit = defineEmits(['apply', 'close'])

const choice = ref({})
const blank = (v) => v === null || v === undefined || String(v).trim() === ''
const shown = (v) => (blank(v) ? t('common.none') : String(v))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    // A row may say which side to lean on — where only one of the two moved, there is nothing to
    // arbitrate. Otherwise: empty on the device is not a decision anyone made, so take theirs.
    choice.value = Object.fromEntries(props.rows.map((r) => [r.key, r.prefer || (blank(r.mine) ? 'theirs' : 'mine')]))
  },
  { immediate: true },
)

const takenFromThem = computed(() => props.rows.filter((r) => choice.value[r.key] === 'theirs').length)

function all(side) {
  choice.value = Object.fromEntries(props.rows.map((r) => [r.key, side]))
}
function apply() {
  emit('apply', { ...choice.value })
}
</script>

<template>
  <Transition name="merge">
    <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="title" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div class="panel">
        <header>
          <h2>{{ title }}</h2>
          <button type="button" class="icon" :aria-label="t('common.close')" @click="emit('close')">✕</button>
        </header>

        <div class="body">
          <p v-if="intro" class="intro muted">{{ intro }}</p>
          <div class="shortcuts">
            <button type="button" class="btn btn-ghost small" @click="all('mine')">{{ t('merge.allMine') }}</button>
            <button type="button" class="btn btn-ghost small" @click="all('theirs')">{{ t('merge.allTheirs') }}</button>
          </div>

          <div v-for="row in rows" :key="row.key" class="row">
            <p class="label">{{ row.label }}</p>
            <div class="sides">
              <button type="button" class="side" :class="{ on: choice[row.key] === 'mine' }" @click="choice[row.key] = 'mine'">
                <small class="who">{{ t('merge.mine') }}</small>
                <span class="val" :class="{ empty: blank(row.mine) }">{{ shown(row.mine) }}</span>
              </button>
              <button type="button" class="side" :class="{ on: choice[row.key] === 'theirs' }" @click="choice[row.key] = 'theirs'">
                <small class="who">{{ t('merge.theirs') }}</small>
                <span class="val" :class="{ empty: blank(row.theirs) }">{{ shown(row.theirs) }}</span>
              </button>
            </div>
          </div>
        </div>

        <footer>
          <button type="button" class="btn btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="btn" @click="apply">{{ takenFromThem ? t('merge.keepChosen', takenFromThem, { named: { n: takenFromThem } }) : t('merge.keepMine') }}</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; background: rgba(12, 13, 31, 0.55); backdrop-filter: blur(2px); }
.panel { width: 100%; max-width: 560px; max-height: 92vh; display: flex; flex-direction: column; background: var(--surface); border-radius: var(--radius) var(--radius) 0 0; box-shadow: 0 -12px 40px rgba(12, 13, 31, 0.35); }
header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 1rem 1.1rem 0.6rem; border-bottom: 1px solid var(--border); }
header h2 { margin: 0; font-size: 1.05rem; }
.icon { border: 0; background: none; color: var(--muted); font-size: 1.1rem; min-width: 44px; min-height: 44px; cursor: pointer; }
.body { padding: 0.9rem 1.1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.9rem; }
.intro { margin: 0; font-size: 0.88rem; line-height: 1.45; }
.shortcuts { display: flex; gap: 0.5rem; }
.shortcuts .small { flex: 1; padding: 0.45rem 0.6rem; font-size: 0.82rem; font-weight: 600; }
.row { display: flex; flex-direction: column; gap: 0.35rem; }
.label { margin: 0; font-size: 0.78rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.side { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; min-height: 56px; padding: 0.55rem 0.7rem; border: 1.5px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.side.on { border-color: var(--brand); background: var(--surface-2); }
.who { font-size: 0.7rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.val { font-size: 0.95rem; word-break: break-word; }
.val.empty { color: var(--muted); font-style: italic; }
footer { display: flex; gap: 0.6rem; padding: 0.8rem 1.1rem calc(0.8rem + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); }
footer .btn { flex: 1; min-height: 48px; }
.merge-enter-active, .merge-leave-active { transition: opacity 0.18s ease; }
.merge-enter-active .panel, .merge-leave-active .panel { transition: transform 0.22s ease; }
.merge-enter-from, .merge-leave-to { opacity: 0; }
.merge-enter-from .panel, .merge-leave-to .panel { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) { .merge-enter-active, .merge-leave-active, .merge-enter-active .panel, .merge-leave-active .panel { transition: none; } }
</style>
