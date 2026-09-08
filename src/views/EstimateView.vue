<script setup>
/**
 * Valuation of a property by Claude: headline value, range, position among the
 * agency's comparables, reasoning. Works for Inmovilla listings (ficha) and for
 * listings created in the app. The last result is kept on the device.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PeerDistributionChart from '../components/charts/PeerDistributionChart.vue'
import ValueRangeChart from '../components/charts/ValueRangeChart.vue'
import { intlLocale } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useEnumsStore } from '../stores/enums'
import { useEstimatesStore } from '../stores/estimates'
import { useLocalPropertiesStore } from '../stores/localProperties'
import { usePropertiesStore } from '../stores/properties'
import { inputFromFicha, inputFromLocal } from '../utils/estimateInput'

const props = defineProps({ source: { type: String, required: true }, id: { type: String, required: true } })
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const estimates = useEstimatesStore()

const input = ref(null)
const loadError = ref('')
const key = computed(() => `${props.source}:${props.id}`)
const result = computed(() => estimates.get(key.value))
const loading = computed(() => estimates.isLoading(key.value))
const error = computed(() => estimates.errorOf(key.value))
const r = computed(() => result.value?.result || null)
const rent = computed(() => Number(input.value?.operation || result.value?.property?.operation) === 2)
const nf = computed(() => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }))
const money = (v) => (v || v === 0 ? `${nf.value.format(v)} €${rent.value ? t('common.perMonth') : ''}` : '—')
const propertyLabel = computed(() => {
  const p = input.value || result.value?.property
  return p ? [p.type, [p.zone, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : ''
})
const asking = computed(() => Number(input.value?.price || result.value?.property?.price) || null)
const diffPct = computed(() => (r.value && asking.value ? Math.round(((asking.value - r.value.estimatedValue) / r.value.estimatedValue) * 100) : null))
const verdictClass = computed(() => ({ underpriced: 'good', fair: 'ok', overpriced: 'warn' })[r.value?.verdict] || 'ok')
const ppm2 = computed(() => result.value?.stats?.propertyPpm2 || null)
const estimatePpm2 = computed(() => {
  const area = Number(input.value?.builtArea || result.value?.property?.builtArea)
  if (!r.value || !area) return { low: null, high: null }
  return { low: Math.round(r.value.rangeLow / area), high: Math.round(r.value.rangeHigh / area) }
})
const formattedAt = computed(() => (result.value?.at ? new Date(result.value.at).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : ''))
const isAnthropicMissing = computed(() => /anthropic/i.test(error.value) && !auth.agency?.hasAnthropic)

function back() {
  if (window.history.length > 1) router.back()
  else router.push(props.source === 'local' ? { name: 'local-property', params: { id: props.id } } : { name: 'property', params: { codOfer: props.id } })
}

async function loadInput() {
  if (props.source === 'local') {
    const store = useLocalPropertiesStore()
    const enums = useEnumsStore()
    await store.ensureLoaded()
    enums.restore()
    const p = store.byId(props.id)
    if (!p) throw new Error(t('common.notFound'))
    return inputFromLocal(p, enums)
  }
  const store = usePropertiesStore()
  const detail = (await store.loadDetail(props.id).catch(() => null)) || store.summaryFor(props.id)
  if (!detail) throw new Error(t('common.notFound'))
  return inputFromFicha(detail)
}

async function run() {
  if (!input.value || loading.value) return
  try {
    await estimates.estimate(input.value)
  } catch {
    /* shown from the store */
  }
}

onMounted(async () => {
  try {
    input.value = await loadInput()
  } catch (err) {
    loadError.value = err.message
    return
  }
  if (!result.value && navigator.onLine) run()
})
</script>

