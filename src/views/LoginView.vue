<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LANGUAGES, useAuthStore } from '../stores/auth'
import { useEnumsStore } from '../stores/enums'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const numagencia = ref(auth.numagencia)
const password = ref('')
const restToken = ref('')
const showToken = ref(false)
const idioma = ref(auth.idioma || 1)
const remember = ref(true)
const showKey = ref(false)
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login({ numagencia: numagencia.value, password: password.value, restToken: restToken.value, idioma: idioma.value, remember: remember.value })
    useEnumsStore().warm() // types + cities for the property form (2 enum calls, the minute's allowance)
    router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : { name: 'properties' })
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      error.value =
        err.field === 'rest'
          ? 'Inmovilla rechazó la clave de la API REST. Cópiala de Inmovilla › Configuración › Opciones › Token API Rest.'
          : 'Inmovilla rechazó el número de agencia o la clave web (apiweb).'
    } else error.value = err.message || 'No se pudo iniciar sesión'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="login">
    <div class="panel">
      <img class="logo" src="/splash.png" alt="ALMA" />
      <h1>Acceso</h1>
      <p class="muted">Introduce las credenciales de Inmovilla de tu agencia. Se guardan solo en este dispositivo.</p>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="agency">Número de agencia</label>
          <input id="agency" v-model.trim="numagencia" inputmode="numeric" autocomplete="username" required placeholder="Ej. 1234" />
        </div>
        <div class="field">
          <label for="key">Clave web (apiweb) · para el listado</label>
          <div class="key-row">
            <input id="key" v-model.trim="password" :type="showKey ? 'text' : 'password'" autocomplete="current-password" required placeholder="Contraseña de la API web" />
            <button type="button" class="btn btn-ghost toggle" :aria-pressed="showKey" @click="showKey = !showKey">
              {{ showKey ? 'Ocultar' : 'Ver' }}
            </button>
          </div>
        </div>
        <div class="field">
          <label for="rest">Clave API REST · para crear clientes y propiedades</label>
          <div class="key-row">
            <input id="rest" v-model.trim="restToken" :type="showToken ? 'text' : 'password'" autocomplete="off" required placeholder="Token API Rest de Inmovilla" />
            <button type="button" class="btn btn-ghost toggle" :aria-pressed="showToken" @click="showToken = !showToken">
              {{ showToken ? 'Ocultar' : 'Ver' }}
            </button>
          </div>
          <small class="muted">Inmovilla › Configuración › Opciones › Token API Rest</small>
        </div>
        <div class="field">
          <label for="lang">Idioma de los datos</label>
          <select id="lang" v-model.number="idioma">
            <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
        </div>
        <label class="remember">
          <input v-model="remember" type="checkbox" />
          Recordar en este dispositivo
        </label>

        <p v-if="error" class="alert" role="alert">{{ error }}</p>

        <button class="btn submit" type="submit" :disabled="loading || !numagencia || !password || !restToken">
          <span v-if="loading">Comprobando…</span>
          <span v-else>Entrar</span>
        </button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.login {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 1.5rem 1rem;
  background: linear-gradient(160deg, #f4f5fa 0%, #e6e7f5 100%);
}
.panel {
  width: 100%;
  max-width: 420px;
  background: var(--surface);
  border-radius: 20px;
  box-shadow: var(--shadow);
  padding: 2rem 1.5rem;
}
.logo { display: block; width: 200px; max-width: 100%; margin: 0 auto 0.5rem; }
h1 { margin: 0.5rem 0 0.25rem; font-size: 1.5rem; }
p { margin: 0 0 1.25rem; }
form { display: flex; flex-direction: column; gap: 1rem; }
.key-row { display: flex; gap: 0.5rem; }
.key-row input { flex: 1; min-width: 0; }
.toggle { padding: 0.5rem 0.75rem; white-space: nowrap; }
.remember { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: var(--muted); }
.submit { width: 100%; padding: 0.9rem; font-size: 1rem; }
</style>
