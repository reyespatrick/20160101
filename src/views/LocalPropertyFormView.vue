<script setup>
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChipGroup from '../components/ChipGroup.vue'
import CityPicker from '../components/CityPicker.vue'
import PhotoPicker from '../components/PhotoPicker.vue'
import { ENERGY_RATINGS, FEATURES, OPERATIONS, completeness, emptyProperty, suggestRef, validateProperty } from '../models/property'
import { useEnumsStore } from '../stores/enums'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { reverseGeocode } from '../api/geocode'
import { searchClients } from '../api/inmovillaRest'
import { useSettingsStore } from '../stores/settings'
const { t } = useI18n()

const props = defineProps({ id: { type: String, default: '' } })
const store = useLocalPropertiesStore()
const enums = useEnumsStore()
const router = useRouter()

const form = reactive(emptyProperty())
const errors = ref({})
const saving = ref(false)
const notFound = ref(false)
const refCheck = ref('') // '', 'checking', 'ok', 'taken', 'unknown'
const isEdit = computed(() => Boolean(props.id))
const addedPhotoIds = new Set()
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))

watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return
    const fresh = validateProperty(form)
    errors.value = Object.fromEntries(Object.entries(errors.value).filter(([k]) => k === 'form' || fresh[k]))
  },
  { deep: true },
)

const city = computed({
  get: () => ({ key: form.cityKey, name: form.cityName }),
  set: (v) => {
    form.cityKey = v.key
    form.cityName = v.name
    if (v.key !== form.cityKey || !v.key) {
      form.zoneKey = null
    }
    if (v.key) enums.ensureZonas(v.key)
  },
})
const zoneOptions = computed(() => (form.cityKey ? enums.zoneOptions(form.cityKey) : []))
const progress = computed(() => completeness(form))
const typeOptions = computed(() => enums.typeOptions)
const sentAlready = computed(() => form.status !== 'draft')

/**
 * "Read the address": ask the device where it is, then let the relay turn that into a postal
 * address. Only fields the agent has not already typed are filled — a reading never overwrites
 * what someone entered on purpose.
 */
const advancedOpen = ref(false)
const ADVANCED_FIELDS = ['ref', 'cityKey', 'postalCode', 'yearBuilt', 'ownerEmail']
const locating = ref('')   // '' | 'locating' | 'reading'
const locateError = ref('')
const locatedLabel = ref('')

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('props.form.noGeolocation')))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? t('props.form.geoDenied') : t('props.form.geoFailed'))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  })
}

async function readAddress() {
  locateError.value = ''
  locatedLabel.value = ''
  locating.value = 'locating'
  try {
    const coords = await currentPosition()
    form.latitude = coords.latitude
    form.longitude = coords.longitude
    locating.value = 'reading'
    const { address, cadastre } = await reverseGeocode({ lat: coords.latitude, lon: coords.longitude, lang: useSettingsStore().locale })
    if (cadastre?.reference && !form.cadastralRef) form.cadastralRef = cadastre.reference
    if (!form.street) form.street = address.street || ''
    if (!form.number) form.number = address.number || ''
    if (!form.postalCode) form.postalCode = address.postalCode || ''
    if (!form.cityKey && address.city) {
      // Show the name at once, then resolve Inmovilla's key for it. That lookup must not be
      // awaited: the enums endpoint allows two calls a minute, so the store spaces them 31 s
      // apart and the button would appear frozen.
      city.value = { key: null, name: address.city }
      enums
        .ensureCiudades()
        .then(() => {
          if (form.cityKey || form.cityName !== address.city) return // the agent has moved on
          const match = enums.searchCities(address.city, 1)[0]
          if (match) city.value = { key: match.key_loca, name: match.ciudad }
        })
        .catch(() => {})
    }
    locatedLabel.value = address.label || cadastre?.label || ''
  } catch (err) {
    locateError.value = err.code === 'nomatch' ? t('props.form.geoNoAddress') : err.message || t('props.form.geoFailed')
  } finally {
    locating.value = ''
  }
}

/**
 * The owner is looked up by phone before anything is typed: Inmovilla offers no way to list
 * contacts, so the number is the only way to tell an existing owner from a new one — and the
 * only way to avoid creating a duplicate.
 */
const ownerLookup = ref('')  // '' | 'searching' | 'found' | 'none'
const ownerError = ref('')

