import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/setup', name: 'setup', component: () => import('../views/SetupView.vue'), meta: { public: true } },
  { path: '/perfil', name: 'profile', component: () => import('../views/ProfileView.vue') },
  { path: '/perfil/claves', name: 'agency-keys', component: () => import('../views/AgencyKeysView.vue'), meta: { admin: true } },
  { path: '/perfil/usuarios', name: 'users', component: () => import('../views/UsersView.vue'), meta: { admin: true } },
  { path: '/', name: 'properties', component: () => import('../views/PropertiesView.vue') },
  { path: '/propiedad/:codOfer', name: 'property', component: () => import('../views/PropertyDetailView.vue'), props: true },
  { path: '/valoracion/:source(inmovilla|local)/:id', name: 'estimate', meta: { estimate: true }, component: () => import('../views/EstimateView.vue'), props: true },
  { path: '/mis-propiedades/nueva', name: 'local-property-new', meta: { write: true }, component: () => import('../views/LocalPropertyFormView.vue') },
  { path: '/mis-propiedades/:id', name: 'local-property', component: () => import('../views/LocalPropertyDetailView.vue'), props: true },
  { path: '/mis-propiedades/:id/editar', name: 'local-property-edit', meta: { write: true }, component: () => import('../views/LocalPropertyFormView.vue'), props: true },
  { path: '/agenda', name: 'followups', component: () => import('../views/FollowUpsView.vue') },
  { path: '/agenda/nuevo', name: 'followup-new', meta: { write: true }, component: () => import('../views/FollowUpFormView.vue') },
  { path: '/agenda/:id', name: 'followup-edit', meta: { write: true }, component: () => import('../views/FollowUpFormView.vue'), props: true },
  { path: '/propietario/nuevo', name: 'owner-new', meta: { write: true }, component: () => import('../views/OwnerFormView.vue') },
  { path: '/propietario/:id/editar', name: 'owner-edit', meta: { write: true }, component: () => import('../views/OwnerFormView.vue'), props: true },
  { path: '/clientes', name: 'clients', component: () => import('../views/ClientsView.vue') },
  { path: '/clientes/nuevo', name: 'client-new', meta: { write: true }, component: () => import('../views/ClientFormView.vue') },
  { path: '/clientes/:id', name: 'client', component: () => import('../views/ClientDetailView.vue'), props: true },
  { path: '/clientes/:id/editar', name: 'client-edit', meta: { write: true }, component: () => import('../views/ClientFormView.vue'), props: true },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved || { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.restore()
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if ((to.name === 'login' || to.name === 'setup') && auth.isAuthenticated) return { name: 'properties' }
  if (to.meta.admin && !auth.isAdmin) return { name: 'profile' }
  if (to.meta.write && !auth.canWrite) return { name: 'properties' }
  if (to.meta.estimate && !auth.canEstimate) return { name: 'properties' }
  return true
})

// A failed lazy chunk (typically right after a deployment) must not leave a blank screen
router.onError((err, to) => {
  console.error('[router]', err)
  if (/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk/i.test(String(err?.message))) {
    window.location.assign(to?.fullPath || '/')
  }
})

export default router
