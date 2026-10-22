<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { authSettled, isSignedIn } from 'platformkit/lib/auth.js'
import { navigate, ROUTES } from 'platformkit/lib/router.js'
import { us } from 'platformkit/lib/content.js'
import { setHead } from 'platformkit/lib/seo.js'
import { products } from '#content'
import { hasPublishedMeteredUsagePlan } from '../lib/usage-eligibility.js'
import SiteLayout from '../layouts/SiteLayout.vue'
import UsagePanel from '../components/UsagePanel.vue'
import SignInPage from './SignInPage.vue'

const W = computed(() => ((us('usage').page || {}).main || {}))
const signInCopy = computed(() => ({
  eyebrow: W.value['billing-signin-eyebrow'],
  title: W.value['billing-signin-title'],
  description: W.value['billing-signin-description'],
}))
setHead({ title: W.value['billing-title'], description: '', path: ROUTES.billing, noindex: true })
const state = ref('auth-loading')
const authenticated = computed(() => authSettled.value && isSignedIn.value)
const activeTab = ref('membership')
const tabMenuOpen = ref(false)
const usageRelevant = computed(() => hasPublishedMeteredUsagePlan(products))
const busy = ref(false)
const fault = ref('')
const notice = ref('')
const subscription = ref(null)
const hasPaymentMethod = ref(false)
const usagePanel = ref(null)
let loadGeneration = 0

const periodEnd = computed(() => {
  const value = subscription.value?.current_period_end
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : ''
})
const plan = computed(() => {
  const key = subscription.value?.key
  const sku = subscription.value?.sku
  return products.find((offer) => offer.key === key || offer.sku === sku)?.title || sku || key || ''
})
const statusLabel = computed(() => W.value[`billing-status-${subscription.value?.status}`] || subscription.value?.status || '')
const statusTone = computed(() => ['active', 'trialing'].includes(subscription.value?.status)
  ? 'active'
  : subscription.value?.status === 'past_due' ? 'attention' : 'neutral')
const usesProviderPortal = computed(() => subscription.value?.provider !== 'hyperswitch')
const activeTabLabel = computed(() => activeTab.value === 'usage'
  ? W.value['billing-usage-tab']
  : W.value['billing-membership-tab'])

async function request(action) {
  const { data, error } = await supabase.functions.invoke('create-portal-session', { body: { action } })
  if (error) {
    let message = error.message || ''
    try { message = (await error.context?.clone?.json())?.error || message } catch {}
    throw new Error(message || W.value['billing-error'])
  }
  if (data?.error) throw new Error(data.error)
  return data
}

async function load() {
  fault.value = ''
  if (!authSettled.value) {
    loadGeneration++
    subscription.value = null
    hasPaymentMethod.value = false
    activeTab.value = 'membership'
    notice.value = ''
    state.value = 'auth-loading'
    return
  }
  if (!isSignedIn.value) {
    loadGeneration++
    subscription.value = null
    hasPaymentMethod.value = false
    activeTab.value = 'membership'
    notice.value = ''
    state.value = 'signed-out'
    return
  }
  const generation = ++loadGeneration
  state.value = 'loading'
  try {
    const result = await request('read')
    if (generation !== loadGeneration || !authSettled.value || !isSignedIn.value) return
    subscription.value = result.subscription || null
    hasPaymentMethod.value = result.has_payment_method === true
    state.value = subscription.value ? 'ready' : 'empty'
  } catch (error) {
    if (generation !== loadGeneration || !authSettled.value || !isSignedIn.value) return
    console.error('Unable to load membership settings', error)
    fault.value = W.value['billing-load-error']
    state.value = 'error'
  }
}

async function update(action) {
  if (busy.value) return
  busy.value = true
  fault.value = ''
  notice.value = ''
  try {
    const result = await request(action)
    if (typeof result?.url === 'string') {
      window.location.assign(result.url)
      return
    }
    notice.value = W.value['billing-saved']
    await load()
  } catch (error) {
    console.error('Unable to update membership settings', error)
    fault.value = action === 'manage'
      ? (W.value['billing-manage-error'] || W.value['billing-error'])
      : W.value['billing-error']
  } finally {
    busy.value = false
  }
}

function selectTab(tab) {
  if (tab === 'usage' && !usageRelevant.value) return
  const wasUsageActive = activeTab.value === 'usage'
  activeTab.value = tab
  tabMenuOpen.value = false
  if (tab === 'usage' && wasUsageActive) void usagePanel.value?.retryIfFailed()
  const hash = tab === 'usage' ? '#usage' : ''
  const destination = `${window.location.pathname}${window.location.search}${hash}`
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== destination) {
    window.history.pushState(null, '', destination)
  }
}