<template>
  <section class="container estimate">
    <header class="head">
      <button class="btn btn-ghost" type="button" @click="back">← {{ t('common.back') }}</button>
      <div class="title">
        <h1>{{ t('estimate.title') }}</h1>
        <p class="muted">{{ input?.ref || result?.property?.ref }} <span v-if="propertyLabel">· {{ propertyLabel }}</span></p>
      </div>
    </header>

    <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
    <p v-else-if="input && !input.price" class="alert">{{ t('estimate.needsPrice') }}</p>

    <template v-else>
      <div v-if="loading" class="working" aria-live="polite">
        <div class="spinner"></div>
        <p>{{ t('estimate.working') }}</p>
        <p class="muted small">{{ t('estimate.workingHint') }}</p>
      </div>

      <div v-else-if="error && !r" class="alert-block">
        <p class="alert" role="alert">{{ error }}</p>
        <RouterLink v-if="isAnthropicMissing && auth.isAdmin" :to="{ name: 'agency-keys' }" class="btn">{{ t('estimate.addKey') }}</RouterLink>
        <p v-else-if="isAnthropicMissing" class="muted">{{ t('estimate.askAdmin') }}</p>
        <button v-else type="button" class="btn" @click="run">{{ t('common.retry') }}</button>
      </div>

      <template v-if="r">
        <p v-if="error" class="alert">{{ error }}</p>

        <article class="hero block">
          <p class="label">{{ t('estimate.estimatedValue') }}</p>
          <p class="value">{{ money(r.estimatedValue) }}</p>
          <p class="range">{{ t('estimate.between', { low: money(r.rangeLow), high: money(r.rangeHigh) }) }}</p>
          <p class="verdict" :class="verdictClass">
            <span class="dot"></span>
            {{ t(`estimate.verdicts.${r.verdict}`) }}<template v-if="diffPct !== null"> · {{ t('estimate.askingDiff', { pct: (diffPct > 0 ? '+' : '') + diffPct }) }}</template>
          </p>
          <p class="confidence muted">{{ t('estimate.confidence') }}: {{ t(`estimate.confidences.${r.confidence}`) }}<template v-if="result.model === 'mock'"> · {{ t('estimate.demo') }}</template></p>
        </article>

        <div class="tiles">
          <div class="tile block">
            <p class="label">{{ t('estimate.asking') }}</p>
            <p class="num">{{ money(asking) }}</p>
          </div>
          <div class="tile block">
            <p class="label">{{ t('estimate.suggested') }}</p>
            <p class="num">{{ money(r.suggestedPrice) }}</p>
          </div>
          <div class="tile block">
            <p class="label">€/m² {{ t('estimate.vsPeers') }}</p>
            <p class="num">{{ ppm2 ? nf.format(ppm2) : '—' }} <span class="muted small">/ {{ result.stats.median ? nf.format(result.stats.median) : '—' }}</span></p>
            <div v-if="result.stats.percentile !== null" class="meter" :title="t('estimate.percentileTitle', { p: result.stats.percentile })">
              <div class="track"><div class="fill" :style="{ width: result.stats.percentile + '%' }"></div></div>
              <p class="small muted">{{ t('estimate.percentile', { p: result.stats.percentile }) }}</p>
            </div>
          </div>
        </div>

        <article class="block">
          <ValueRangeChart :low="r.rangeLow" :high="r.rangeHigh" :value="r.estimatedValue" :asking="asking" :suggested="r.suggestedPrice" :median-value="result.stats.medianValue" :rent="rent" />
        </article>

        <article v-if="result.peers?.length" class="block">
          <PeerDistributionChart :peers="result.peers" :stats="result.stats" :property-ppm2="ppm2" :estimate-low="estimatePpm2.low" :estimate-high="estimatePpm2.high" :rent="rent" />
          <p class="muted small scope">{{ result.scope === 'city' ? t('estimate.scopeCity') : t('estimate.scopeType') }}</p>
        </article>
        <p v-else class="alert alert-info">{{ t('estimate.noPeers') }}</p>

        <article class="block">
          <h2>{{ t('estimate.analysis') }}</h2>
          <p class="summary">{{ r.summary }}</p>
          <div class="cols">
            <div v-if="r.strengths.length">
              <h3>{{ t('estimate.strengths') }}</h3>
              <ul class="plus"><li v-for="s in r.strengths" :key="s">{{ s }}</li></ul>
            </div>
            <div v-if="r.weaknesses.length">
              <h3>{{ t('estimate.weaknesses') }}</h3>
              <ul class="minus"><li v-for="s in r.weaknesses" :key="s">{{ s }}</li></ul>
            </div>
          </div>
          <div v-if="r.adjustments.length" class="adjust">
            <h3>{{ t('estimate.adjustments') }}</h3>
            <table>
              <tbody>
                <tr v-for="a in r.adjustments" :key="a.factor"><td>{{ a.factor }}</td><td class="pct" :class="{ neg: a.impactPct < 0, pos: a.impactPct > 0 }">{{ a.impactPct > 0 ? '+' : '' }}{{ a.impactPct }} %</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <p class="foot muted small">{{ t('estimate.computedAt', { at: formattedAt }) }} · {{ t('estimate.disclaimer') }}</p>
        <button type="button" class="btn btn-ghost recompute" :disabled="loading" @click="run">↻ {{ t('estimate.recompute') }}</button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.estimate { padding-bottom: 5rem; }
