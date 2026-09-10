<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useEnumsStore } from '../stores/enums'
import { useNotificationsStore } from '../stores/notifications'
import { usePropertiesStore } from '../stores/properties'
import PickerField from '../components/PickerField.vue'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const notifications = useNotificationsStore()

const LANGUAGES = [
  { value: 1, label: 'Español' },
  { value: 2, label: 'English' },
  { value: 3, label: 'Deutsch' },
  { value: 4, label: 'Français' },
  { value: 5, label: 'Italiano' },
  { value: 6, label: 'Português' },
  { value: 7, label: 'Nederlands' },
  { value: 8, label: 'Русский' },
]
const form = ref({ numagencia: auth.agency?.numagencia || '', apiwebPassword: '', restToken: '', anthropicKey: '', idioma: auth.agency?.idioma || 1 })
const info = ref(null)
const touched = ref({ idioma: false })
/**
 * The two Inmovilla keys are independent — an agency often holds the REST token before
 * Inmovilla issues the web key — so any single field is enough to save.
 */
const somethingToSave = computed(() =>
  Boolean(form.value.numagencia || form.value.apiwebPassword || form.value.restToken || form.value.anthropicKey || touched.value.idioma),
)
const show = ref(false)
const saving = ref(false)
const error = ref('')
const unlocking = ref(false)
const lockError = ref('')

/** The write lock is agency-wide and enforced by the server; the switch only asks it to change. */
async function toggleLock() {
  lockError.value = ''
  unlocking.value = true
  try {
    info.value = { ...info.value, ...(await auth.setReadOnly(!auth.writesLocked)) }
    notifications.notify(auth.writesLocked ? t('lock.nowLocked') : t('lock.nowUnlocked'), { kind: auth.writesLocked ? 'success' : 'info' })
  } catch (err) {
    lockError.value = err.message
  } finally {
    unlocking.value = false
  }
}

onMounted(async () => {
  try {
    info.value = await auth.refreshAgency()
    // The refresh can land after the user has started typing: never overwrite their input.
    if (!form.value.numagencia) form.value.numagencia = info.value.numagencia
    if (!touched.value.idioma) form.value.idioma = info.value.idioma
  } catch {
    /* offline: show what we know */
  }
})

