<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClientPicker from '../components/ClientPicker.vue'
import InmovillaState from '../components/InmovillaState.vue'
import PropertyPicker from '../components/PropertyPicker.vue'
import { emptyFollowUp, fromLocalInput, toLocalInput, validateFollowUp } from '../models/followUp'
import { useEnumsStore } from '../stores/enums'
import { useFollowUpsStore } from '../stores/followUps'
import { addToNativeCalendar, googleCalendarUrl } from '../utils/calendar'

const props = defineProps({ id: { type: String, default: '' } })
const store = useFollowUpsStore()
const enums = useEnumsStore()
const router = useRouter()
const route = useRoute()

const form = reactive(emptyFollowUp())
const errors = ref({})
const saving = ref(false)
const notFound = ref(false)
const confirmDiscard = ref(false)
const isEdit = computed(() => Boolean(props.id))
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))

watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return
    const fresh = validateFollowUp(form)
    errors.value = Object.fromEntries(Object.entries(errors.value).filter(([k]) => k === 'form' || fresh[k]))
  },
  { deep: true },
)

const property = computed({
  get: () => ({ codOfer: form.propertyCodOfer, label: form.propertyLabel }),
  set: (v) => {
    form.propertyCodOfer = v.codOfer
    form.propertyLabel = v.label
  },
})
const client = computed({
  get: () => ({ remoteId: form.clientRemoteId, label: form.clientLabel }),
  set: (v) => {
    form.clientRemoteId = v.remoteId
    form.clientLabel = v.label
  },
})
const remindInput = computed({ get: () => toLocalInput(form.remindAt), set: (v) => (form.remindAt = fromLocalInput(v)) })
const doneInput = computed({ get: () => toLocalInput(form.doneAt), set: (v) => (form.doneAt = fromLocalInput(v)) })

onMounted(async () => {
  await store.ensureLoaded()
  enums.restore()
  enums.ensureTiposSeguimiento()
  if (isEdit.value) {
    const existing = await store.get(props.id)
    if (!existing) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(existing)))
    return
  }
  // prefill from query: ?at=<ts> (calendar day), ?codOfer=&propertyLabel= , ?clientId=&clientLabel=
  const q = route.query
  if (q.at) {
    const d = new Date(Number(q.at))
    d.setHours(10, 0, 0, 0)
    form.remindAt = d.getTime()
  }
  if (q.codOfer) {
    form.propertyCodOfer = String(q.codOfer)
    form.propertyLabel = String(q.propertyLabel || '')
  }
  if (q.clientId) {
    form.clientRemoteId = String(q.clientId)
    form.clientLabel = String(q.clientLabel || '')
  }
})

watch(
  () => form.closed,
  (closed) => {
    if (closed && !form.doneAt) form.doneAt = Date.now()
  },
)

function onTypeChange(e) {
  form.typeKey = e.target.value ? Number(e.target.value) : null
  form.typeName = enums.followUpTypeLabel(form.typeKey)
}

async function submit() {
  errors.value = validateFollowUp(form)
  if (Object.keys(errors.value).length) {
    document.querySelector('.field.invalid input, .field.invalid select')?.focus()
    return
  }
  saving.value = true
  try {
    await store.save(JSON.parse(JSON.stringify(form)))
    router.replace({ name: 'followups', query: { saved: '1' } })
  } catch (err) {
    errors.value = { form: err.message || 'No se pudo guardar' }
  } finally {
    saving.value = false
  }
}
async function discard() {
  if (await store.discard(props.id)) router.replace({ name: 'followups' })
}
function cancel() {
  router.back()
}
</script>

