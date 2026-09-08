<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { emptyClient, looksLikeEmail, looksLikePhone, validateClient } from '../models/client'
import { useClientsStore } from '../stores/clients'
const { t } = useI18n()

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
    errors.value = { form: err.message || t('common.failed', { where: 'save' }) }
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
      <button type="button" class="btn btn-ghost" @click="cancel">{{ t('common.cancel') }}</button>
      <h1>{{ isEdit ? t('clients.form.editTitle') : t('clients.form.title') }}</h1>
    </header>

    <p v-if="notFound" class="alert">{{ t('common.notFound') }}</p>

    <form v-else id="client-form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="alert alert-info">{{ t('common.offlineForm') }}</p>

      <fieldset>
        <legend>{{ t('clients.form.contact') }}</legend>
        <div class="two">
          <div class="field" :class="{ invalid: errors.name }">
            <label for="name">{{ t('clients.form.name') }} *</label>
            <input id="name" v-model.trim="form.name" autocomplete="given-name" autocapitalize="words" required />
            <small v-if="errors.name" class="err">{{ errors.name }}</small>
          </div>
          <div class="field">
            <label for="surname">{{ t('clients.form.surname') }}</label>
            <input id="surname" v-model.trim="form.surname" autocomplete="family-name" autocapitalize="words" />
          </div>
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.mobile }">
            <label for="mobile">{{ t('clients.form.mobile') }}</label>
            <input id="mobile" v-model.trim="form.mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="600 000 000" />
            <small v-if="errors.mobile" class="err">{{ errors.mobile }}</small>
          </div>
          <div class="field" :class="{ invalid: errors.phone }">
            <label for="phone">{{ t('clients.form.phone') }}</label>
            <input id="phone" v-model.trim="form.phone" type="tel" inputmode="tel" placeholder="965 000 000" />
            <small v-if="errors.phone" class="err">{{ errors.phone }}</small>
          </div>
        </div>
        <div class="two">
          <div class="field" :class="{ invalid: errors.email }">
            <label for="email">{{ t('clients.form.email') }}</label>
            <input id="email" v-model.trim="form.email" type="email" inputmode="email" autocomplete="email" placeholder="nombre@ejemplo.com" />
            <small v-if="errors.email" class="err">{{ errors.email }}</small>
          </div>
          <div class="field">
            <label for="nif">{{ t('clients.form.nif') }}</label>
            <input id="nif" v-model.trim="form.nif" autocapitalize="characters" placeholder="12345678A" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ t('clients.form.address') }}</legend>
        <div class="two">
          <div class="field grow">
            <label for="street">{{ t('clients.form.street') }}</label>
            <input id="street" v-model.trim="form.street" autocomplete="address-line1" />
          </div>
          <div class="field">
            <label for="number">{{ t('clients.form.number') }}</label>
            <input id="number" v-model.trim="form.number" />
          </div>
        </div>
        <div class="three">
          <div class="field" :class="{ invalid: errors.postalCode }">
            <label for="cp">{{ t('clients.form.cp') }}</label>
            <input id="cp" v-model.trim="form.postalCode" inputmode="numeric" autocomplete="postal-code" placeholder="03001" />
            <small v-if="errors.postalCode" class="err">{{ errors.postalCode }}</small>
          </div>
          <div class="field">
            <label for="city">{{ t('clients.form.city') }}</label>
            <input id="city" v-model.trim="form.city" autocomplete="address-level2" />
          </div>
          <div class="field">
            <label for="province">{{ t('clients.form.province') }}</label>
            <input id="province" v-model.trim="form.province" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ t('clients.form.notes') }}</legend>
        <div class="field">
          <textarea v-model="form.notes" rows="4" :placeholder="t('clients.form.notesPh')"></textarea>
        </div>
      </fieldset>

      <p v-if="errors.form" class="alert">{{ errors.form }}</p>
    </form>

    <div v-if="!notFound" class="save-bar">
      <button type="submit" form="client-form" class="btn save" :disabled="saving">
        {{ saving ? t('common.saving') : isEdit ? t('clients.form.saveChanges') : t('clients.form.save') }}
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
