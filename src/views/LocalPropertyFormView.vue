<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChipGroup from '../components/ChipGroup.vue'
import PhotoPicker from '../components/PhotoPicker.vue'
import {
  CONDITIONS, ENERGY_RATINGS, FEATURES, LISTING_STATUSES, OPERATIONS, ORIENTATIONS, PROPERTY_TYPES,
  completeness, emptyProperty, suggestRef, validateProperty,
} from '../models/property'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { usePropertiesStore } from '../stores/properties'

const props = defineProps({ id: { type: String, default: '' } })
const store = useLocalPropertiesStore()
const inmovilla = usePropertiesStore()
const router = useRouter()

const form = reactive(emptyProperty())
const errors = ref({})
// Once the user fixes a field, drop its error without waiting for the next submit.
watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return
    const fresh = validateProperty(form)
    errors.value = Object.fromEntries(Object.entries(errors.value).filter(([k]) => k === 'form' || fresh[k]))
  },
  { deep: true },
)
const saving = ref(false)
const notFound = ref(false)
const isEdit = computed(() => Boolean(props.id))
const addedPhotoIds = new Set() // photos added in this session; discarded on cancel of a new listing
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))

const typeOptions = computed(() => {
  const fromApi = (inmovilla.types || []).map((t) => String(t.nbtipo || t.tipo)).filter(Boolean)
  const names = fromApi.length ? fromApi : PROPERTY_TYPES
  return names.map((v) => ({ value: v, label: v }))
})
const statusOptions = LISTING_STATUSES.filter((s) => s.value !== 'published')
const progress = computed(() => completeness(form))

onMounted(async () => {
  await store.ensureLoaded()
  if (isEdit.value) {
    const existing = await store.get(props.id)
    if (!existing) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(existing)))
    await store.ensurePhotoUrls(form)
  } else {
    form.ref = suggestRef(store.items)
  }
})

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
  form.features[key] = form.features[key] ? 0 : 1
}

