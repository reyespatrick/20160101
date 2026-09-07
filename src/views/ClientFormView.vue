<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChipGroup from '../components/ChipGroup.vue'
import { CLIENT_STATUSES, CLIENT_TYPES, OPERATIONS, emptyClient, validateClient } from '../models/client'
import { useClientsStore } from '../stores/clients'
import { usePropertiesStore } from '../stores/properties'

const props = defineProps({ id: { type: String, default: '' } })
const store = useClientsStore()
const properties = usePropertiesStore()
const router = useRouter()
const route = useRoute()

const form = reactive(emptyClient())
const errors = ref({})
const saving = ref(false)
const notFound = ref(false)
const zoneInput = ref('')
const isEdit = computed(() => Boolean(props.id))
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))

const typeOptions = computed(() => {
  const fromApi = (properties.types || []).map((t) => ({ value: String(t.nbtipo || t.tipo), label: String(t.nbtipo || t.tipo) }))
  if (fromApi.length) return fromApi
  return ['Piso', 'Apartamento', 'Chalet', 'Adosado', 'Ático', 'Local', 'Parcela'].map((v) => ({ value: v, label: v }))
})

onMounted(async () => {
  if (isEdit.value) {
    const existing = await store.get(props.id)
    if (!existing) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(existing)))
  } else if (typeof route.query.name === 'string') {
    // Prefill from the "create <search>" shortcut
    const q = route.query.name.trim()
    if (/^[\d\s+()-]{6,}$/.test(q)) form.phone = q
    else if (q.includes('@')) form.email = q
    else form.name = q
  }
})

function addZone() {
  const z = zoneInput.value.trim()
  if (z && !form.zones.includes(z)) form.zones.push(z)
  zoneInput.value = ''
}
function removeZone(z) {
  form.zones = form.zones.filter((x) => x !== z)
}

async function submit() {
  errors.value = validateClient(form)
  if (Object.keys(errors.value).length) {
    document.querySelector('.field.invalid input, .field.invalid textarea')?.focus()
    return
  }
  saving.value = true
  try {
    const saved = await store.save({ ...form })
    router.replace({ name: 'client', params: { id: saved.id }, query: { saved: '1' } })
  } catch (err) {
    errors.value = { form: err.message || 'No se pudo guardar' }
  } finally {
    saving.value = false
  }
}

function cancel() {
  if (isEdit.value) router.replace({ name: 'client', params: { id: props.id } })
  else router.replace({ name: 'clients' })
}
</script>

