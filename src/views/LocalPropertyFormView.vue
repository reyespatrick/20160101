<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChipGroup from '../components/ChipGroup.vue'
import CityPicker from '../components/CityPicker.vue'
import PhotoPicker from '../components/PhotoPicker.vue'
import { ENERGY_RATINGS, FEATURES, OPERATIONS, completeness, emptyProperty, suggestRef, validateProperty } from '../models/property'
import { useEnumsStore } from '../stores/enums'
import { useLocalPropertiesStore } from '../stores/localProperties'

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
  if (free === false) errors.value = { ...errors.value, ref: 'Esta referencia ya existe en Inmovilla' }
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
  if (refCheck.value === 'taken') errors.value.ref = 'Esta referencia ya existe en Inmovilla'
  if (Object.keys(errors.value).length) {
    document.querySelector('.field.invalid input, .field.invalid select, .invalid-chips, .city input.invalid')?.scrollIntoView({ block: 'center' })
    return
  }
  saving.value = true
  try {
    const saved = await store.save(JSON.parse(JSON.stringify(form)))
    router.replace({ name: 'local-property', params: { id: saved.id }, query: { saved: '1' } })
  } catch (err) {
    errors.value = { form: err.message || 'No se pudo guardar' }
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
      <button type="button" class="btn btn-ghost" @click="cancel">Cancelar</button>
      <h1>{{ isEdit ? 'Editar propiedad' : 'Nueva propiedad' }}</h1>
    </header>

    <p v-if="notFound" class="alert">Esta propiedad ya no existe.</p>

    <form v-else id="property-form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="alert alert-info">Sin conexión: la ficha y las fotos se guardan en este dispositivo y se enviarán a Inmovilla automáticamente.</p>
      <p v-if="enums.error" class="alert">{{ enums.error }}</p>

      <div class="progress" :aria-label="`Ficha ${progress}% completa`">
        <div class="bar"><span :style="{ width: progress + '%' }"></span></div>
        <small class="muted">{{ progress }}% completa</small>
      </div>

      <fieldset>
        <legend>Fotos</legend>
        <PhotoPicker v-model="form.photos" :urls="store.photoUrls" :add-files="addFiles" :remove-photo="removePhoto" />
      </fieldset>

      <fieldset>
        <legend>Referencia y operación</legend>
        <div class="field" :class="{ invalid: errors.ref }">
          <label for="ref">Referencia * <small class="muted">(única en Inmovilla; identifica la ficha)</small></label>
          <div class="ref-row">
            <input id="ref" v-model.trim="form.ref" :readonly="sentAlready" autocapitalize="characters" @blur="checkRef" />
            <span v-if="refCheck === 'checking'" class="muted">Comprobando…</span>
            <span v-else-if="refCheck === 'ok'" class="ok">Disponible</span>
            <span v-else-if="refCheck === 'taken'" class="err">Ya existe</span>
          </div>
          <small v-if="errors.ref" class="err">{{ errors.ref }}</small>
          <small v-else-if="sentAlready" class="muted">La referencia no se puede cambiar una vez enviada a Inmovilla.</small>
        </div>
        <ChipGroup v-model="form.operation" :options="OPERATIONS" />
        <div class="two">
          <div v-if="Number(form.operation) === 1" class="field" :class="{ invalid: errors.price }">
            <label for="price">Precio de venta (€) *</label>
            <input id="price" v-model.number="form.price" type="number" inputmode="numeric" min="0" step="1000" placeholder="Ej. 185000" />
            <small v-if="errors.price" class="err">{{ errors.price }}</small>
          </div>
          <div v-else class="field" :class="{ invalid: errors.priceRent }">
            <label for="priceRent">Alquiler mensual (€) *</label>
            <input id="priceRent" v-model.number="form.priceRent" type="number" inputmode="numeric" min="0" step="50" placeholder="Ej. 850" />
            <small v-if="errors.priceRent" class="err">{{ errors.priceRent }}</small>
          </div>
          <div class="field">
            <label for="publish">Publicación</label>
            <select id="publish" v-model="form.publish">
              <option :value="null">Por defecto</option>
              <option v-for="o in enums.options('eninternet')" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Tipo y ubicación</legend>
        <div class="field" :class="{ invalid: errors.typeKey }">
          <label for="type">Tipo de inmueble *</label>
          <select id="type" :value="form.typeKey ?? ''" @change="onTypeChange">
            <option value="" disabled>{{ typeOptions.length ? 'Elige un tipo' : enums.loading.tipos ? 'Cargando tipos de Inmovilla…' : 'Sin tipos (conéctate para descargarlos)' }}</option>
            <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <small v-if="errors.typeKey" class="err">{{ errors.typeKey }}</small>
        </div>
        <div class="field" :class="{ invalid: errors.cityKey }">
          <label>Ciudad *</label>
          <CityPicker v-model="city" :invalid="Boolean(errors.cityKey)" />
          <small v-if="errors.cityKey" class="err">{{ errors.cityKey }}</small>
        </div>
        <div class="field">
          <label for="zone">Zona</label>
          <select v-if="zoneOptions.length" id="zone" :value="form.zoneKey ?? ''" @change="onZoneChange">
            <option value="">Sin zona</option>
            <option v-for="z in zoneOptions" :key="z.key_zona" :value="z.key_zona">{{ z.zona }}</option>
          </select>
          <input v-else id="zone" v-model.trim="form.zoneName" :placeholder="form.cityKey && enums.loading.zonas ? 'Cargando zonas…' : 'Nombre de la zona (opcional)'" />
        </div>
        <div class="two">
          <div class="field grow">
            <label for="street">Calle</label>
            <input id="street" v-model.trim="form.street" autocomplete="street-address" placeholder="Av. de Niza" />
          </div>
          <div class="field">
            <label for="number">Número</label>
            <input id="number" v-model.trim="form.number" placeholder="12" />
          </div>
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.postalCode }">
            <label for="cp">Código postal</label>
            <input id="cp" v-model.trim="form.postalCode" inputmode="numeric" autocomplete="postal-code" placeholder="03540" />
            <small v-if="errors.postalCode" class="err">{{ errors.postalCode }}</small>
          </div>
          <div class="field">
            <label for="floor">Planta</label>
            <input id="floor" v-model.number="form.floor" type="number" inputmode="numeric" min="-5" max="200" placeholder="Ej. 3" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Características</legend>
        <div class="three">
          <div class="field"><label for="bedrooms">Dormitorios</label><input id="bedrooms" v-model.number="form.bedrooms" type="number" inputmode="numeric" min="0" max="50" placeholder="—" /></div>
          <div class="field"><label for="bathrooms">Baños</label><input id="bathrooms" v-model.number="form.bathrooms" type="number" inputmode="numeric" min="0" max="50" placeholder="—" /></div>
          <div class="field" :class="{ invalid: errors.yearBuilt }">
            <label for="year">Año de construcción</label>
            <input id="year" v-model.number="form.yearBuilt" type="number" inputmode="numeric" min="1500" max="2100" placeholder="—" />
            <small v-if="errors.yearBuilt" class="err">{{ errors.yearBuilt }}</small>
          </div>
        </div>
        <div class="three">
          <div class="field"><label for="built">Construidos (m²)</label><input id="built" v-model.number="form.builtArea" type="number" inputmode="decimal" min="0" placeholder="—" /></div>
          <div class="field"><label for="usable">Útiles (m²)</label><input id="usable" v-model.number="form.usableArea" type="number" inputmode="decimal" min="0" placeholder="—" /></div>
          <div class="field"><label for="plot">Parcela (m²)</label><input id="plot" v-model.number="form.plotArea" type="number" inputmode="decimal" min="0" placeholder="—" /></div>
        </div>
        <div class="two">
          <div class="field">
            <label for="condition">Estado</label>
            <select id="condition" v-model="form.conservation">
              <option :value="null">Sin especificar</option>
              <option v-for="o in enums.options('conservacion')" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="orientation">Orientación</label>
            <select id="orientation" v-model="form.orientation">
              <option :value="null">Sin especificar</option>
              <option v-for="o in enums.options('keyori')" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Certificado energético</label>
          <ChipGroup v-model="form.energyRating" :options="ENERGY_RATINGS.map((r) => ({ value: r, label: r || 'N/D' }))" />
        </div>
        <div class="field">
          <label>Extras</label>
          <div class="features">
            <label v-for="[key, label] in FEATURES" :key="key" class="feature" :class="{ on: form.features[key] }">
              <input type="checkbox" :checked="Boolean(form.features[key])" @change="toggleFeature(key)" />
              {{ label }}
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Título y descripción</legend>
        <div class="field">
          <label for="title">Título</label>
          <input id="title" v-model.trim="form.title" placeholder="Ej. Ático luminoso con vistas al mar" maxlength="160" />
        </div>
        <div class="field">
          <label for="description">Descripción</label>
          <textarea id="description" v-model="form.description" rows="6" placeholder="Distribución, luz, reformas, entorno, servicios cercanos…"></textarea>
          <small class="muted">{{ form.description.length }} caracteres</small>
        </div>
      </fieldset>

      <fieldset>
        <legend>Propietario <small class="muted">(se crea en Inmovilla vinculado a la propiedad)</small></legend>
        <div class="two">
          <div class="field"><label for="owner">Nombre</label><input id="owner" v-model.trim="form.ownerName" autocapitalize="words" /></div>
          <div class="field"><label for="ownerSurname">Apellidos</label><input id="ownerSurname" v-model.trim="form.ownerSurname" autocapitalize="words" /></div>
        </div>
        <div class="two">
          <div class="field"><label for="ownerPhone">Teléfono</label><input id="ownerPhone" v-model.trim="form.ownerPhone" type="tel" inputmode="tel" /></div>
          <div class="field" :class="{ invalid: errors.ownerEmail }">
            <label for="ownerEmail">Email</label>
            <input id="ownerEmail" v-model.trim="form.ownerEmail" type="email" inputmode="email" />
            <small v-if="errors.ownerEmail" class="err">{{ errors.ownerEmail }}</small>
          </div>
        </div>
        <div class="field">
          <label for="notes">Notas internas <small class="muted">(solo en este dispositivo)</small></label>
          <textarea id="notes" v-model="form.notes" rows="3" placeholder="Llaves, horarios de visita, comisión…"></textarea>
        </div>
      </fieldset>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="property-form" class="btn save" :disabled="saving || refCheck === 'checking'">
        {{ saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar propiedad' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
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
.ref-row input[readonly] { background: #f4f5fa; color: var(--muted); }
.ok { color: #2e7d32; font-weight: 700; font-size: 0.85rem; }
.err { color: var(--danger); font-size: 0.8rem; }
.features { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.45rem; }
.feature { display: flex; align-items: center; gap: 0.5rem; border: 1.5px solid var(--border); border-radius: 10px; padding: 0.55rem 0.7rem; font-weight: 600; cursor: pointer; min-height: 44px; }
.feature.on { border-color: var(--brand); background: #eef0fa; color: var(--brand-dark); }
.feature input { width: 18px; height: 18px; accent-color: var(--brand); }
.save-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-height) + env(safe-area-inset-bottom)); padding: 0.75rem 1rem; background: linear-gradient(to top, var(--bg) 70%, transparent); display: flex; justify-content: center; }
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
