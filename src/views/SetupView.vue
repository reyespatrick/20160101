<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const form = ref({ agencyName: '', name: '', email: '', password: '', signupCode: '' })
const needsCode = ref(false)
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const status = await auth.checkStatus()
  needsCode.value = Boolean(status && !status.signupOpen)
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.signup(form.value)
    router.replace({ name: 'agency-keys', query: { first: '1' } })
  } catch (err) {
    error.value = err.message || t('auth.bad')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="login">
    <div class="panel">
      <img class="logo" src="/splash.png" alt="Immoba" />
      <h1>{{ t('auth.setupTitle') }}</h1>
      <p class="muted">{{ t('auth.setupIntro') }}</p>
      <form @submit.prevent="submit">
        <div class="field"><label for="agency">{{ t('auth.agencyName') }}</label><input id="agency" v-model.trim="form.agencyName" required /></div>
        <div class="field"><label for="name">{{ t('auth.yourName') }}</label><input id="name" v-model.trim="form.name" autocomplete="name" /></div>
        <div class="field"><label for="email">{{ t('auth.email') }}</label><input id="email" v-model.trim="form.email" type="email" autocomplete="username" required /></div>
        <div class="field">
          <label for="password">{{ t('auth.password') }} <small class="muted">({{ t('auth.passwordRule') }})</small></label>
          <input id="password" v-model="form.password" type="password" autocomplete="new-password" minlength="8" required />
        </div>
        <div v-if="needsCode" class="field"><label for="code">{{ t('auth.signupCode') }}</label><input id="code" v-model.trim="form.signupCode" required /></div>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <button class="btn submit" type="submit" :disabled="loading || !form.agencyName || !form.email || form.password.length < 8">{{ loading ? t('common.saving') : t('auth.create') }}</button>
      </form>
      <p class="alt"><RouterLink :to="{ name: 'login' }">{{ t('auth.haveAccount') }}</RouterLink></p>
    </div>
  </section>
</template>

<style scoped>
.login { min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem 1rem; background: linear-gradient(160deg, var(--bg) 0%, var(--surface-2) 100%); }
.panel { width: 100%; max-width: 420px; background: var(--surface); border-radius: 20px; box-shadow: var(--shadow); padding: 2rem 1.5rem; }
.logo { display: block; width: 160px; max-width: 100%; margin: 0 auto 0.5rem; border-radius: 12px; }
h1 { margin: 0.5rem 0 0.25rem; font-size: 1.5rem; }
p { margin: 0 0 1.25rem; }
form { display: flex; flex-direction: column; gap: 1rem; }
.submit { width: 100%; padding: 0.9rem; font-size: 1rem; }
.alt { margin: 1.25rem 0 0; text-align: center; font-size: 0.9rem; }
.alt a { color: var(--brand); font-weight: 600; }
</style>
