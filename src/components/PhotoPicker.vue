<script setup>
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'
import { isImageFile } from '../utils/image'
const { t } = useI18n()

/**
 * Photo grid with add / remove / reorder / set-as-cover.
 * v-model is the property's photos array [{ id, order, caption }]; blobs are stored by the parent.
 */
const props = defineProps({
  modelValue: { type: Array, required: true },
  urls: { type: Object, required: true }, // photoId -> object URL
  max: { type: Number, default: 30 },
  addFiles: { type: Function, required: true }, // (files: File[]) => Promise<void>
  removePhoto: { type: Function, required: true }, // (photo) => Promise<void>
})
const emit = defineEmits(['update:modelValue'])

const input = ref(null)
const cameraInput = ref(null)
const busy = ref(0)
const error = ref('')

async function onFiles(event) {
  const files = Array.from(event.target.files || []).filter(isImageFile)
  event.target.value = ''
  if (!files.length) return
  const room = props.max - props.modelValue.length
  if (room <= 0) {
    error.value = t('props.photos.max', { max: props.max })
    return
  }
  error.value = ''
  busy.value += 1
  try {
    await props.addFiles(files.slice(0, room))
  } catch (err) {
    error.value = err.message || t('props.photos.add')
  } finally {
    busy.value -= 1
  }
}

function move(index, delta) {
  const list = [...props.modelValue]
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  emit('update:modelValue', list.map((p, i) => ({ ...p, order: i })))
}

function makeCover(index) {
  const list = [...props.modelValue]
  const [photo] = list.splice(index, 1)
  list.unshift(photo)
  emit('update:modelValue', list.map((p, i) => ({ ...p, order: i })))
}

async function remove(index) {
  const photo = props.modelValue[index]
  await props.removePhoto(photo)
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index).map((p, i) => ({ ...p, order: i })),
  )
}
</script>

<template>
  <div class="picker">
    <div class="grid">
      <div v-for="(photo, i) in modelValue" :key="photo.id" class="tile" :class="{ cover: i === 0 }">
        <img v-if="urls[photo.id]" :src="urls[photo.id]" alt="" />
        <div v-else class="placeholder">{{ t('props.photos.loading') }}</div>
        <span v-if="i === 0" class="cover-tag">{{ t('props.photos.cover') }}</span>
        <div class="tools">
          <button type="button" :aria-label="t('props.photos.before')" :disabled="i === 0" @click="move(i, -1)">‹</button>
          <button type="button" :aria-label="t('props.photos.after')" :disabled="i === modelValue.length - 1" @click="move(i, 1)">›</button>
          <button v-if="i !== 0" type="button" :aria-label="t('props.photos.asCover')" @click="makeCover(i)">★</button>
          <button type="button" class="del" :aria-label="t('props.photos.remove')" @click="remove(i)">×</button>
        </div>
      </div>

      <button type="button" class="tile add" :disabled="busy > 0" @click="input.click()">
        <span class="plus">＋</span>
        <span>{{ busy ? t('props.photos.processing') : t('props.photos.gallery') }}</span>
      </button>
      <button type="button" class="tile add camera" :disabled="busy > 0" @click="cameraInput.click()">
        <span class="plus">📷</span>
        <span>{{ t('props.photos.camera') }}</span>
      </button>
    </div>
    <input ref="input" type="file" accept="image/*" multiple hidden @change="onFiles" />
    <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="onFiles" />
    <p class="hint muted">{{ t('props.photos.hint', { n: modelValue.length, max }) }}</p>
    <p v-if="error" class="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.6rem; }
.tile {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  background: var(--photo-bg);
  border: 0;
  padding: 0;
}
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile.cover { outline: 3px solid var(--accent); outline-offset: -3px; }
.placeholder { display: grid; place-items: center; height: 100%; color: var(--muted); font-size: 0.8rem; }
.cover-tag { position: absolute; top: 6px; left: 6px; background: var(--accent); color: #fff; font-size: 0.65rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; text-transform: uppercase; }
.tools { position: absolute; bottom: 0; left: 0; right: 0; display: flex; background: rgba(28, 29, 51, 0.65); }
.tools button { flex: 1; border: 0; background: transparent; color: #fff; font-size: 1.05rem; padding: 0.35rem 0; min-height: 34px; }
.tools button:disabled { opacity: 0.3; }
.tools .del { color: #ffb3ad; font-weight: 800; }
.add {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem;
  border: 2px dashed var(--border); background: var(--surface); color: var(--brand); font-weight: 700; font-size: 0.85rem;
}
.add .plus { font-size: 1.6rem; line-height: 1; }
.add:disabled { opacity: 0.6; }
.camera { color: var(--muted); }
.hint { font-size: 0.8rem; margin: 0.6rem 0 0; }
@media (min-width: 900px) { .camera { display: none; } }
</style>