<template>
  <section class="container form-view">
    <header class="form-head">
      <button type="button" class="btn btn-ghost" @click="cancel">Cancelar</button>
      <h1>{{ isEdit ? 'Editar cliente' : 'Nuevo cliente' }}</h1>
    </header>

    <p v-if="notFound" class="alert">Este cliente ya no existe.</p>

    <form v-else id="client-form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="alert alert-info">Sin conexión: se guardará en este dispositivo y se sincronizará automáticamente.</p>

      <fieldset>
        <legend>Datos de contacto</legend>
        <div class="two">
          <div class="field" :class="{ invalid: errors.name }">
            <label for="name">Nombre *</label>
            <input id="name" v-model.trim="form.name" autocomplete="given-name" autocapitalize="words" placeholder="Nombre" required />
            <small v-if="errors.name" class="err">{{ errors.name }}</small>
          </div>
          <div class="field">
            <label for="surname">Apellidos</label>
            <input id="surname" v-model.trim="form.surname" autocomplete="family-name" autocapitalize="words" placeholder="Apellidos" />
          </div>
        </div>
        <div class="two">
          <div class="field">
            <label for="phone">Teléfono</label>
            <input id="phone" v-model.trim="form.phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="600 000 000" />
          </div>
          <div class="field" :class="{ invalid: errors.email }">
            <label for="email">Email</label>
            <input id="email" v-model.trim="form.email" type="email" inputmode="email" autocomplete="email" placeholder="nombre@ejemplo.com" />
            <small v-if="errors.email" class="err">{{ errors.email }}</small>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Tipo de cliente</legend>
        <ChipGroup v-model="form.type" :options="CLIENT_TYPES" />
      </fieldset>

      <fieldset>
        <legend>Estado</legend>
        <ChipGroup v-model="form.status" :options="CLIENT_STATUSES" />
      </fieldset>

      <fieldset>
        <legend>Qué busca</legend>
        <div class="field">
          <label>Operación</label>
          <ChipGroup v-model="form.operation" :options="OPERATIONS" />
        </div>
        <div class="field">
          <label>Tipo de inmueble</label>
          <ChipGroup v-model="form.propertyTypes" :options="typeOptions" multiple />
        </div>
        <div class="field">
          <label for="zone">Zonas / ciudades</label>
          <div class="zone-row">
            <input id="zone" v-model="zoneInput" placeholder="Añadir zona y pulsar Enter" enterkeyhint="done" @keydown.enter.prevent="addZone" />
            <button type="button" class="btn btn-ghost" @click="addZone">Añadir</button>
          </div>
          <div v-if="form.zones.length" class="zones">
            <span v-for="z in form.zones" :key="z" class="zone">{{ z }} <button type="button" :aria-label="`Quitar ${z}`" @click="removeZone(z)">×</button></span>
          </div>
        </div>
        <div class="three">
          <div class="field">
            <label for="bmin">Presupuesto mín. (€)</label>
            <input id="bmin" v-model.number="form.budgetMin" type="number" inputmode="numeric" min="0" step="1000" placeholder="0" />
          </div>
          <div class="field" :class="{ invalid: errors.budgetMax }">
            <label for="bmax">Presupuesto máx. (€)</label>
            <input id="bmax" v-model.number="form.budgetMax" type="number" inputmode="numeric" min="0" step="1000" placeholder="Sin límite" />
            <small v-if="errors.budgetMax" class="err">{{ errors.budgetMax }}</small>
          </div>
          <div class="field">
            <label for="beds">Dormitorios mín.</label>
            <input id="beds" v-model.number="form.bedrooms" type="number" inputmode="numeric" min="0" max="20" placeholder="—" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Notas</legend>
        <div class="field">
          <textarea v-model="form.notes" rows="4" placeholder="Horario de contacto, preferencias, próximos pasos…"></textarea>
        </div>
      </fieldset>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="client-form" class="btn save" :disabled="saving">
        {{ saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar cliente' }}
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
fieldset {
  border: 0;
  margin: 0;
  padding: 1rem 1.1rem;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
legend { float: left; width: 100%; font-weight: 700; margin-bottom: 0.5rem; padding: 0; }
.two, .three { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 600px) { .two { grid-template-columns: 1fr 1fr; } .three { grid-template-columns: 1fr 1fr 1fr; } }
.field input, .field textarea { font-size: 1rem; }
.field textarea { border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; resize: vertical; font: inherit; }
.field textarea:focus { outline: 2px solid var(--brand); border-color: transparent; }
.field.invalid input { border-color: var(--danger); }
.err { color: var(--danger); font-size: 0.8rem; }
.zone-row { display: flex; gap: 0.5rem; }
.zone-row input { flex: 1; min-width: 0; }
.zones { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.zone { background: #eef0fa; color: var(--brand-dark); border-radius: 999px; padding: 0.3rem 0.4rem 0.3rem 0.8rem; font-weight: 600; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.3rem; }
.zone button { border: 0; background: transparent; color: inherit; font-size: 1.1rem; line-height: 1; padding: 0 0.3rem; }
.save-bar {
  position: fixed;
  left: 0; right: 0;
  bottom: calc(var(--nav-height) + env(safe-area-inset-bottom));
  padding: 0.75rem 1rem;
  background: linear-gradient(to top, var(--bg) 70%, transparent);
  display: flex;
  justify-content: center;
}
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