function syncActiveTab() {
  if (window.location.hash === '#usage' && usageRelevant.value) {
    activeTab.value = 'usage'
  } else {
    activeTab.value = 'membership'
  }
}

function onTabKeydown(event) {
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]
  const currentIndex = tabs.indexOf(event.target)
  if (currentIndex < 0 || tabs.length < 2) return
  let nextIndex
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = tabs.length - 1
  else return
  event.preventDefault()
  tabs[nextIndex].focus()
  selectTab(tabs[nextIndex].dataset.tab)
}

watch([authSettled, isSignedIn], () => { void load() }, { immediate: true })

onMounted(() => {
  window.addEventListener('hashchange', syncActiveTab)
  window.addEventListener('popstate', syncActiveTab)
  window.addEventListener('platformkit:navigate', syncActiveTab)
  syncActiveTab()
})
onBeforeUnmount(() => {
  loadGeneration++
  window.removeEventListener('hashchange', syncActiveTab)
  window.removeEventListener('popstate', syncActiveTab)
  window.removeEventListener('platformkit:navigate', syncActiveTab)
})
</script>

<template>
  <main v-if="!authSettled" class="billing-auth-pending" aria-hidden="true"></main>
  <SignInPage v-else-if="!isSignedIn" :copy="signInCopy" />
  <SiteLayout v-else :current="ROUTES.billing">
    <main class="billing-page lproot lpfull">
      <div class="lpbg"></div>
      <div class="lpblobs"><span class="lpblob lpb1"></span><span class="lpblob lpb2"></span></div>
      <div class="lpgrain"></div>
      <section class="billing-shell">
        <header class="billing-head">
          <h1>{{ W['billing-title'] }}</h1>
        </header>
        <template v-if="usageRelevant">
            <div class="billing-tab-bar" role="tablist" :aria-label="W['billing-tabs-label']" @keydown="onTabKeydown">
              <button
                id="billing-membership-tab"
                class="billing-tab"
                type="button"
                role="tab"
                aria-controls="billing-membership-panel"
                :aria-selected="activeTab === 'membership'"
                :tabindex="activeTab === 'membership' ? 0 : -1"
                data-tab="membership"
                @click="selectTab('membership')"
              >
                {{ W['billing-membership-tab'] }}
              </button>
              <button
                id="billing-usage-tab"
                class="billing-tab"
                type="button"
                role="tab"
                aria-controls="billing-usage-panel"
                :aria-selected="activeTab === 'usage'"
                :tabindex="activeTab === 'usage' ? 0 : -1"
                data-tab="usage"
                @click="selectTab('usage')"
              >
                {{ W['billing-usage-tab'] }}
              </button>
            </div>
            <div class="billing-tab-select">
              <button
                id="billing-tab-select"
                class="billing-tab-select-button"
                type="button"
                :aria-label="W['billing-tabs-label']"
                aria-controls="billing-tab-options"
                :aria-expanded="tabMenuOpen"
                @click="tabMenuOpen = !tabMenuOpen"
              >
                {{ activeTabLabel }}
                <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" :style="{ transform: tabMenuOpen ? 'rotate(180deg)' : '' }">
                  <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
              <div v-if="tabMenuOpen" id="billing-tab-options" class="billing-tab-menu">
                <button
                  class="billing-tab-option"
                  type="button"
                  :aria-pressed="activeTab === 'membership'"
                  @click="selectTab('membership')"
                >
                  {{ W['billing-membership-tab'] }}
                  <svg v-if="activeTab === 'membership'" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true">
                    <path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <button
                  class="billing-tab-option"
                  type="button"
                  :aria-pressed="activeTab === 'usage'"
                  @click="selectTab('usage')"
                >
                  {{ W['billing-usage-tab'] }}
                  <svg v-if="activeTab === 'usage'" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true">
                    <path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </template>
          <section
            id="billing-membership-panel"
            class="billing-panel"
            :role="usageRelevant ? 'tabpanel' : undefined"
            :aria-label="usageRelevant ? W['billing-membership-tab'] : undefined"
            v-show="activeTab === 'membership'"
          >
            <section v-if="state === 'loading'" class="billing-card" role="status">{{ W['billing-loading'] }}</section>
            <section v-else-if="state === 'error'" class="billing-card" role="alert">
              <p>{{ fault || W['billing-load-error'] }}</p>
              <button class="billing-button" type="button" @click="load">{{ W.retry }}</button>
            </section>
            <section v-else-if="state === 'empty'" class="billing-empty" role="status">
              <div class="billing-empty-copy">
                <h2>{{ W['billing-empty-title'] }}</h2>
                <p>{{ W['billing-empty'] }}</p>
              </div>
              <button class="billing-button billing-primary billing-empty-link" type="button" @click="navigate(ROUTES.store)">{{ W['billing-change-plan'] }}</button>
            </section>
            <section v-else class="billing-card">
              <dl class="billing-details">
                <div><dt>{{ W['billing-plan'] }}</dt><dd>{{ plan }}</dd></div>
                <div><dt>{{ W['billing-status'] }}</dt><dd><span class="billing-status-pill" :class="`is-${statusTone}`">{{ statusLabel }}</span></dd></div>
                <div v-if="periodEnd"><dt>{{ W['billing-renews'] }}</dt><dd>{{ periodEnd }}</dd></div>
              </dl>
              <p v-if="subscription.cancel_at_period_end" class="billing-notice">{{ W['billing-cancelled'] }}</p>
              <p v-else-if="hasPaymentMethod" class="billing-muted">{{ W['billing-payment-ready'] }}</p>
              <p v-else class="billing-muted">{{ W['billing-payment-missing'] }}</p>
              <p v-if="notice" class="billing-notice" role="status">{{ notice }}</p>
              <p v-if="fault" class="billing-error" role="alert">{{ fault }}</p>
              <div class="billing-actions">
                <button class="billing-button billing-primary" type="button" :disabled="busy" @click="navigate(ROUTES.store)">
                  {{ W['billing-change-plan'] }}
                </button>
                <button
                  v-if="usesProviderPortal"
                  class="billing-button"
                  type="button"
                  :disabled="busy"
                  @click="update('manage')"
                >
                  {{ W['billing-manage'] }}
                </button>
                <button
                  v-else
                  class="billing-button"
                  type="button"
                  :disabled="busy"
                  @click="update(subscription.cancel_at_period_end ? 'resume' : 'cancel')"
                >
                  {{ subscription.cancel_at_period_end ? W['billing-resume'] : W['billing-cancel'] }}
                </button>
              </div>
            </section>
          </section>
          <div
            v-if="authenticated && usageRelevant"
            id="billing-usage-panel"
            class="billing-panel"
            role="tabpanel"
            :aria-label="W['billing-usage-tab']"
            v-show="activeTab === 'usage' && usageRelevant"
          >
            <UsagePanel ref="usagePanel" :active="activeTab === 'usage'" />
          </div>
      </section>
    </main>
  </SiteLayout>
