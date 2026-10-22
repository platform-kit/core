<script setup>
import { computed } from 'vue'
import { us } from 'platformkit/lib/content.js'
import site from '#site'
import { navigate, ROUTES } from '../../router.js'
import AdminHead from './AdminHead.vue'

const W = computed(() => us('payments').page.main || {})
const settings = site.payments || { provider: 'stripe' }
const provider = settings.provider || 'stripe'
const providerName = computed(() => {
  if (provider === 'hyperswitch') return W.value.hyperswitch
  if (provider === 'stripe') return W.value.stripe
  return provider
})
const capabilities = computed(() => {
  const labels = us('payments').page.capabilities || {}
  return (Array.isArray(settings.profileCapabilities) ? settings.profileCapabilities : [])
    .map((capability) => labels[capability] || capability)
})
const controlCenterUrl = computed(() => {
  if (provider !== 'hyperswitch' || typeof settings.controlCenterUrl !== 'string') return ''
  try {
    const url = new URL(settings.controlCenterUrl)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((!loopback && url.protocol !== 'https:') ||
        (loopback && !['http:', 'https:'].includes(url.protocol)) ||
        url.username || url.password || url.search || url.hash) return ''
    return url.href
  } catch {
    return ''
  }
})
</script>

<template>
  <section class="payments-admin">
    <AdminHead :title="W.title">
      <template #sub>{{ W.subtitle }}</template>
    </AdminHead>

    <article class="payments-admin-card">
      <div class="payments-admin-provider">
        <div>
          <span class="payments-admin-eyebrow">{{ W['selected-provider'] }}</span>
          <h2>{{ providerName }}</h2>
        </div>
      </div>
      <p>{{ W['provider-description'] }}</p>
      <p class="payments-admin-security">{{ W['secrets-note'] }}</p>

      <div v-if="provider === 'hyperswitch'" class="payments-admin-profile">
        <h3>{{ W['profile-capabilities'] }}</h3>
        <p>{{ W['capabilities-note'] }}</p>
        <ul v-if="capabilities.length" class="payments-admin-capabilities">
          <li v-for="capability in capabilities" :key="capability">{{ capability }}</li>
        </ul>
        <p v-else class="payments-admin-muted">{{ W['no-capabilities'] }}</p>
      </div>

      <div v-if="provider === 'hyperswitch'" class="payments-admin-control">
        <a v-if="controlCenterUrl" :href="controlCenterUrl" target="_blank" rel="noopener noreferrer">
          {{ W['open-control-center'] }}
        </a>
        <p v-else>{{ W['control-center-unset'] }}</p>
      </div>

      <aside v-if="provider === 'hyperswitch'" class="payments-admin-limitation">
        <strong>{{ W['payout-limitation-title'] }}</strong>
        <p>{{ W['payout-limitation'] }}</p>
      </aside>

      <div class="payments-admin-links">
        <a :href="ROUTES.admin + '/orders'" @click.prevent="navigate(ROUTES.admin + '/orders')">
          {{ W['view-orders'] }}
        </a>
        <a v-if="provider === 'stripe'" :href="'https://dashboard.stripe.com/'" target="_blank" rel="noopener noreferrer">
          {{ W['open-stripe-dashboard'] }}
        </a>
      </div>
    </article>
  </section>
</template>

<style scoped>
.payments-admin { display: grid; gap: 18px; max-width: 920px }
.payments-admin-card { display: grid; gap: 16px; border: 1px solid var(--hair); border-radius: 14px; padding: clamp(16px, 3vw, 24px); background: var(--paper2, var(--paper)); color: var(--ink) }
.payments-admin-provider { display: flex; align-items: center; justify-content: space-between; gap: 16px }
.payments-admin-provider h2 { margin: 4px 0 0; font-size: 22px }
.payments-admin-eyebrow { color: var(--ink3); font-size: 11px; letter-spacing: .08em; text-transform: uppercase }
.payments-admin-card p { margin: 0; color: var(--ink2); line-height: 1.55 }
.payments-admin-security { border-left: 3px solid var(--accent, var(--ink3)); padding: 8px 12px }
.payments-admin-profile { border-top: 1px solid var(--hair); padding-top: 16px }
.payments-admin-profile h3 { margin: 0 0 6px; font-size: 15px }
.payments-admin-capabilities { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 14px 0 0; list-style: none }
.payments-admin-capabilities li { border: 1px solid var(--hair); border-radius: 99px; padding: 5px 10px; color: var(--ink2); font-size: 12px }
.payments-admin-muted { margin-top: 12px !important; color: var(--ink3) !important }
.payments-admin-control { padding-top: 4px }
.payments-admin-control a, .payments-admin-links a { color: var(--accent, var(--ink)); text-underline-offset: 3px; font-weight: 600 }
.payments-admin-limitation { border: 1px solid var(--hair); border-radius: 10px; padding: 14px; background: color-mix(in srgb, var(--ink) 3%, transparent) }
.payments-admin-limitation strong { display: block; margin-bottom: 5px; font-size: 13px }
.payments-admin-links { display: flex; flex-wrap: wrap; gap: 18px; border-top: 1px solid var(--hair); padding-top: 16px }
@media (max-width: 560px) { .payments-admin-provider { align-items: flex-start; flex-direction: column } }
</style>
