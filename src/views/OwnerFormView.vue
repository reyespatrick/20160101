<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { emptyOwner, validateOwner } from '../models/owner'
import { useOwnersStore } from '../stores/owners'

const props = defineProps({ id: { type: String, default: '' } })
const store = useOwnersStore()
const router = useRouter()
const route = useRoute()

const form = reactive(emptyOwner())
const errors = ref({})
const saving = ref(false)
const notFound = ref(false)
const confirmDelete = ref(false)
const isEdit = computed(() => Boolean(props.id))
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))
const propertyRef = ref(String(route.query.ref || ''))

watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return
    const fresh = validateOwner(form)
    errors.value = Object.fromEntries(Object.entries(errors.value).filter(([k]) => k === 'form' || fresh[k]))
  },
  { deep: true },
)

onMounted(async () => {
  await store.ensureLoaded()
  if (isEdit.value) {
    const existing = store.byId(props.id)
    if (!existing) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(existing)))
  } else {
    form.codOfer = route.query.codOfer ? String(route.query.codOfer) : null
  }
})

const backTarget = computed(() => (form.codOfer ? { name: 'property', params: { codOfer: form.codOfer } } : { name: 'properties' }))

async function submit() {
  errors.value = validateOwner(form)
  if (Object.keys(errors.value).length) {
    document.querySelector('.field.invalid input')?.focus()
    return
  }
  saving.value = true
  try {
    await store.save(JSON.parse(JSON.stringify(form)))
    router.replace(backTarget.value)
  } catch (err) {
    errors.value = { form: err.message || 'No se pudo guardar' }
  } finally {
    saving.value = false
  }
}
async function remove() {
  await store.remove(props.id)
  router.replace(backTarget.value)
}
</script>

<template>
  <section class="container form-view">
    <header class="form-head">
      <RouterLink :to="backTarget" class="btn btn-ghost">Cancelar</RouterLink>
      <h1>{{ isEdit ? 'Editar propietario' : 'Nuevo propietario' }}</h1>
    </header>

    <p v-if="notFound" class="alert">Este propietario no está en este dispositivo.</p>

    <form v-else id="owner-form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="alert alert-info">Sin conexión: se guardará en este dispositivo y se enviará a Inmovilla automáticamente.</p>
      <p v-if="!isEdit" class="alert alert-info">Se creará en Inmovilla vinculado a la propiedad <strong>{{ propertyRef || form.codOfer }}</strong>.</p>
      <p v-if="errors.codOfer" class="alert">{{ errors.codOfer }}</p>

      <fieldset>
        <legend>Datos del propietario</legend>
        <div class="two">
          <div class="field" :class="{ invalid: errors.name }">
            <label for="name">Nombre *</label>
            <input id="name" v-model.trim="form.name" autocapitalize="words" required />
            <small v-if="errors.name" class="err">{{ errors.name }}</small>
          </div>
          <div class="field"><label for="surname">Apellidos</label><input id="surname" v-model.trim="form.surname" autocapitalize="words" /></div>
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.mobile }">
            <label for="mobile">Móvil</label>
            <input id="mobile" v-model.trim="form.mobile" type="tel" inputmode="tel" />
            <small v-if="errors.mobile" class="err">{{ errors.mobile }}</small>
          </div>
          <div class="field" :class="{ invalid: errors.phone }">
            <label for="phone">Teléfono fijo</label>
            <input id="phone" v-model.trim="form.phone" type="tel" inputmode="tel" />
            <small v-if="errors.phone" class="err">{{ errors.phone }}</small>
          </div>
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.email }">
            <label for="email">Email</label>
            <input id="email" v-model.trim="form.email" type="email" inputmode="email" />
            <small v-if="errors.email" class="err">{{ errors.email }}</small>
          </div>
          <div class="field"><label for="nif">NIF / DNI</label><input id="nif" v-model.trim="form.nif" autocapitalize="characters" /></div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Dirección</legend>
        <div class="two">
          <div class="field"><label for="street">Calle</label><input id="street" v-model.trim="form.street" /></div>
          <div class="field"><label for="number">Número</label><input id="number" v-model.trim="form.number" /></div>
        </div>
        <div class="three">
          <div class="field" :class="{ invalid: errors.postalCode }">
            <label for="cp">Código postal</label>
            <input id="cp" v-model.trim="form.postalCode" inputmode="numeric" />
            <small v-if="errors.postalCode" class="err">{{ errors.postalCode }}</small>
          </div>
          <div class="field"><label for="city">Localidad</label><input id="city" v-model.trim="form.city" /></div>
          <div class="field"><label for="province">Provincia</label><input id="province" v-model.trim="form.province" /></div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Observaciones</legend>
        <div class="field"><textarea v-model="form.notes" rows="3" placeholder="Llaves, disponibilidad para visitas, acuerdos…"></textarea></div>
      </fieldset>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>

      <div v-if="isEdit" class="danger-zone">
        <button v-if="!confirmDelete" type="button" class="btn btn-ghost danger" @click="confirmDelete = true">Eliminar propietario</button>
        <div v-else class="confirm">
          <span>¿Eliminar este propietario en Inmovilla? Inmovilla lo rechazará si sigue vinculado a alguna propiedad.</span>
          <button type="button" class="btn danger-fill" @click="remove">Sí, eliminar</button>
          <button type="button" class="btn btn-ghost" @click="confirmDelete = false">No</button>
        </div>
      </div>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="owner-form" class="btn save" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar propietario' }}</button>
    </div>
  </section>
</template>

<style scoped>
.form-view { padding-bottom: 6rem; }
@media (min-width: 720px) { .save-bar { position: sticky; bottom: 0; margin-top: 1rem; } }
.form-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.form-head h1 { margin: 0; font-size: 1.35rem; }
form { display: flex; flex-direction: column; gap: 0.9rem; }
fieldset { border: 0; margin: 0; padding: 1rem 1.1rem; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 0.85rem; }
legend { float: left; width: 100%; font-weight: 700; margin-bottom: 0.5rem; padding: 0; }
.two, .three { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 600px) { .two { grid-template-columns: 1fr 1fr; } .three { grid-template-columns: 1fr 1fr 1fr; } }
.field input, .field textarea { font-size: 1rem; }
.field textarea { border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; resize: vertical; font: inherit; }
.field.invalid input { border-color: var(--danger); }
.err { color: var(--danger); font-size: 0.8rem; }
.danger-zone { display: flex; justify-content: center; }
.danger { color: var(--danger); }
.danger-fill { background: var(--danger); }
.confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; justify-content: center; }
.save-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-height) + env(safe-area-inset-bottom)); padding: 0.75rem 1rem; background: linear-gradient(to top, var(--bg) 70%, transparent); display: flex; justify-content: center; }
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
