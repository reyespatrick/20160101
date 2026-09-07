<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FilterBar from '../components/FilterBar.vue'
import PropertyCard from '../components/PropertyCard.vue'
import { usePropertiesStore } from '../stores/properties'

const store = usePropertiesStore()
const sentinel = ref(null)
let observer

onMounted(() => {
  if (!store.items.length) store.load()
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) store.loadMore()
    },
    { rootMargin: '400px' },
  )
})

// The sentinel is re-created whenever the list re-renders (loading toggles),
// so follow the current element instead of observing once on mount.
watch(sentinel, (el, prev) => {
  if (prev) observer?.unobserve(prev)
  if (el) observer?.observe(el)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="container">
    <FilterBar :filters="store.filters" :types="store.types" @update="store.setFilters" />

    <p v-if="store.fromCache" class="alert alert-info">Sin conexión con Inmovilla. Mostrando el último listado guardado.</p>
    <p v-else-if="store.error" class="alert" role="alert">{{ store.error }}</p>

    <div v-if="store.loading" class="spinner" aria-label="Cargando"></div>

    <template v-else>
      <p class="count muted">
        <template v-if="store.total">{{ store.total.toLocaleString('es-ES') }} propiedades</template>
        <template v-else>No hay propiedades que coincidan</template>
      </p>
      <div class="grid">
        <PropertyCard v-for="p in store.items" :key="p.cod_ofer" :property="p" />
      </div>
      <div ref="sentinel" class="sentinel">
        <div v-if="store.loadingMore" class="spinner"></div>
        <button v-else-if="store.hasMore && !store.fromCache" class="btn btn-ghost" type="button" @click="store.loadMore()">Cargar más</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.count { margin: 0 0 0.75rem; font-size: 0.9rem; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.sentinel { display: flex; justify-content: center; padding: 1.5rem 0 2rem; min-height: 60px; }
</style>