</template>

<style scoped>
.billing-auth-pending { min-height: 100vh; min-height: 100dvh; background: var(--paper) }
.billing-page { min-height: calc(100vh - var(--headh)); min-height: calc(100dvh - var(--headh)); position: relative; overflow: hidden; color: var(--ink) }
.billing-shell { position: relative; z-index: 1; width: min(100% - 2.5rem, 920px); margin: 0 auto; padding: clamp(3rem, 8vw, 6rem) 0; display: grid; gap: clamp(1rem, 2.5vw, 1.5rem) }
.billing-head { max-width: 42rem; padding: 0; border: 0 }
.billing-head h1 { max-width: none; margin: 0; font-family: var(--fd); font-size: clamp(2.25rem, 4.8vw, 3.25rem); font-weight: 600; line-height: 1.04; letter-spacing: -.035em; text-wrap: balance }
.billing-tab-bar { display: flex; align-items: stretch; justify-content: flex-start; flex-wrap: nowrap; width: 100%; gap: 1.5rem; margin: 0; padding: 0; border-bottom: 1px solid var(--hair); background: none }
.billing-tab { margin-bottom: -1px; padding: 0 0 14px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; color: var(--ink3); background: none; font: inherit; font-size: 15px; font-weight: 400; white-space: nowrap; cursor: pointer }
.billing-tab:hover { color: var(--ink) }
.billing-tab[aria-selected="true"] { border-bottom-color: var(--ink); color: var(--ink); font-weight: 600 }
.billing-tab-select { display: none; position: relative; z-index: 5; margin: 0 }
.billing-tab-select-button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 13px 16px; border: 1px solid var(--hair); border-radius: 12px; color: var(--ink); background: var(--paper); font: inherit; font-size: 16px; font-weight: 700; cursor: pointer }
.billing-tab-select-button svg { color: var(--ink3); transition: transform .15s ease }
.billing-tab-menu { position: absolute; z-index: 40; top: calc(100% + 6px); right: 0; left: 0; padding: 6px; border: 1px solid var(--hair); border-radius: 12px; background: var(--paper); backdrop-filter: blur(14px); box-shadow: 0 18px 40px -14px #0c0d0b55 }
.billing-tab-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 11px 12px; border: 0; border-radius: 8px; color: var(--ink2); background: none; font: inherit; font-size: 15px; text-align: left; cursor: pointer }
.billing-tab-option:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent) }
.billing-tab-option[aria-pressed="true"] { color: var(--ink); font-weight: 700 }
.billing-tab-option svg { flex: none }
.billing-panel { min-width: 0; margin: 0; padding: 0; border: 0; background: none }
.billing-card { display: grid; gap: 18px; width: min(100%, 680px); box-sizing: border-box; border: 1px solid var(--hair); border-radius: 1.1rem; padding: clamp(20px, 5vw, 32px); background: color-mix(in srgb, var(--paper) 88%, transparent); box-shadow: 0 18px 40px -36px color-mix(in srgb, var(--ink) 35%, transparent) }
.billing-card p { margin: 0 }
.billing-card > .billing-button { justify-self: start }
.billing-empty { display: grid; justify-items: start; gap: 14px; width: min(100%, 680px); padding: 0 }
.billing-empty-copy { display: grid; gap: 6px }
.billing-empty-copy h2 { margin: 0; color: var(--ink); font-family: var(--f); font-size: 1.25rem; font-weight: 600; line-height: 1.35; letter-spacing: -.015em }
.billing-empty-copy p { margin: 0; color: var(--ink2); font-size: 1rem; line-height: 1.5 }
.billing-empty-link { justify-self: start; margin-top: 2px }
.billing-empty-link:focus-visible { outline: 2px solid var(--accent2); outline-offset: 4px; border-radius: 2px }
.billing-details { display: grid; gap: 0; margin: 0 }
.billing-details div { display: flex; justify-content: space-between; gap: 18px; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--hair) }
.billing-details div:first-child { border-top: 1px solid var(--hair) }
.billing-details dt { color: var(--ink2) }
.billing-details dd { margin: 0; text-align: right; font-weight: 600 }
.billing-status-pill { display: inline-flex; min-height: 26px; align-items: center; border: 1px solid var(--hair); border-radius: 999px; padding: 0 10px; font-size: .78rem; font-weight: 600 }
.billing-status-pill.is-active { border-color: color-mix(in srgb, var(--accent2) 35%, var(--hair)); color: var(--accent2) }
.billing-status-pill.is-attention { border-color: color-mix(in srgb, var(--danger, #a32222) 35%, var(--hair)); color: var(--danger, #a32222) }
.billing-muted { color: var(--ink2) }
.billing-notice { color: var(--ink2) }
.billing-error { color: var(--danger, #a32222) }
.billing-actions { display: flex; flex-wrap: wrap; gap: 10px }
.billing-button { min-height: 42px; padding: 9px 15px; border: 1px solid var(--hair); border-radius: 999px; color: var(--ink); background: var(--paper); font: inherit; cursor: pointer; transition: transform .14s, box-shadow .14s, background-color .14s }
.billing-primary { color: var(--paper); background: var(--ink); border-color: var(--ink) }
.billing-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 28px -14px color-mix(in srgb, var(--ink) 65%, transparent) }
.billing-button:focus-visible { outline: 2px solid var(--accent2); outline-offset: 3px }
.billing-button:disabled { opacity: .6; cursor: wait }
@media (max-width: 560px) { .billing-tab-bar { gap: .75rem } .billing-tab { font-size: 13.5px } }
@media (max-width: 640px) { .billing-tab-bar { display: none } .billing-tab-select { display: block } }
@media (max-width: 620px) { .billing-shell { width: min(100% - 1.5rem, 920px) } .billing-details div { display: grid; gap: 6px } .billing-details dd { text-align: left } .billing-actions { display: grid } .billing-actions .billing-button { width: 100% } .billing-card > .billing-button { justify-self: stretch; width: 100% } .billing-empty { grid-template-columns: 1fr; gap: 8px; align-items: start } }
</style>
