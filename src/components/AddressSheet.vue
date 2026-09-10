<script setup>
/**
 * The address of a listing, edited in a sheet that rises from the bottom of the screen.
 *
 * It is kept out of the main form on purpose: standing in front of a house, an agent taps the
 * GPS button and the address is already right. Typing it is the exception, so it gets its own
 * surface — one thing at a time, thumb at the bottom, and nothing else scrolling past.
 *
 * Province first, then the town: Andalusia has 785 municipalities and a single list of them
 * would be unusable, while a province narrows it to between 45 and 174, filtered as you type.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PickerField from './PickerField.vue'
import { PROVINCES, municipalitiesOf } from '../data/andalucia'

const { t } = useI18n()
const props = defineProps({
  open: { type: Boolean, default: false },
  address: { type: Object, required: true },
  zoneOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['save', 'close'])

const draft = ref(blank())

function blank() {
  return { province: '', cityName: '', cityCatastro: '', zoneKey: null, zoneName: '', street: '', number: '', postalCode: '', floor: null, cadastralRef: '' }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    // Nothing is focused: the keyboard would rise over the sheet it was opened to show, and the
    // first thing most people do here is tap GPS or a list, not type.
    draft.value = { ...blank(), ...JSON.parse(JSON.stringify(props.address)) }
  },
  { immediate: true },
)

const provinceOptions = computed(() => PROVINCES.map((p) => ({ value: p.code, label: p.label })))
const townOptions = computed(() => municipalitiesOf(draft.value.province).map((m) => ({ value: m.c, label: m.l })))
const zoneChoices = computed(() => props.zoneOptions.map((z) => ({ value: z.key_zona, label: z.zona })))

/** Changing province drops a town that no longer belongs to it. */
function onProvince(code) {
  draft.value.province = code
  if (!municipalitiesOf(code).some((m) => m.c === draft.value.cityCatastro)) {
    draft.value.cityName = ''
    draft.value.cityCatastro = ''
    draft.value.zoneKey = null
  }
}
function onCity(catastroName) {
  const hit = municipalitiesOf(draft.value.province).find((m) => m.c === catastroName)
  draft.value.cityName = hit ? hit.l : ''
  draft.value.cityCatastro = hit ? hit.c : ''
  draft.value.zoneKey = null
}
function onZone(key) {
  draft.value.zoneKey = key ?? null
  draft.value.zoneName = key ? props.zoneOptions.find((z) => z.key_zona === key)?.zona || '' : draft.value.zoneName
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="t('props.form.addressSheet')" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div class="panel">
        <header>
          <h2>{{ t('props.form.addressSheet') }}</h2>
          <button type="button" class="icon" :aria-label="t('common.close')" @click="emit('close')">✕</button>
        </header>

        <div class="body">
          <div class="field">
            <label for="sheet-province">{{ t('props.form.province') }}</label>
            <PickerField
              id="sheet-province"
              :model-value="draft.province"
              :options="provinceOptions"
              :title="t('props.form.province')"
              :placeholder="t('props.form.chooseProvince')"
              @update:model-value="onProvince"
            />
          </div>

          <div class="field">
            <label for="sheet-city">{{ t('props.form.city') }} *</label>
            <PickerField
              id="sheet-city"
              :model-value="draft.cityCatastro"
              :options="townOptions"
              :disabled="!draft.province"
              :title="t('props.form.city')"
              :placeholder="draft.province ? t('props.form.chooseCity') : t('props.form.chooseProvinceFirst')"
              @update:model-value="onCity"
            />
            <small v-if="draft.cityName && !draft.cityCatastro" class="muted">{{ t('props.form.cityOutside', { city: draft.cityName }) }}</small>
          </div>

          <div class="field">
            <label for="sheet-zone">{{ t('props.form.zone') }}</label>
            <PickerField
              v-if="zoneOptions.length"
              id="sheet-zone"
              :model-value="draft.zoneKey"
              :options="zoneChoices"
              :title="t('props.form.zone')"
              :placeholder="t('props.form.noZone')"
              :empty-label="t('props.form.noZone')"
              @update:model-value="onZone"
            />
            <input v-else id="sheet-zone" v-model.trim="draft.zoneName" :placeholder="t('props.form.zoneName')" />
          </div>

          <div class="two">
            <div class="field grow">
              <label for="sheet-street">{{ t('props.form.street') }}</label>
              <input id="sheet-street" v-model.trim="draft.street" autocomplete="street-address" />
            </div>
            <div class="field narrow">
              <label for="sheet-number">{{ t('props.form.number') }}</label>
              <input id="sheet-number" v-model.trim="draft.number" />
            </div>
          </div>

          <div class="two">
            <div class="field">
              <label for="sheet-cp">{{ t('props.form.cp') }}</label>
              <input id="sheet-cp" v-model.trim="draft.postalCode" inputmode="numeric" autocomplete="postal-code" />
            </div>
            <div class="field">
              <label for="sheet-floor">{{ t('props.form.floor') }}</label>
              <input id="sheet-floor" v-model.number="draft.floor" type="number" inputmode="numeric" min="-5" max="200" />
            </div>
          </div>

          <div class="field">
            <label for="sheet-cadastral">{{ t('props.form.cadastral') }}</label>
            <input id="sheet-cadastral" v-model.trim="draft.cadastralRef" autocapitalize="characters" :placeholder="t('props.form.cadastralPh')" />
            <small class="muted">{{ t('props.form.cadastralHint') }}</small>
          </div>
        </div>

        <footer>
          <button type="button" class="btn btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="btn" @click="emit('save', { ...draft })">{{ t('props.form.applyAddress') }}</button>
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
.body { padding: 0.9rem 1.1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.85rem; }
footer { display: flex; gap: 0.6rem; padding: 0.8rem 1.1rem calc(0.8rem + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); }
footer .btn { flex: 1; min-height: 48px; }
.field input { font-size: 1rem; }
.two { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 480px) { .two { grid-template-columns: 2fr 1fr; } .two:last-of-type { grid-template-columns: 1fr 1fr; } }
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.18s ease; }
.sheet-enter-active .panel, .sheet-leave-active .panel { transition: transform 0.22s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .panel, .sheet-leave-to .panel { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) { .sheet-enter-active, .sheet-leave-active, .sheet-enter-active .panel, .sheet-leave-active .panel { transition: none; } }
</style>
