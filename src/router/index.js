import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'properties', component: () => import('../views/PropertiesView.vue') },
  { path: '/propiedad/:codOfer', name: 'property', component: () => import('../views/PropertyDetailView.vue'), props: true },
  { path: '/mis-propiedades/nueva', name: 'local-property-new', component: () => import('../views/LocalPropertyFormView.vue') },
  { path: '/mis-propiedades/:id', name: 'local-property', component: () => import('../views/LocalPropertyDetailView.vue'), props: true },
  { path: '/mis-propiedades/:id/editar', name: 'local-property-edit', component: () => import('../views/LocalPropertyFormView.vue'), props: true },
  { path: '/clientes', name: 'clients', component: () => import('../views/ClientsView.vue') },
  { path: '/clientes/nuevo', name: 'client-new', component: () => import('../views/ClientFormView.vue') },
  { path: '/clientes/:id', name: 'client', component: () => import('../views/ClientDetailView.vue'), props: true },
  { path: '/clientes/:id/editar', name: 'client-edit', component: () => import('../views/ClientFormView.vue'), props: true },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved || { top: 0 }
  },
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  auth.restore()
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'properties' }
  return true
})

export default router