async function findOwner() {
  const phone = String(form.ownerPhone || '').replace(/[^0-9]/g, '')
  ownerError.value = ''
  if (phone.length < 6) {
    ownerError.value = t('props.form.ownerPhoneShort')
    return
  }
  ownerLookup.value = 'searching'
  try {
    const found = await searchClients({ telefono: phone })
    const first = Array.isArray(found) ? found[0] : found
    if (first) {
      form.ownerName = first.name || first.nombre || form.ownerName
      form.ownerSurname = first.surname || first.apellidos || form.ownerSurname
      form.ownerEmail = first.email || form.ownerEmail
      form.ownerRemoteId = first.remoteId || first.cod_cli || null
      ownerLookup.value = 'found'
    } else {
      ownerLookup.value = 'none'
    }
  } catch (err) {
    if (err.status === 404) ownerLookup.value = 'none'
    else {
      ownerLookup.value = ''
      ownerError.value = err.message || t('common.failed', { where: '' })
    }
  }
}

/** "Not this one" / "create": keep the number, clear the identity, let the agent type. */
function newOwner() {
  form.ownerName = ''
  form.ownerSurname = ''
  form.ownerEmail = ''
  form.ownerRemoteId = null
  ownerLookup.value = 'none'
}

onMounted(async () => {
  await store.ensureLoaded()
  enums.restore()
  enums.ensureTipos().then(() => enums.ensureCiudades())
  if (isEdit.value) {
    const existing = await store.get(props.id)
    if (!existing) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(existing)))
    await store.ensurePhotoUrls(form)
    if (form.cityKey) enums.ensureZonas(form.cityKey)
  } else {
    form.ref = suggestRef()
  }
})

async function checkRef() {
  if (sentAlready.value || !form.ref) return
  refCheck.value = 'checking'
  const free = await store.refIsAvailable(form.ref.trim(), form.id)
  refCheck.value = free === null ? 'unknown' : free ? 'ok' : 'taken'
  if (free === false) errors.value = { ...errors.value, ref: t('props.form.refExists') }
}

function onTypeChange(e) {
  form.typeKey = e.target.value ? Number(e.target.value) : null
  form.typeName = enums.label('key_tipo', form.typeKey)
}
function onZoneChange(e) {
  form.zoneKey = e.target.value ? Number(e.target.value) : null
  form.zoneName = form.zoneKey ? zoneOptions.value.find((z) => z.key_zona === form.zoneKey)?.zona || '' : form.zoneName
}

async function addFiles(files) {
  for (const file of files) {
    const entry = await store.addPhotoFile(form.id, file, form.photos.length)
    addedPhotoIds.add(entry.id)
    form.photos.push(entry)
  }
}
async function removePhoto(photo) {
  await store.discardPhoto(photo.id)
  addedPhotoIds.delete(photo.id)
}
function toggleFeature(key) {
  form.features[key] = !form.features[key]
}

async function submit() {
  errors.value = validateProperty(form)
  if (refCheck.value === 'taken') errors.value.ref = t('props.form.refExists')
  if (Object.keys(errors.value).length) {
    // A field the agent cannot see cannot be fixed: open the accordion when the problem is inside it.
    if (ADVANCED_FIELDS.some((f) => errors.value[f])) advancedOpen.value = true
    await nextTick()
    document.querySelector('.field.invalid input, .field.invalid select, .invalid-chips, .city input.invalid')?.scrollIntoView({ block: 'center' })
    return
  }
  saving.value = true
  try {
    const saved = await store.save(JSON.parse(JSON.stringify(form)))
    router.replace({ name: 'local-property', params: { id: saved.id }, query: { saved: '1' } })
  } catch (err) {
    errors.value = { form: err.message || t('common.failed', { where: 'save' }) }
  } finally {
    saving.value = false
  }
}
async function cancel() {
  if (!isEdit.value) for (const id of addedPhotoIds) await store.discardPhoto(id)
  if (isEdit.value) router.replace({ name: 'local-property', params: { id: props.id } })
  else router.replace({ name: 'properties', query: { source: 'mine' } })
}
</script>