<template>
  <section class="container form-view">
    <header class="form-head">
      <button type="button" class="btn btn-ghost" @click="cancel">Cancelar</button>
      <h1>{{ isEdit ? 'Seguimiento' : 'Nuevo seguimiento' }}</h1>
    </header>

    <p v-if="notFound" class="alert">Este seguimiento ya no existe.</p>

    <form v-else id="fu-form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="alert alert-info">Sin conexión: se guardará en este dispositivo y se enviará a Inmovilla automáticamente.</p>
      <p v-if="isEdit" class="state"><InmovillaState :record="form" :sent="Boolean(form.remoteId)" :label="form.remoteId ? `nº ${form.remoteId}` : ''" /></p>
      <p v-if="form.syncError" class="alert">Inmovilla rechazó el seguimiento: {{ form.syncError }}</p>

      <fieldset>
        <legend>Qué y cuándo</legend>
        <div class="field" :class="{ invalid: errors.typeKey }">
          <label for="type">Tipo <small class="muted">(según la agencia; opcional sin conexión)</small></label>
          <select id="type" :value="form.typeKey ?? ''" @change="onTypeChange">
            <option value="">{{ enums.tiposSeguimiento.length ? 'Sin tipo' : enums.loading.tiposSeguimiento ? 'Cargando tipos de la agencia…' : 'Sin tipos (se descargan con conexión)' }}</option>
            <option v-for="t in enums.tiposSeguimiento" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <small v-if="errors.typeKey" class="err">{{ errors.typeKey }}</small>
        </div>
        <div class="field" :class="{ invalid: errors.subject }">
          <label for="subject">Asunto *</label>
          <input id="subject" v-model.trim="form.subject" placeholder="Ej. Llamar para concertar visita" maxlength="160" />
          <small v-if="errors.subject" class="err">{{ errors.subject }}</small>
        </div>
        <div class="field" :class="{ invalid: errors.remindAt }">
          <label for="remind">Fecha y hora del aviso *</label>
          <input id="remind" v-model="remindInput" type="datetime-local" />
          <small v-if="errors.remindAt" class="err">{{ errors.remindAt }}</small>
        </div>
        <div class="field">
          <label for="desc">Descripción</label>
          <textarea id="desc" v-model="form.description" rows="4" placeholder="Detalles, resultado de la llamada, próximos pasos…"></textarea>
        </div>
      </fieldset>

      <fieldset>
        <legend>Vinculado a</legend>
        <div class="field">
          <label>Propiedad</label>
          <PropertyPicker v-model="property" />
        </div>
        <div class="field">
          <label>Cliente</label>
          <ClientPicker v-model="client" />
        </div>
      </fieldset>

      <fieldset v-if="form.remindAt && form.subject">
        <legend>Agenda del teléfono</legend>
        <div class="cal-actions">
          <button type="button" class="btn btn-ghost" @click="addToNativeCalendar(form)">📅 Añadir al calendario</button>
          <a class="btn btn-ghost" :href="googleCalendarUrl(form)" target="_blank" rel="noopener">Google Calendar</a>
        </div>
        <small class="muted">Crea el evento con un recordatorio 15 minutos antes. La app no puede escribir en el calendario sin tu confirmación.</small>
      </fieldset>

      <fieldset>
        <legend>Estado</legend>
        <label class="closed-toggle" :class="{ on: form.closed }">
          <input v-model="form.closed" type="checkbox" />
          <span>{{ form.closed ? 'Cerrado' : 'Abierto · marcar como hecho' }}</span>
        </label>
        <div v-if="form.closed" class="field" :class="{ invalid: errors.doneAt }">
          <label for="done">Cerrado el</label>
          <input id="done" v-model="doneInput" type="datetime-local" />
          <small v-if="errors.doneAt" class="err">{{ errors.doneAt }}</small>
        </div>
      </fieldset>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>

      <div v-if="isEdit && !form.remoteId" class="danger-zone">
        <button v-if="!confirmDiscard" type="button" class="btn btn-ghost danger" @click="confirmDiscard = true">Descartar (aún no enviado)</button>
        <div v-else class="confirm">
          <span>¿Descartar este seguimiento?</span>
          <button type="button" class="btn danger-fill" @click="discard">Sí</button>
          <button type="button" class="btn btn-ghost" @click="confirmDiscard = false">No</button>
        </div>
      </div>
      <p v-else-if="isEdit" class="muted hint">Inmovilla no permite borrar seguimientos; ciérralo si ya no aplica.</p>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="fu-form" class="btn save" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar seguimiento' }}</button>
    </div>
  </section>
</template>

<style scoped>
.form-view { padding-bottom: 6rem; }
@media (min-width: 720px) { .save-bar { position: sticky; bottom: 0; margin-top: 1rem; } }
.form-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.form-head h1 { margin: 0; font-size: 1.35rem; }
form { display: flex; flex-direction: column; gap: 0.9rem; }
.state { margin: 0; }
fieldset { border: 0; margin: 0; padding: 1rem 1.1rem; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 0.85rem; }
legend { float: left; width: 100%; font-weight: 700; margin-bottom: 0.5rem; padding: 0; }
.field input, .field select, .field textarea { font-size: 1rem; }
.field textarea { border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; resize: vertical; font: inherit; }
.field textarea:focus { outline: 2px solid var(--brand); border-color: transparent; }
.field.invalid input, .field.invalid select { border-color: var(--danger); }
.err { color: var(--danger); font-size: 0.8rem; }
.cal-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.closed-toggle { display: flex; align-items: center; gap: 0.6rem; border: 1.5px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; font-weight: 600; cursor: pointer; }
.closed-toggle.on { border-color: #2e7d32; background: #eaf5ea; color: #2e7d32; }
.closed-toggle input { width: 20px; height: 20px; accent-color: #2e7d32; }
.hint { font-size: 0.8rem; text-align: center; }
.danger-zone { display: flex; justify-content: center; }
.danger { color: var(--danger); }
.danger-fill { background: var(--danger); }
.confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; justify-content: center; }
.save-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-height) + env(safe-area-inset-bottom)); padding: 0.75rem 1rem; background: linear-gradient(to top, var(--bg) 70%, transparent); display: flex; justify-content: center; }
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
