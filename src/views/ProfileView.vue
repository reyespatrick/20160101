<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { updateMe } from '../api/accounts'
import { ROLES, useAuthStore } from '../stores/auth'
import { useClientsStore } from '../stores/clients'
import { useEnumsStore } from '../stores/enums'
import { useFollowUpsStore } from '../stores/followUps'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { useNotificationsStore } from '../stores/notifications'
import { useOwnersStore } from '../stores/owners'
import { LOCALES, THEMES, useSettingsStore } from '../stores/settings'
import { versionDetail } from '../utils/version'

const { t } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()
const notifications = useNotificationsStore()
const router = useRouter()
const clients = useClientsStore()
const localProperties = useLocalPropertiesStore()
const followUps = useFollowUpsStore()
const owners = useOwnersStore()

const name = ref(auth.user?.name || '')
const currentPassword = ref('')
const newPassword = ref('')
const saving = ref(false)
const error = ref('')
const confirming = ref(false)
const pending = () => clients.pendingCount + localProperties.pendingCount + followUps.pendingCount + owners.pendingCount

async function saveAccount() {
  error.value = ''
  saving.value = true
  try {
    const { user } = await updateMe({ name: name.value, currentPassword: currentPassword.value || undefined, newPassword: newPassword.value || undefined })
    auth.user = user
    auth.persist()
    currentPassword.value = ''
    newPassword.value = ''
    notifications.notify(t('profile.saved'), { kind: 'success' })
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}

async function logout() {
  if (pending() && !confirming.value) {
    await Promise.all([clients.sync(), localProperties.sync(), followUps.sync({ pull: false }), owners.sync()])
    if (pending()) {
      confirming.value = true
      return
    }
  }
  await auth.logout()
  clients.reset()
  localProperties.reset()
  followUps.reset()
  owners.reset()
  useEnumsStore().reset()
  router.replace({ name: 'login' })
}
</script>

<template>
  <section class="container profile">
    <header class="head">
      <RouterLink to="/" class="btn btn-ghost">← {{ t('common.back') }}</RouterLink>
      <h1>{{ t('profile.title') }}</h1>
    </header>

    <!-- For an administrator the card is the way in to the agency's keys: it already names the
         agency, so a separate row saying the same thing twice earns nothing. -->
    <component :is="auth.isAdmin ? 'RouterLink' : 'article'" :to="auth.isAdmin ? { name: 'agency-keys' } : undefined" class="block who" :class="{ tappable: auth.isAdmin }">
      <div class="avatar">{{ (auth.user?.name || auth.user?.email || '?').slice(0, 2).toUpperCase() }}</div>
      <div class="identity">
        <div class="name">{{ auth.user?.name || auth.user?.email }}</div>
        <div class="muted">{{ auth.user?.email }} · {{ t(ROLES.find((r) => r.value === auth.role)?.labelKey || 'roles.readonly') }}</div>
        <div class="muted">{{ t('profile.agency') }}: {{ auth.agency?.name }}<span v-if="auth.agency?.numagencia"> · nº {{ auth.agency.numagencia }}</span></div>
        <div v-if="auth.isAdmin" class="keys-state muted">🔑 {{ t('profile.keys') }} · {{ auth.hasKeys ? t('keys.configured') : t('keys.notConfigured') }}</div>
      </div>
      <span v-if="auth.isAdmin" class="chevron muted" aria-hidden="true">›</span>
    </component>

    <article class="block">
      <h2>{{ t('profile.language') }}</h2>
      <div class="segments">
        <button v-for="l in LOCALES" :key="l.value" type="button" :class="{ active: settings.locale === l.value }" @click="settings.setLocale(l.value)">{{ l.label }}</button>
      </div>
      <h2 class="mt">{{ t('profile.theme') }}</h2>
      <div class="segments">
        <button v-for="th in THEMES" :key="th" type="button" :class="{ active: settings.theme === th }" @click="settings.setTheme(th)">{{ t(`profile.${th}`) }}</button>
      </div>
    </article>

    <article v-if="auth.isAdmin" class="block admin">
      <h2>{{ t('profile.adminOnly') }}</h2>
      <RouterLink :to="{ name: 'users' }" class="row"><span>👥 {{ t('profile.users') }}</span><span class="muted">›</span></RouterLink>
    </article>

    <article class="block">
      <h2>{{ t('profile.account') }}</h2>
      <form class="form" @submit.prevent="saveAccount">
        <div class="field"><label for="name">{{ t('profile.name') }}</label><input id="name" v-model.trim="name" autocomplete="name" /></div>
        <div class="two">
          <div class="field"><label for="cur">{{ t('profile.currentPassword') }}</label><input id="cur" v-model="currentPassword" type="password" autocomplete="current-password" /></div>
          <div class="field"><label for="new">{{ t('profile.newPassword') }}</label><input id="new" v-model="newPassword" type="password" autocomplete="new-password" minlength="8" /></div>
        </div>
        <p v-if="error" class="alert">{{ error }}</p>
        <button type="submit" class="btn" :disabled="saving">{{ saving ? t('common.saving') : t('common.save') }}</button>
      </form>
    </article>

    <div class="logout">
      <p v-if="confirming" class="alert">{{ t('common.pendingLogout', { n: pending() }) }}</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost danger" @click="logout">{{ confirming ? t('common.logoutAnyway') : t('profile.logout') }}</button>
        <button v-if="confirming" type="button" class="btn btn-ghost" @click="confirming = false">{{ t('common.stay') }}</button>
      </div>
    </div>

    <!-- Which build this is. An agent reporting something odd reads one line and it names the
         exact code that produced it. -->
    <p class="version muted">{{ t('profile.version', { v: versionDetail(settings.locale) }) }}</p>
  </section>
</template>

<style scoped>
.profile { padding-bottom: 5rem; }
.head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
.head h1 { margin: 0; font-size: 1.35rem; }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; margin-bottom: 0.85rem; }
.block h2 { margin: 0 0 0.6rem; font-size: 0.9rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.mt { margin-top: 1rem !important; }
.who { display: flex; gap: 1rem; align-items: center; }
.who.tappable { color: inherit; text-decoration: none; }
.who .identity { flex: 1; min-width: 0; }
.who .keys-state { margin-top: 0.35rem; font-size: 0.8rem; }
.who .chevron { font-size: 1.4rem; }
.avatar { flex: 0 0 56px; height: 56px; border-radius: 50%; background: var(--brand); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; }
.name { font-weight: 700; font-size: 1.1rem; }
.segments { display: flex; background: var(--surface-2); border-radius: 10px; padding: 3px; }
.segments button { flex: 1; border: 0; background: transparent; border-radius: 8px; padding: 0.55rem; font-weight: 600; color: var(--muted); }
.segments button.active { background: var(--brand); color: #fff; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0.25rem; border-top: 1px solid var(--border); font-weight: 600; }
.row:first-of-type { border-top: 0; }
.form { display: flex; flex-direction: column; gap: 0.8rem; }
.two { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 600px) { .two { grid-template-columns: 1fr 1fr; } }
.version { margin: 1.5rem 0 0; text-align: center; font-size: 0.78rem; }
.logout { margin-top: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
.actions { display: flex; gap: 0.5rem; }
.danger { color: var(--danger); }
</style>