.head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
.title h1 { margin: 0; font-size: 1.3rem; }
.title p { margin: 0.1rem 0 0; font-size: 0.85rem; }
.block { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem 1.2rem; margin-bottom: 0.85rem; }
.block h2 { margin: 0 0 0.6rem; font-size: 1.05rem; }
.block h3 { margin: 0.6rem 0 0.3rem; font-size: 0.9rem; color: var(--muted); }
.working { text-align: center; padding: 3rem 1rem; }
.working p { margin: 0.75rem 0 0; font-weight: 600; }
.working .small { font-weight: 400; }
.alert-block { display: flex; flex-direction: column; gap: 0.75rem; align-items: flex-start; }
.hero { text-align: center; padding: 1.4rem 1.2rem; }
.label { margin: 0; font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.value { margin: 0.2rem 0 0; font-size: clamp(2.2rem, 9vw, 3rem); font-weight: 800; color: var(--brand); line-height: 1.1; }
.range { margin: 0.3rem 0 0.6rem; font-size: 1rem; }
.verdict { display: inline-block; margin: 0; font-weight: 700; padding: 0.3rem 0.8rem; border-radius: 999px; background: var(--surface-2); }
.verdict .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--muted); margin-right: 0.4rem; vertical-align: 1px; }
.verdict.good .dot { background: var(--ok); }
.verdict.warn .dot { background: var(--accent); }
.verdict.ok .dot { background: var(--chart-peer); }
.confidence { margin: 0.6rem 0 0; font-size: 0.82rem; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; margin-bottom: 0.85rem; }
.tile { margin: 0; padding: 0.8rem 0.9rem; }
.tile .num { margin: 0.2rem 0 0; font-size: 1.15rem; font-weight: 700; white-space: nowrap; }
.meter { margin-top: 0.4rem; }
.track { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.fill { height: 100%; background: var(--chart-asking); border-radius: 3px; }
.meter p { margin: 0.25rem 0 0; }
.small { font-size: 0.78rem; }
.scope { margin: 0.5rem 0 0; }
.summary { margin: 0; line-height: 1.55; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
.cols ul { margin: 0; padding-left: 1.1rem; line-height: 1.5; font-size: 0.92rem; }
.plus li::marker { color: var(--ok); content: '+ '; }
.minus li::marker { color: var(--danger); content: '− '; }
.adjust table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
.adjust td { padding: 0.3rem 0; border-bottom: 1px solid var(--border); }
.pct { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.pct.neg { color: var(--danger); }
.pct.pos { color: var(--ok); }
.foot { margin: 0.5rem 0 0.75rem; }
.recompute { width: 100%; }
@media (max-width: 560px) {
  .tiles { grid-template-columns: 1fr 1fr; }
  .tile:last-child { grid-column: 1 / -1; }
  .cols { grid-template-columns: 1fr; }
}
</style>