async function submit() {
  errors.value = validateProperty(form)
  if (Object.keys(errors.value).length) {
    document.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea, .invalid-chips')?.scrollIntoView({ block: 'center' })
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
      <p v-if="!online" class="alert alert-info">Sin conexión: la ficha y las fotos se guardan en este dispositivo y se subirán automáticamente.</p>

      <div class="progress" :aria-label="`Ficha ${progress}% completa`">
        <div class="bar"><span :style="{ width: progress + '%' }"></span></div>
        <small class="muted">{{ progress }}% completa</small>
      </div>

      <fieldset>
        <legend>Fotos</legend>
        <PhotoPicker v-model="form.photos" :urls="store.photoUrls" :add-files="addFiles" :remove-photo="removePhoto" />
      </fieldset>

      <fieldset>
        <legend>Operación y precio</legend>
        <ChipGroup v-model="form.operation" :options="OPERATIONS" />
        <div class="two">
          <div v-if="form.operation === 'sale'" class="field" :class="{ invalid: errors.price }">
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
            <label for="ref">Referencia</label>
            <input id="ref" v-model.trim="form.ref" placeholder="ALMA-0001" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Tipo de inmueble *</legend>
        <div :class="{ 'invalid-chips': errors.type }">
          <ChipGroup v-model="form.type" :options="typeOptions" />
        </div>
        <small v-if="errors.type" class="err">{{ errors.type }}</small>
        <div class="field">
          <label for="title">Título (opcional)</label>
          <input id="title" v-model.trim="form.title" placeholder="Ej. Piso luminoso junto a la playa" maxlength="160" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Ubicación</legend>
        <div class="two">
          <div class="field" :class="{ invalid: errors.city }">
            <label for="city">Ciudad *</label>
            <input id="city" v-model.trim="form.city" autocomplete="address-level2" placeholder="Alicante" />
            <small v-if="errors.city" class="err">{{ errors.city }}</small>
          </div>
          <div class="field">
            <label for="zone">Zona / barrio</label>
            <input id="zone" v-model.trim="form.zone" placeholder="Playa de San Juan" />
          </div>
        </div>
        <div class="field">
          <label for="address">Dirección</label>
          <input id="address" v-model.trim="form.address" autocomplete="street-address" placeholder="Calle, número, piso" />
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.postalCode }">
            <label for="cp">Código postal</label>
            <input id="cp" v-model.trim="form.postalCode" inputmode="numeric" autocomplete="postal-code" placeholder="03001" />
            <small v-if="errors.postalCode" class="err">{{ errors.postalCode }}</small>
          </div>
          <div class="field">
            <label for="province">Provincia</label>
            <input id="province" v-model.trim="form.province" placeholder="Alicante" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Características</legend>
        <div class="three">
          <div class="field">
            <label for="bedrooms">Dormitorios</label>
            <input id="bedrooms" v-model.number="form.bedrooms" type="number" inputmode="numeric" min="0" max="50" placeholder="—" />
          </div>
          <div class="field">
            <label for="bathrooms">Baños</label>
            <input id="bathrooms" v-model.number="form.bathrooms" type="number" inputmode="numeric" min="0" max="50" placeholder="—" />
          </div>
          <div class="field">
            <label for="floor">Planta</label>
            <input id="floor" v-model.trim="form.floor" placeholder="Ej. 3º" />
          </div>
        </div>
        <div class="three">
          <div class="field" :class="{ invalid: errors.builtArea }">
            <label for="built">Construidos (m²)</label>
            <input id="built" v-model.number="form.builtArea" type="number" inputmode="decimal" min="0" placeholder="—" />
            <small v-if="errors.builtArea" class="err">{{ errors.builtArea }}</small>
          </div>
          <div class="field">
            <label for="usable">Útiles (m²)</label>
            <input id="usable" v-model.number="form.usableArea" type="number" inputmode="decimal" min="0" placeholder="—" />
          </div>
          <div class="field">
            <label for="plot">Parcela (m²)</label>
            <input id="plot" v-model.number="form.plotArea" type="number" inputmode="decimal" min="0" placeholder="—" />
          </div>
        </div>
        <div class="three">
          <div class="field" :class="{ invalid: errors.yearBuilt }">
            <label for="year">Año de construcción</label>
            <input id="year" v-model.number="form.yearBuilt" type="number" inputmode="numeric" min="1500" max="2100" placeholder="—" />
            <small v-if="errors.yearBuilt" class="err">{{ errors.yearBuilt }}</small>
          </div>
          <div class="field">
            <label for="condition">Estado</label>
            <select id="condition" v-model="form.condition">
              <option v-for="c in CONDITIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="orientation">Orientación</label>
            <select id="orientation" v-model="form.orientation">
              <option v-for="o in ORIENTATIONS" :key="o" :value="o">{{ o || 'Sin especificar' }}</option>
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
        <legend>Descripción</legend>
        <div class="field">
          <textarea v-model="form.description" rows="6" placeholder="Describe la vivienda: distribución, luz, reformas, entorno, servicios cercanos…"></textarea>
          <small class="muted">{{ form.description.length }} caracteres</small>
        </div>
      </fieldset>

      <fieldset>
        <legend>Propietario y notas internas</legend>
        <div class="two">
          <div class="field">
            <label for="owner">Nombre del propietario</label>
            <input id="owner" v-model.trim="form.ownerName" autocapitalize="words" />
          </div>
          <div class="field">
            <label for="ownerPhone">Teléfono del propietario</label>
            <input id="ownerPhone" v-model.trim="form.ownerPhone" type="tel" inputmode="tel" />
          </div>
        </div>
        <div class="field">
          <label for="notes">Notas (no se publican)</label>
          <textarea id="notes" v-model="form.notes" rows="3" placeholder="Llaves, horarios de visita, comisión…"></textarea>
        </div>
        <div class="field">
          <label>Estado de la ficha</label>
          <ChipGroup v-model="form.status" :options="statusOptions" />
        </div>
      </fieldset>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="property-form" class="btn save" :disabled="saving">
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
.field.invalid input { border-color: var(--danger); }
.invalid-chips { outline: 2px solid var(--danger); border-radius: 12px; padding: 4px; }
.err { color: var(--danger); font-size: 0.8rem; }
.features { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.45rem; }
.feature { display: flex; align-items: center; gap: 0.5rem; border: 1.5px solid var(--border); border-radius: 10px; padding: 0.55rem 0.7rem; font-weight: 600; cursor: pointer; min-height: 44px; }
.feature.on { border-color: var(--brand); background: #eef0fa; color: var(--brand-dark); }
.feature input { width: 18px; height: 18px; accent-color: var(--brand); }
.save-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-height) + env(safe-area-inset-bottom)); padding: 0.75rem 1rem; background: linear-gradient(to top, var(--bg) 70%, transparent); display: flex; justify-content: center; }
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
