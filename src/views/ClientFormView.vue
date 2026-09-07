<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { emptyClient, looksLikeEmail, looksLikePhone, validateClient } from '../models/client'
import { useClientsStore } from '../stores/clients'

const props = defineProps({ id: { type: String, default: '' } })
const store = useClientsStore()
const router = useRouter()
const route = useRoute()

const form = reactive(emptyClient())
const errors = ref({})
watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return
    const fresh = validateClient(form)
    errors.value = Object.fromEntries(Object.entries(errors.value).filter(([k]) => k === 'form' || fresh[k]))
  },
  { deep: true },
)
const saving = ref(false)
const notFound = ref(false)
const isEdit = computed(() => Boolean(props.id))
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))

onMounted(async () => {
  if (isEdit.value) {
    const existing = await store.get(props.id)
    if (!existing) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(existing)))
  } else if (typeof route.query.q === 'string') {
    const q = route.query.q.trim()
    if (looksLikePhone(q)) form.mobile = q
    else if (looksLikeEmail(q)) form.email = q
    else form.name = q
  }
})

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
      <p v-if="!online" class="alert alert-info">Sin conexión: se guardará en este dispositivo y se enviará a Inmovilla automáticamente.</p>

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
          <div class="field" :class="{ invalid: errors.mobile }">
            <label for="mobile">Móvil</label>
            <input id="mobile" v-model.trim="form.mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="600 000 000" />
            <small v-if="errors.mobile" class="err">{{ errors.mobile }}</small>
          </div>
          <div class="field" :class="{ invalid: errors.phone }">
            <label for="phone">Teléfono fijo</label>
            <input id="phone" v-model.trim="form.phone" type="tel" inputmode="tel" placeholder="965 000 000" />
            <small v-if="errors.phone" class="err">{{ errors.phone }}</small>
          </div>
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.email }">
            <label for="email">Email</label>
            <input id="email" v-model.trim="form.email" type="email" inputmode="email" autocomplete="email" placeholder="nombre@ejemplo.com" />
            <small v-if="errors.email" class="err">{{ errors.email }}</small>
          </div>
          <div class="field">
            <label for="nif">NIF / DNI</label>
            <input id="nif" v-model.trim="form.nif" autocapitalize="characters" placeholder="12345678A" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Dirección</legend>
        <div class="two">
          <div class="field grow">
            <label for="street">Calle</label>
            <input id="street" v-model.trim="form.street" autocomplete="address-line1" placeholder="Av. de la Libertad" />
          </div>
          <div class="field">
            <label for="number">Número</label>
            <input id="number" v-model.trim="form.number" placeholder="12, 3º B" />
          </div>
        </div>
        <div class="three">
          <div class="field" :class="{ invalid: errors.postalCode }">
            <label for="cp">Código postal</label>
            <input id="cp" v-model.trim="form.postalCode" inputmode="numeric" autocomplete="postal-code" placeholder="03001" />
            <small v-if="errors.postalCode" class="err">{{ errors.postalCode }}</small>
          </div>
          <div class="field">
            <label for="city">Localidad</label>
            <input id="city" v-model.trim="form.city" autocomplete="address-level2" placeholder="Alicante" />
          </div>
          <div class="field">
            <label for="province">Provincia</label>
            <input id="province" v-model.trim="form.province" placeholder="Alicante" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Observaciones</legend>
        <div class="field">
          <textarea v-model="form.notes" rows="4" placeholder="Qué busca, horario de contacto, próximos pasos…"></textarea>
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
fieldset { border: 0; margin: 0; padding: 1rem 1.1rem; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 0.85rem; }
legend { float: left; width: 100%; font-weight: 700; margin-bottom: 0.5rem; padding: 0; }
.two, .three { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 600px) { .two { grid-template-columns: 1fr 1fr; } .two .grow { grid-column: span 1; } .three { grid-template-columns: 1fr 1fr 1fr; } }
.field input, .field textarea { font-size: 1rem; }
.field textarea { border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.85rem; resize: vertical; font: inherit; }
.field textarea:focus { outline: 2px solid var(--brand); border-color: transparent; }
.field.invalid input { border-color: var(--danger); }
.err { color: var(--danger); font-size: 0.8rem; }
.save-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-height) + env(safe-area-inset-bottom)); padding: 0.75rem 1rem; background: linear-gradient(to top, var(--bg) 70%, transparent); display: flex; justify-content: center; }
.save { width: 100%; max-width: 480px; padding: 1rem; font-size: 1.05rem; box-shadow: 0 6px 18px rgba(46, 49, 146, 0.3); }
</style>
