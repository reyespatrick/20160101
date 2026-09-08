<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createUser, deleteUser, listUsers, updateUser } from '../api/accounts'
import { ROLES, useAuthStore } from '../stores/auth'
import { useNotificationsStore } from '../stores/notifications'

const { t, d } = useI18n()
const auth = useAuthStore()
const notifications = useNotificationsStore()
const users = ref([])
const loading = ref(true)
const error = ref('')
const adding = ref(false)
const form = ref({ name: '', email: '', password: '', role: 'agent' })
const busy = ref(null)
const confirmId = ref(null)
const resetId = ref(null)
const resetPassword = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    users.value = (await listUsers()).users
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function add() {
  error.value = ''
  busy.value = 'add'
  try {
    const { user } = await createUser(form.value)
    users.value.push(user)
    form.value = { name: '', email: '', password: '', role: 'agent' }
    adding.value = false
    notifications.notify(t('users.created'), { kind: 'success' })
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = null
  }
}
async function patch(u, data) {
  error.value = ''
  busy.value = u.id
  try {
    const { user } = await updateUser(u.id, data)
    users.value = users.value.map((x) => (x.id === user.id ? user : x))
    notifications.notify(t('users.updated'), { kind: 'success' })
    if (u.id === auth.user?.id) auth.refresh()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = null
  }
}
async function remove(u) {
  error.value = ''
  busy.value = u.id
  try {
    await deleteUser(u.id)
    users.value = users.value.filter((x) => x.id !== u.id)
    confirmId.value = null
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = null
  }
}
async function saveReset(u) {
  await patch(u, { password: resetPassword.value })
  resetId.value = null
  resetPassword.value = ''
}
const fmt = (ts) => (ts ? d(new Date(ts), 'short') : t('users.never'))
</script>

<template>
  <section class="container users">
    <header class="head">
      <RouterLink :to="{ name: 'profile' }" class="btn btn-ghost">← {{ t('profile.title') }}</RouterLink>
      <h1>{{ t('users.title') }}</h1>
      <button type="button" class="btn add" @click="adding = !adding">+ {{ t('users.add') }}</button>
    </header>
    <p class="muted intro">{{ t('users.intro') }}</p>
    <ul class="roles muted">
      <li v-for="r in ROLES" :key="r.value"><strong>{{ t(r.labelKey) }}</strong>: {{ t(`roles.${r.value}Desc`) }}</li>
    </ul>
    <p v-if="error" class="alert">{{ error }}</p>

    <form v-if="adding" class="block form" @submit.prevent="add">
      <div class="two">
        <div class="field"><label for="uname">{{ t('users.name') }}</label><input id="uname" v-model.trim="form.name" autocomplete="off" /></div>
        <div class="field"><label for="uemail">{{ t('users.email') }}</label><input id="uemail" v-model.trim="form.email" type="email" autocomplete="off" required /></div>
      </div>
      <div class="two">
        <div class="field"><label for="upass">{{ t('users.password') }} <small class="muted">({{ t('auth.passwordRule') }})</small></label><input id="upass" v-model="form.password" type="text" autocomplete="off" minlength="8" required /></div>
        <div class="field"><label for="urole">{{ t('users.role') }}</label><select id="urole" v-model="form.role"><option v-for="r in ROLES" :key="r.value" :value="r.value">{{ t(r.labelKey) }}</option></select></div>
      </div>
      <div class="actions">
        <button type="submit" class="btn" :disabled="busy === 'add'">{{ t('common.save') }}</button>
        <button type="button" class="btn btn-ghost" @click="adding = false">{{ t('common.cancel') }}</button>
      </div>
    </form>

    <div v-if="loading" class="spinner"></div>
    <div v-else class="list">
      <article v-for="u in users" :key="u.id" class="block user" :class="{ inactive: !u.active }">
        <div class="top">
          <div>
            <div class="name">{{ u.name || u.email }} <span v-if="u.id === auth.user?.id" class="you">({{ t('users.you') }})</span></div>
            <div class="muted small">{{ u.email }} · {{ t('users.lastLogin') }}: {{ fmt(u.lastLoginAt) }}</div>
          </div>
          <span class="badge" :class="u.active ? 'badge-sale' : 'badge-rent'">{{ u.active ? t('users.active') : t('users.inactive') }}</span>
        </div>
        <div class="controls">
          <select :value="u.role" :disabled="busy === u.id" @change="patch(u, { role: $event.target.value })">
            <option v-for="r in ROLES" :key="r.value" :value="r.value">{{ t(r.labelKey) }}</option>
          </select>
          <button type="button" class="btn btn-ghost small" :disabled="busy === u.id" @click="patch(u, { active: !u.active })">{{ u.active ? t('users.deactivate') : t('users.activate') }}</button>
          <button type="button" class="btn btn-ghost small" @click="resetId = resetId === u.id ? null : u.id">{{ t('users.resetPassword') }}</button>
          <button v-if="u.id !== auth.user?.id" type="button" class="btn btn-ghost small danger" @click="confirmId = u.id">{{ t('users.remove') }}</button>
        </div>
        <form v-if="resetId === u.id" class="reset" @submit.prevent="saveReset(u)">
          <input v-model="resetPassword" type="text" minlength="8" required :placeholder="t('auth.passwordRule')" />
          <button type="submit" class="btn small">{{ t('common.save') }}</button>
        </form>
        <div v-if="confirmId === u.id" class="confirm">
          <span>{{ t('users.confirmRemove', { name: u.name || u.email }) }}</span>
          <button type="button" class="btn danger-fill small" @click="remove(u)">{{ t('common.yes') }}</button>
          <button type="button" class="btn btn-ghost small" @click="confirmId = null">{{ t('common.no') }}</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.users { padding-bottom: 5rem; }
.head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
.head h1 { margin: 0; font-size: 1.35rem; flex: 1; }
.intro { margin: 0 0 0.5rem; }
.roles { font-size: 0.85rem; margin: 0 0 1rem; padding-left: 1.2rem; }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; margin-bottom: 0.75rem; }
.form { display: flex; flex-direction: column; gap: 0.8rem; }
.two { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 600px) { .two { grid-template-columns: 1fr 1fr; } }
.actions { display: flex; gap: 0.5rem; }
.list { display: flex; flex-direction: column; }
.user.inactive { opacity: 0.6; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.6rem; }
.name { font-weight: 700; }
.you { color: var(--muted); font-weight: 400; }
.small { font-size: 0.85rem; }
.controls { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.controls select { border: 1px solid var(--border); border-radius: 8px; padding: 0.4rem 0.6rem; background: var(--surface); color: var(--text); }
.btn.small { padding: 0.4rem 0.7rem; font-size: 0.85rem; }
.danger { color: var(--danger); }
.danger-fill { background: var(--danger); }
.reset { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
.reset input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.7rem; }
.confirm { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.6rem; }
</style>