<template>
  <section class="container form-view">
    <header class="form-head">
      <button type="button" class="btn btn-ghost" @click="cancel">{{ t('common.cancel') }}</button>
      <h1>{{ isEdit ? t('props.form.editTitle') : t('props.form.title') }}</h1>
    </header>

    <p v-if="notFound" class="alert">{{ t('common.notFound') }}</p>

    <form v-else id="property-form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="alert alert-info">{{ t('common.offlineForm') }}</p>
      <p v-if="enums.error" class="alert">{{ enums.error }}</p>

      <div class="progress" :aria-label="t('props.form.complete', { n: progress })">
        <div class="bar"><span :style="{ width: progress + '%' }"></span></div>
        <small class="muted">{{ t('props.form.complete', { n: progress }) }}</small>
      </div>

      <!-- L'essentiel : ce qu'on peut saisir devant la porte, en trois minutes -->
      <fieldset>
        <legend class="legend-row">
          <span>{{ t('props.form.essentials') }}</span>
          <button type="button" class="btn btn-ghost small" :disabled="Boolean(locating)" @click="readAddress">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="pin"><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="2" /><circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2" /></svg>
            {{ locating === 'locating' ? t('props.form.locating') : locating === 'reading' ? t('props.form.reading') : t('props.form.readAddress') }}
          </button>
        </legend>
        <p v-if="locateError" class="alert geo">{{ locateError }}</p>
        <p v-else-if="locatedLabel" class="muted geo-ok">{{ locatedLabel }}</p>

        <h3 class="sub">{{ t('props.form.theProperty') }}</h3>
        <div class="field" :class="{ invalid: errors.typeKey }">
          <label for="type">{{ t('props.form.type') }} *</label>
          <select id="type" :value="form.typeKey ?? ''" @change="onTypeChange">
            <option value="" disabled>{{ typeOptions.length ? t('props.form.chooseType') : enums.loading.tipos ? t('props.form.loadingTypes') : t('props.form.noTypes') }}</option>
            <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <small v-if="errors.typeKey" class="err">{{ errors.typeKey }}</small>
        </div>

        <ChipGroup v-model="form.operation" :options="OPERATIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))" />
        <div class="two">
          <div v-if="Number(form.operation) === 1" class="field" :class="{ invalid: errors.price }">
            <label for="price">{{ t('props.form.price') }} *</label>
            <input id="price" v-model.number="form.price" type="number" inputmode="numeric" min="0" step="1000" placeholder="Ej. 185000" />
            <small v-if="errors.price" class="err">{{ errors.price }}</small>
          </div>
          <div v-else class="field" :class="{ invalid: errors.priceRent }">
            <label for="priceRent">{{ t('props.form.priceRent') }} *</label>
            <input id="priceRent" v-model.number="form.priceRent" type="number" inputmode="numeric" min="0" step="50" placeholder="Ej. 850" />
            <small v-if="errors.priceRent" class="err">{{ errors.priceRent }}</small>
          </div>
          <div class="field" :class="{ invalid: errors.builtArea }">
            <label for="built">{{ t('props.form.built') }} *</label>
            <input id="built" v-model.number="form.builtArea" type="number" inputmode="decimal" min="0" placeholder="—" />
            <small v-if="errors.builtArea" class="err">{{ errors.builtArea }}</small>
          </div>
        </div>

        <div class="field" :class="{ invalid: errors.conservation }">
          <label for="condition">{{ t('props.form.condition') }} *</label>
          <select id="condition" v-model="form.conservation">
            <option :value="null">{{ t('props.form.unspecified') }}</option>
            <option v-for="o in enums.options('conservacion')" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <small v-if="errors.conservation" class="err">{{ errors.conservation }}</small>
        </div>

        <h3 class="sub">{{ t('props.form.owner') }}</h3>

        <div class="field" :class="{ invalid: errors.ownerPhone }">
          <label for="ownerPhone">{{ t('props.form.ownerPhone') }} *</label>
          <div class="phone-row">
            <input id="ownerPhone" v-model.trim="form.ownerPhone" type="tel" inputmode="tel" :placeholder="t('props.form.ownerPhonePh')" @input="ownerLookup = ''" />
            <button type="button" class="btn btn-ghost small" :disabled="ownerLookup === 'searching'" @click="findOwner">
              {{ ownerLookup === 'searching' ? t('props.form.searching') : t('props.form.searchOwner') }}
            </button>
          </div>
          <small v-if="ownerError" class="err">{{ ownerError }}</small>
          <small v-else-if="errors.ownerPhone" class="err">{{ errors.ownerPhone }}</small>
          <small v-else class="muted">{{ t('props.form.ownerPhoneHint') }}</small>
        </div>
        <div v-if="ownerLookup === 'found'" class="lookup found">
          <span>{{ t('props.form.ownerFound', { name: [form.ownerName, form.ownerSurname].filter(Boolean).join(' ') }) }}</span>
          <button type="button" class="link" @click="newOwner">{{ t('props.form.ownerNotThem') }}</button>
        </div>
        <div v-else-if="ownerLookup === 'none'" class="lookup none">
          <span>{{ t('props.form.ownerNotFound') }}</span>
        </div>

        <div class="two">
          <div class="field" :class="{ invalid: errors.ownerName }">
            <label for="owner">{{ t('props.form.ownerName') }} *</label>
            <input id="owner" v-model.trim="form.ownerName" autocapitalize="words" />
            <small v-if="errors.ownerName" class="err">{{ errors.ownerName }}</small>
          </div>
          <div class="field" :class="{ invalid: errors.ownerSurname }">
            <label for="ownerSurname">{{ t('props.form.ownerSurname') }} *</label>
            <input id="ownerSurname" v-model.trim="form.ownerSurname" autocapitalize="words" />
            <small v-if="errors.ownerSurname" class="err">{{ errors.ownerSurname }}</small>
          </div>
        </div>

        <h3 class="sub">{{ t('props.form.photos') }} *</h3>
        <PhotoPicker v-model="form.photos" :urls="store.photoUrls" :add-files="addFiles" :remove-photo="removePhoto" />
        <small v-if="errors.photos" class="err">{{ errors.photos }}</small>
      </fieldset>

      <!-- Tout le reste : replié, mais jamais perdu -->
      <details class="advanced" :open="advancedOpen" @toggle="advancedOpen = $event.target.open">
        <summary>
          <span>{{ t('props.form.advanced') }}</span>
          <small class="muted">{{ t('props.form.advancedHint') }}</small>
        </summary>

        <fieldset>
          <legend>{{ t('props.form.refOp') }}</legend>
          <div class="field" :class="{ invalid: errors.ref }">
            <label for="ref">{{ t('props.form.ref') }} * <small class="muted">{{ t('props.form.refHint') }}</small></label>
            <div class="ref-row">
              <input id="ref" v-model.trim="form.ref" :readonly="sentAlready" autocapitalize="characters" @blur="checkRef" />
              <span v-if="refCheck === 'checking'" class="muted">{{ t('props.form.checking') }}</span>
              <span v-else-if="refCheck === 'ok'" class="ok">{{ t('props.form.available') }}</span>
              <span v-else-if="refCheck === 'taken'" class="err">{{ t('props.form.taken') }}</span>
            </div>
            <small v-if="errors.ref" class="err">{{ errors.ref }}</small>
            <small v-else-if="sentAlready" class="muted">{{ t('props.form.refLocked') }}</small>
          </div>
          <div class="field">
            <label for="publish">{{ t('props.form.publish') }}</label>
            <select id="publish" v-model="form.publish">
              <option :value="null">{{ t('props.form.publishDefault') }}</option>
              <option v-for="o in enums.options('eninternet')" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend>{{ t('props.form.typeLocation') }}</legend>
          <div class="field" :class="{ invalid: errors.cityKey }">
            <label>{{ t('props.form.city') }} *</label>
            <CityPicker v-model="city" :invalid="Boolean(errors.cityKey)" />
            <small v-if="errors.cityKey" class="err">{{ errors.cityKey }}</small>
          </div>
          <div class="field">
            <label for="zone">{{ t('props.form.zone') }}</label>
            <select v-if="zoneOptions.length" id="zone" :value="form.zoneKey ?? ''" @change="onZoneChange">
              <option value="">{{ t('props.form.noZone') }}</option>
              <option v-for="z in zoneOptions" :key="z.key_zona" :value="z.key_zona">{{ z.zona }}</option>
            </select>
            <input v-else id="zone" v-model.trim="form.zoneName" :placeholder="form.cityKey && enums.loading.zonas ? t('props.form.loadingZones') : t('props.form.zoneName')" />
          </div>
          <div class="two">
            <div class="field grow">
              <label for="street">{{ t('props.form.street') }}</label>
              <input id="street" v-model.trim="form.street" autocomplete="street-address" />
            </div>
            <div class="field">
              <label for="number">{{ t('props.form.number') }}</label>
              <input id="number" v-model.trim="form.number" />
            </div>
          </div>
          <div class="two">
            <div class="field" :class="{ invalid: errors.postalCode }">
              <label for="cp">{{ t('props.form.cp') }}</label>
              <input id="cp" v-model.trim="form.postalCode" inputmode="numeric" autocomplete="postal-code" />
              <small v-if="errors.postalCode" class="err">{{ errors.postalCode }}</small>
            </div>
            <div class="field">
              <label for="floor">{{ t('props.form.floor') }}</label>
              <input id="floor" v-model.number="form.floor" type="number" inputmode="numeric" min="-5" max="200" />
            </div>
          </div>
          <div class="field">
            <label for="cadastral">{{ t('props.form.cadastral') }}</label>
            <input id="cadastral" v-model.trim="form.cadastralRef" autocapitalize="characters" :placeholder="t('props.form.cadastralPh')" />
            <small class="muted">{{ t('props.form.cadastralHint') }}</small>
          </div>
        </fieldset>

        <fieldset>
          <legend>{{ t('props.form.characteristics') }}</legend>
          <div class="three">
            <div class="field"><label for="bedrooms">{{ t('props.form.bedrooms') }}</label><input id="bedrooms" v-model.number="form.bedrooms" type="number" inputmode="numeric" min="0" max="50" placeholder="—" /></div>
            <div class="field"><label for="bathrooms">{{ t('props.form.baths') }}</label><input id="bathrooms" v-model.number="form.bathrooms" type="number" inputmode="numeric" min="0" max="50" placeholder="—" /></div>
            <div class="field" :class="{ invalid: errors.yearBuilt }">
              <label for="year">{{ t('props.form.year') }}</label>
              <input id="year" v-model.number="form.yearBuilt" type="number" inputmode="numeric" min="1500" max="2100" placeholder="—" />
              <small v-if="errors.yearBuilt" class="err">{{ errors.yearBuilt }}</small>
            </div>
          </div>
          <div class="two">
            <div class="field"><label for="usable">{{ t('props.form.usable') }}</label><input id="usable" v-model.number="form.usableArea" type="number" inputmode="decimal" min="0" placeholder="—" /></div>
            <div class="field"><label for="plot">{{ t('props.form.plot') }}</label><input id="plot" v-model.number="form.plotArea" type="number" inputmode="decimal" min="0" placeholder="—" /></div>
          </div>
          <div class="field">
            <label for="orientation">{{ t('props.form.orientation') }}</label>
            <select id="orientation" v-model="form.orientation">
              <option :value="null">{{ t('props.form.unspecified') }}</option>
              <option v-for="o in enums.options('keyori')" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="field">
            <label>{{ t('props.form.energy') }}</label>
            <ChipGroup v-model="form.energyRating" :options="ENERGY_RATINGS.map((r) => ({ value: r, label: r || 'N/D' }))" />
          </div>
          <div class="field">
            <label>{{ t('props.form.extras') }}</label>
            <div class="features">
              <label v-for="[key, labelKey] in FEATURES" :key="key" class="feature" :class="{ on: form.features[key] }">
                <input type="checkbox" :checked="Boolean(form.features[key])" @change="toggleFeature(key)" />
                {{ t(labelKey) }}
              </label>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>{{ t('props.form.titleDesc') }}</legend>
          <div class="field">
            <label for="title">{{ t('props.form.titleField') }}</label>
            <input id="title" v-model.trim="form.title" :placeholder="t('props.form.titlePh')" maxlength="160" />
          </div>
          <div class="field">
            <label for="description">{{ t('props.form.descField') }}</label>
            <textarea id="description" v-model="form.description" rows="6" :placeholder="t('props.form.descPh')"></textarea>
            <small class="muted">{{ t('props.form.chars', { n: form.description.length }) }}</small>
          </div>
        </fieldset>

        <fieldset>
          <legend>{{ t('props.form.owner') }} <small class="muted">{{ t('props.form.ownerHint') }}</small></legend>
          <div class="field" :class="{ invalid: errors.ownerEmail }">
            <label for="ownerEmail">{{ t('props.form.ownerEmail') }}</label>
            <input id="ownerEmail" v-model.trim="form.ownerEmail" type="email" inputmode="email" />
            <small v-if="errors.ownerEmail" class="err">{{ errors.ownerEmail }}</small>
          </div>
          <div class="field">
            <label for="notes">{{ t('props.form.notes') }} <small class="muted">{{ t('props.form.notesHint') }}</small></label>
            <textarea id="notes" v-model="form.notes" rows="3" :placeholder="t('props.form.notesPh')"></textarea>
          </div>
        </fieldset>
      </details>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="property-form" class="btn save" :disabled="saving || refCheck === 'checking'">
        {{ saving ? t('common.saving') : isEdit ? t('props.form.saveChanges') : t('props.form.save') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.sub { margin: 1.1rem 0 0.2rem; font-size: 0.82rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.sub:first-of-type { margin-top: 0; }
.advanced { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); margin-bottom: 1rem; }
.advanced > summary { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; padding: 1rem 1.2rem; min-height: 48px; font-weight: 700; cursor: pointer; list-style: none; }
.advanced > summary::-webkit-details-marker { display: none; }
.advanced > summary::before { content: '▸'; color: var(--brand); font-size: 0.9em; transition: transform 0.15s; }
.advanced[open] > summary::before { transform: rotate(90deg); }
.advanced > summary small { font-weight: 400; font-size: 0.82rem; }
.advanced fieldset { border-top: 1px solid var(--border); border-radius: 0; box-shadow: none; margin: 0; }
.legend-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; width: 100%; }
.legend-row .small { padding: 0.4rem 0.7rem; font-size: 0.82rem; font-weight: 600; white-space: nowrap; }
.pin { width: 16px; height: 16px; }
.geo { margin: 0 0 0.75rem; }
.geo-ok { margin: -0.25rem 0 0.75rem; font-size: 0.82rem; }
.phone-row { display: flex; gap: 0.5rem; align-items: stretch; }
.phone-row input { flex: 1; min-width: 0; }
.phone-row .small { padding: 0 0.8rem; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
.lookup { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.6rem 0.8rem; border-radius: 10px; font-size: 0.88rem; margin-bottom: 0.25rem; }
.lookup.found { background: var(--ok-bg); color: var(--ok); }
.lookup.none { background: var(--surface-2); color: var(--brand-dark); }
.lookup .link { border: 0; background: none; color: inherit; font-weight: 700; text-decoration: underline; padding: 0; font-size: inherit; }
.form-view { padding-bottom: 6rem; }
@media (min-width: 720px) { .save-bar { position: sticky; bottom: 0; margin-top: 1rem; } }
.form-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.form-head h1 { margin: 0; font-size: 1.35rem; }
form { display: flex; flex-direction: column; gap: 0.9rem; }
.progress { display: flex; align-items: center; gap: 0.75rem; }
.bar { flex: 1; height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; }
.bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--brand), var(--accent)); transition: width 0.3s; }
fieldset { border: 0; margin: 0; padding: 1rem 1.1rem; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 0.85rem; }
legend { float: left; width: 100%; font-weight: 700; margin-bottom: 0.5rem; padding: 0; }
.two, .three { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 600px) { .two { grid-template-columns: 1fr 1fr; } .three { grid-template-columns: 1fr 1fr 1fr; } }
.field input, .field select, .field textarea { font-size: 1rem; }
.field textarea { border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; resize: vertical; font: inherit; }
.field textarea:focus { outline: 2px solid var(--brand); border-color: transparent; }
.field.invalid input, .field.invalid select { border-color: var(--danger); }
.ref-row { display: flex; align-items: center; gap: 0.6rem; }
.ref-row input { flex: 1; min-width: 0; text-transform: uppercase; }
.ref-row input[readonly] { background: var(--bg); color: var(--muted); }
.ok { color: var(--ok); font-weight: 700; font-size: 0.85rem; }
.err { color: var(--danger); font-size: 0.8rem; }
.features { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.45rem; }
.feature { display: flex; align-items: center; gap: 0.5rem; border: 1.5px solid var(--border); border-radius: 10px; padding: 0.55rem 0.7rem; font-weight: 600; cursor: pointer; min-height: 44px; }
.feature.on { border-color: var(--brand); background: var(--surface-2); color: var(--brand-dark); }
.feature input { width: 18px; height: 18px; accent-color: var(--brand); }
.save-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-height) + env(safe-area-inset-bottom)); padding: 0.75rem 1rem; background: linear-gradient(to top, var(--bg) 70%, transparent); display: flex; justify-content: center; }
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
