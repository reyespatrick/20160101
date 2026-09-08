<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useEnumsStore } from '../stores/enums'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const remember = ref(true)
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const status = await auth.checkStatus()
  if (status?.needsSetup) router.replace({ name: 'setup' })
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login({ email: email.value, password: password.value, remember: remember.value })
    if (auth.hasKeys) useEnumsStore().warm()
    router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : { name: 'properties' })
  } catch (err) {
    error.value = err.status === 401 ? t('auth.bad') : err.message || t('auth.bad')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="login">
    <div class="panel">
      <img class="logo" src="/splash.png" alt="Immoba" />
      <h1>{{ t('auth.login') }}</h1>
      <p class="muted">{{ t('auth.intro') }}</p>
      <p v-if="auth.sessionExpired" class="alert alert-info">{{ t('auth.expired') }}</p>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="email">{{ t('auth.email') }}</label>
          <input id="email" v-model.trim="email" type="email" inputmode="email" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">{{ t('auth.password') }}</label>
          <div class="key-row">
            <input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required />
            <button type="button" class="btn btn-ghost toggle" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? t('common.hide') : t('common.show') }}</button>
          </div>
        </div>
        <label class="remember"><input v-model="remember" type="checkbox" /> {{ t('auth.remember') }}</label>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <button class="btn submit" type="submit" :disabled="loading || !email || !password">{{ loading ? t('auth.checking') : t('auth.enter') }}</button>
      </form>
      <p class="alt"><RouterLink :to="{ name: 'setup' }">{{ t('auth.newAgency') }}</RouterLink></p>
    </div>
  </section>
</template>

<style scoped>
.login { min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem 1rem; background: linear-gradient(160deg, var(--bg) 0%, var(--surface-2) 100%); }
.panel { width: 100%; max-width: 420px; background: var(--surface); border-radius: 20px; box-shadow: var(--shadow); padding: 2rem 1.5rem; }
.logo { display: block; width: 200px; max-width: 100%; margin: 0 auto 0.5rem; border-radius: 12px; }
h1 { margin: 0.5rem 0 0.25rem; font-size: 1.5rem; }
p { margin: 0 0 1.25rem; }
form { display: flex; flex-direction: column; gap: 1rem; }
.key-row { display: flex; gap: 0.5rem; }
.key-row input { flex: 1; min-width: 0; }
.toggle { padding: 0.5rem 0.75rem; white-space: nowrap; }
.remember { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: var(--muted); }
.submit { width: 100%; padding: 0.9rem; font-size: 1rem; }
.alt { margin: 1.25rem 0 0; text-align: center; font-size: 0.9rem; }
.alt a { color: var(--brand); font-weight: 600; }
</style>
