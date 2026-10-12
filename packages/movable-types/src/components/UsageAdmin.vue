<script setup>
import { computed, onMounted, ref } from 'vue'
import { products } from '#content'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'

const W = computed(() => us('analytics').usage?.page || {})
const state = ref('loading')
const fault = ref('')
const retrying = ref(false)
const report = ref({ usage: [], inference: [], unresolved: [] })
const offers = computed(() => products || [])
const safeReportsExist = computed(() => report.value.unresolved.some((item) => item.status === 'pending'))

const money = (micros, currency = 'usd') => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: String(currency || 'usd').toUpperCase(), maximumFractionDigits: 4,
}).format(Number(micros || 0) / 1_000_000)
const offerFor = (key) => offers.value.find((offer) => offer.key === key) || null
const titleFor = (key) => offerFor(key)?.title || key
const customerRate = (row) => {
  const offer = offerFor(row.offer_key)
  if (!offer?.usage) return null
  if (offer.usage.meter) return Math.round(Number(offer.usage.overagePrice) * 1_000_000) || null
  const grant = Number(offer.usage.grant)
  const price = Number(offer.price)
  if (!grant || !price || String(offer.currency || 'usd').toLowerCase() !== 'usd') return null
  return Math.round(price * 1_000_000 / grant)
}
const belowCost = (row) => {
  const offer = offerFor(row.offer_key)
  const billedRate = customerRate(row)
  return String(offer?.currency || 'usd').toLowerCase() === 'usd' &&
    billedRate != null && Number(row.measured_rate_micros) > billedRate
}

async function load() {
  state.value = 'loading'
  fault.value = ''
  const { data, error } = await supabase.rpc('admin_usage', { p_days: 30 })
  if (error) {
    state.value = 'error'
    fault.value = error.message
    return
  }
  report.value = data || { usage: [], unresolved: [] }
  state.value = 'ready'
}