async function submit() {
  error.value = ''
  saving.value = true
  try {
    info.value = await auth.saveAgencyKeys({
      numagencia: form.value.numagencia,
      apiwebPassword: form.value.apiwebPassword || undefined,
      restToken: form.value.restToken || undefined,
      anthropicKey: form.value.anthropicKey || undefined,
      idioma: form.value.idioma,
    })
    form.value.apiwebPassword = ''
    form.value.restToken = ''
    form.value.anthropicKey = ''
    notifications.notify(t('keys.saved'), { kind: 'success' })
    usePropertiesStore().reset()
    useEnumsStore().warm()
    // Without the web key the Inmovilla listing cannot load; send the admin somewhere useful.
    if (route.query.first) router.replace(info.value?.hasApiweb ? { name: 'properties' } : { name: 'clients' })
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="container keys">
    <header class="head">
      <RouterLink :to="{ name: 'profile' }" class="btn btn-ghost">← {{ t('profile.title') }}</RouterLink>
      <h1>{{ t('keys.title') }}</h1>
    </header>
    <p class="muted intro">{{ t('keys.intro') }}</p>
    <p v-if="route.query.first" class="alert alert-info">{{ t('auth.noKeysAdmin') }}</p>

    <section class="block lock" :class="{ on: auth.writesLocked }">
      <div class="lock-head">
        <span class="shield" aria-hidden="true">{{ auth.writesLocked ? '🔒' : '🔓' }}</span>
        <div>
          <!-- The heading names the state the agency is in, not the setting's name: a card
               titled "Read-only mode" above a paragraph saying writing is allowed reads as a
               contradiction, and nobody should have to work out which half is current. -->
          <h2>{{ auth.writesLocked ? t('lock.titleOn') : t('lock.titleOff') }}</h2>
          <p class="muted">{{ auth.writesLocked ? t('lock.onBody') : t('lock.offBody') }}</p>
        </div>
      </div>
      <p v-if="lockError" class="alert">{{ lockError }}</p>
      <button type="button" class="btn" :class="{ 'btn-ghost': !auth.writesLocked }" :disabled="unlocking" @click="toggleLock">
        {{ unlocking ? t('common.saving') : auth.writesLocked ? t('lock.unlock') : t('lock.lock') }}
      </button>
      <p class="muted note">{{ auth.writesLocked ? t('lock.noteOn') : t('lock.noteOff') }}</p>
    </section>

    <form class="block form" @submit.prevent="submit">
      <p v-if="info?.name" class="agency-name">{{ info.name }} <span class="muted">· {{ t('keys.fromInmovilla') }}</span></p>
      <div class="field">
        <label for="num">{{ t('keys.numagencia') }}</label>
        <input id="num" v-model.trim="form.numagencia" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <small class="muted">{{ t('keys.numagenciaHint') }}</small>
      </div>
      <div class="field">
        <label for="apiweb">{{ t('keys.apiweb') }} <span class="state" :class="{ ok: info?.hasApiweb }">{{ info?.hasApiweb ? t('keys.configured') : t('keys.notConfigured') }}</span></label>
        <input id="apiweb" v-model.trim="form.apiwebPassword" :type="show ? 'text' : 'password'" autocomplete="off" :placeholder="info?.hasApiweb ? (info?.tails?.apiweb ? t('keys.keepTail', { tail: info.tails.apiweb }) : t('keys.keep')) : ''" />
      </div>
      <div class="field">
        <label for="rest">{{ t('keys.rest') }} <span class="state" :class="{ ok: info?.hasRest }">{{ info?.hasRest ? t('keys.configured') : t('keys.notConfigured') }}</span></label>
        <input id="rest" v-model.trim="form.restToken" :type="show ? 'text' : 'password'" autocomplete="off" :placeholder="info?.hasRest ? (info?.tails?.rest ? t('keys.keepTail', { tail: info.tails.rest }) : t('keys.keep')) : ''" />
        <small class="muted">{{ t('keys.restHint') }}</small>
      </div>
      <div class="field">
        <label for="anthropic">{{ t('keys.anthropic') }} <span class="state" :class="{ ok: info?.hasAnthropic }">{{ info?.hasAnthropic ? t('keys.configured') : t('keys.notConfigured') }}</span></label>
        <input id="anthropic" v-model.trim="form.anthropicKey" :type="show ? 'text' : 'password'" autocomplete="off" :placeholder="info?.hasAnthropic ? (info?.tails?.anthropic ? t('keys.keepTail', { tail: info.tails.anthropic }) : t('keys.keep')) : 'sk-ant-…'" />
        <small class="muted">{{ t('keys.anthropicHint') }}</small>
      </div>
      <label class="show"><input v-model="show" type="checkbox" /> {{ t('common.show') }}</label>
      <div class="field">
        <label for="lang">{{ t('keys.dataLanguage') }}</label>
        <PickerField
          id="lang"
          :model-value="form.idioma"
          :options="LANGUAGES"
          :title="t('keys.dataLanguage')"
          @update:model-value="form.idioma = Number($event); touched.idioma = true"
        />
      </div>
      <p v-if="error" class="alert">{{ error }}</p>
      <button type="submit" class="btn" :disabled="saving || !somethingToSave">{{ saving ? t('auth.checking') : t('keys.verifyAndSave') }}</button>
    </form>
  </section>
</template>

<style scoped>
.keys { padding-bottom: 5rem; }
.head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.head h1 { margin: 0; font-size: 1.35rem; }
.intro { margin: 0 0 1rem; }
.agency-name { margin: 0 0 0.4rem; font-weight: 700; font-size: 1.05rem; }
.agency-name .muted { font-weight: 400; font-size: 0.8rem; }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; }
.form { display: flex; flex-direction: column; gap: 0.9rem; }
.lock { margin-bottom: 1rem; border-left: 4px solid var(--ok); }
.lock.on { border-left-color: var(--accent); }
.lock-head { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.8rem; }
.lock-head h2 { margin: 0 0 0.2rem; font-size: 1.05rem; }
.lock-head p { margin: 0; font-size: 0.88rem; line-height: 1.45; }
.shield { font-size: 1.5rem; line-height: 1; }
.lock .btn { width: 100%; }
.note { font-size: 0.78rem; margin: 0.6rem 0 0; }
.state { font-size: 0.75rem; font-weight: 700; color: var(--accent); margin-left: 0.4rem; }
.state.ok { color: var(--ok); }
.show { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--muted); }
</style>