async function retryReports() {
  if (retrying.value) return
  retrying.value = true
  fault.value = ''
  try {
    const { error } = await supabase.functions.invoke('usage-meter-report', { body: {} })
    if (error) throw new Error(error.message)
    await load()
  } catch (error) {
    fault.value = String(error?.message || error)
  } finally {
    retrying.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="usg-admin" :aria-label="W.title">
    <header class="usg-head">
      <div>
        <h2>{{ W.title }}</h2>
        <p>{{ W.subtitle }}</p>
      </div>
      <button type="button" class="usg-button" :disabled="state === 'loading'" @click="load">
        {{ W.refresh }}
      </button>
    </header>

    <p v-if="state === 'loading'" class="usg-state" role="status">{{ W.loading }}</p>
    <p v-else-if="state === 'error'" class="usg-state usg-error" role="alert">{{ W.error }} {{ fault }}</p>
    <template v-else>
      <section class="usg-card">
        <h3>{{ W['recent-heading'] }}</h3>
        <p v-if="!report.usage.length" class="usg-state">{{ W['no-usage'] }}</p>
        <div v-else class="usg-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ W.offer }}</th><th>{{ W.unit }}</th><th>{{ W.events }}</th>
                <th>{{ W['provider-cost'] }}</th><th>{{ W['measured-unit-cost'] }}</th>
                <th>{{ W['customer-unit-price'] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.usage" :key="[row.offer_key, row.usage_unit, row.rate_micros].join(':')">
                <th scope="row">{{ titleFor(row.offer_key) }}</th>
                <td :data-label="W.unit">{{ row.usage_unit || W.unknown }}</td>
                <td :data-label="W.events">{{ row.events }}</td>
                <td :data-label="W['provider-cost']">{{ money(row.cost_micros) }}</td>
                <td :data-label="W['measured-unit-cost']">{{ money(row.measured_rate_micros) }}</td>
                <td :data-label="W['customer-unit-price']">
                  <span v-if="customerRate(row) != null">{{ money(customerRate(row)) }}</span>
                  <span v-else>{{ W.unknown }}</span>
                  <strong v-if="belowCost(row)" class="usg-warning">{{ W['below-cost'] }}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="usg-card">
        <h3>{{ W['inference-heading'] }}</h3>
        <p>{{ W['inference-copy'] }}</p>
        <p v-if="!(report.inference || []).length" class="usg-state">{{ W['no-inference'] }}</p>
        <div v-else class="usg-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ W.operation }}</th><th>{{ W.events }}</th>
                <th>{{ W['provider-cost'] }}</th><th>{{ W.markup }}</th>
                <th>{{ W['customer-cost'] }}</th><th>{{ W['customer-units'] }}</th>
                <th>{{ W['retail-value'] }}</th><th>{{ W.measurement }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.inference" :key="[row.operation_id, row.provider_id, row.model, row.sponsor, row.offer_key, row.markup_micros, row.retail_currency].join(':')">
                <th scope="row">
                  {{ row.operation_id }}
                  <small>{{ row.provider_id }} · {{ row.model }}</small>
                  <small>{{ W[row.sponsor] || row.sponsor }} · {{ row.offer_key ? titleFor(row.offer_key) : W['no-offer'] }}</small>
                </th>
                <td :data-label="W.events">{{ row.attempts }}</td>
                <td :data-label="W['provider-cost']">{{ money(row.provider_cost_micros) }}</td>
                <td :data-label="W.markup">{{ row.markup_micros == null ? W['not-applicable'] : `${Number(row.markup_micros) / 1_000_000}×` }}</td>
                <td :data-label="W['customer-cost']">{{ money(row.customer_cost_micros) }}</td>
                <td :data-label="W['customer-units']">{{ Number(row.customer_units_micros || 0) / 1_000_000 }}</td>
                <td :data-label="W['retail-value']">{{ row.retail_currency ? money(row.retail_value_micros, row.retail_currency) : W['not-applicable'] }}</td>
                <td :data-label="W.measurement">
                  <span v-if="row.estimated_attempts">{{ W.estimated }} · {{ row.estimated_attempts }}</span>
                  <span v-else>{{ W.measured }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="usg-card">
        <header class="usg-report-head">
          <div>
            <h3>{{ W['unresolved-heading'] }}</h3>
            <p>{{ W['unresolved-copy'] }}</p>
          </div>
          <button v-if="safeReportsExist" type="button" class="usg-button"
                  :disabled="retrying" @click="retryReports">
            {{ retrying ? W.retrying : W['retry-safe'] }}
          </button>
        </header>
        <p v-if="!report.unresolved.length" class="usg-state">{{ W['no-unresolved'] }}</p>
        <ul v-else class="usg-reports">
          <li v-for="item in report.unresolved" :key="item.usage_event_id">
            <code>{{ item.identifier }}</code>
            <span>{{ item.event_name }} · {{ money(item.value_micros) }}</span>
            <span>{{ W[item.status] || item.status }}</span>
            <time :datetime="item.created_at">{{ new Date(item.created_at).toLocaleString() }}</time>
            <p v-if="item.last_error">{{ item.last_error }}</p>
          </li>
        </ul>
        <p v-if="fault" class="usg-state usg-error" role="alert">{{ fault }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.usg-admin { display: grid; gap: 1rem; color: var(--ink); }
.usg-head, .usg-report-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.usg-head h2, .usg-card h3 { margin: 0; }
.usg-head p, .usg-report-head p { margin: .35rem 0 0; color: var(--ink3); }
.usg-card { min-width: 0; padding: 1rem; border: 1px solid var(--hair); border-radius: 1rem; background: var(--paper); }
.usg-card h3 { margin-bottom: .8rem; }
.usg-button { border: 1px solid var(--hair); border-radius: 999px; padding: .55rem .9rem; color: var(--ink); background: var(--paper); cursor: pointer; }
.usg-button:disabled { opacity: .55; cursor: wait; }
.usg-state { color: var(--ink3); }
.usg-error, .usg-warning { color: var(--accent); }
.usg-table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; }
th, td { padding: .65rem .55rem; border-bottom: 1px solid var(--hair); vertical-align: top; white-space: nowrap; }
td { font-variant-numeric: tabular-nums; }
tbody th small { display: block; margin-top: .2rem; color: var(--ink3); font-size: .82em; font-weight: 400; white-space: normal; }
.usg-warning { display: block; margin-top: .25rem; font-size: .82em; }
.usg-reports { display: grid; gap: .6rem; margin: 0; padding: 0; list-style: none; }
.usg-reports li { display: grid; grid-template-columns: minmax(10rem, 1fr) auto auto auto; gap: .4rem .8rem; padding: .7rem 0; border-top: 1px solid var(--hair); }
.usg-reports p { grid-column: 1 / -1; margin: 0; color: var(--ink3); overflow-wrap: anywhere; }
@media (max-width: 700px) {
  .usg-head, .usg-report-head { flex-direction: column; }
  .usg-table-wrap { overflow: visible; }
  table, tbody, tbody tr { display: block; width: 100%; }
  thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  tbody tr { padding: .4rem 0; border-bottom: 1px solid var(--hair); }
  tbody th, tbody td { display: block; padding: .5rem .35rem; border: 0; white-space: normal; }
  tbody th { font-weight: 600; }
  tbody td::before { display: block; margin-bottom: .2rem; color: var(--ink3); font-size: .75em; }
  tbody td[data-label]::before { content: attr(data-label); }
  .usg-reports li { grid-template-columns: 1fr auto; }
  .usg-reports code, .usg-reports p { grid-column: 1 / -1; }
}
</style>
