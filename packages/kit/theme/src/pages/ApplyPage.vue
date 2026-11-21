<script setup lang="ts">
/*
 * AN OFFER'S APPLICATION (openspec: applications-and-intro-calls): /apply/<sku> runs the form the offer's `before.apply`
 * names, for a signed-in reader. When the answers are sent, the `form` function starts the reader's admission and
 * emails them and the reviewers. Where the offer also names an optional call, it is offered last, after the answers
 * are in: the booker for that booking type, and a plain way to decline it. A required call is not offered here; the
 * reader books it once the application is approved (the card and the approval email say so).
 */
import { computed, ref, onMounted, watch } from 'vue'
import { products as PRODUCTS, forms as FORMS, sessions as SESSIONS } from '#content'
import { us } from 'platformkit/lib/content.js'
import { isSignedIn, authSettled, user } from 'platformkit/lib/auth.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { sessionOptions } from 'platformkit/lib/booking.js'
import { admissions, loadAdmissions, gateOf } from 'platformkit/lib/admissions.js'
import { setHead } from 'platformkit/lib/seo.js'
import { ROUTES } from '../router.js'
import SiteLayout from '../layouts/SiteLayout.vue'
import FormRun from '../components/forms/FormRun.vue'
import SessionBooker from '../instrument/ui/results/SessionBooker.vue'

const props = defineProps<{ path?: string }>()
const W = computed(() => ((us('checkout').admission || {}).apply || {}))
const fill = (s: string, v: Record<string, string>) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(x), s || '')
const sku = computed(() => decodeURIComponent(String(props.path || '').split('/')[2] || ''))
const offer = computed<any>(() => (PRODUCTS || []).find((p: any) => p.sku === sku.value) || null)
const gate = computed(() => gateOf(offer.value))
const form = computed<any>(() => (gate.value && gate.value.apply ? (FORMS || []).find((f: any) => f.slug === gate.value!.apply) || null : null))
const callType = computed<any>(() => (gate.value && gate.value.call && !gate.value['call-required'] ? (SESSIONS || []).find((s: any) => s.slug === gate.value!.call && s.published !== false) || null : null))
setHead({ title: offer.value ? offer.value.title : '', description: offer.value ? offer.value.subtitle || '' : '', path: props.path || '', noindex: true })

/* the form's hidden `offer`, from the address, so the function knows which offer this application is for */
onMounted(() => {
  try { const u = new URL(window.location.href); if (sku.value && !u.searchParams.get('offer')) { u.searchParams.set('offer', sku.value); history.replaceState(history.state, '', u.toString()) } } catch { /* no window */ }
})

/* where the reader is: signing in, answering, choosing a call, or done */
const step = ref<'form' | 'call' | 'booked' | 'sent'>('form')
const already = computed(() => !!(offer.value && admissions.value[offer.value.sku]))
watch([authSettled, isSignedIn], () => { if (isSignedIn.value) loadAdmissions() }, { immediate: true })
function signIn() { if ((window as any).DLauth) (window as any).DLauth.open({ intent: 'apply' }) }
async function answered() {
  await loadAdmissions()
  step.value = callType.value ? 'call' : 'sent'
}

/* the optional call: the booker for that type, with the reader's own bookings for its allowance */
const rows = ref<any[]>([])
async function loadBookings() {
  if (!configured || !isSignedIn.value || !user.value) { rows.value = []; return }
  const { data } = await supabase!.from('bookings').select('uid,event,start_at,status,user_id,made_by').eq('user_id', user.value.id)
  rows.value = data || []
}
watch(step, (s) => { if (s === 'call') loadBookings() })
const options = computed(() => (callType.value ? sessionOptions(rows.value as never[]).filter((o: any) => o.slug === callType.value.slug) : []))
async function booked() { await loadAdmissions(); step.value = 'booked' }
</script>

<template>
  <SiteLayout :current="ROUTES.checkout">
    <main class="ap-page lproot lpfull">
      <div class="lpbg"></div>
      <div class="lpgrain"></div>
      <section class="ap-shell">
        <div v-if="!offer || !form" class="ap-note">
          <h1 class="ap-title">{{ W['missing-heading'] }}</h1>
          <p class="ap-lede">{{ W['missing-body'] }}</p>
        </div>
        <template v-else>
          <p class="ap-eyebrow">{{ W.eyebrow }}</p>
          <h1 class="ap-title">{{ offer.title }}</h1>

          <div v-if="!authSettled" class="ap-wait" aria-hidden="true"></div>
          <div v-else-if="!isSignedIn" class="ap-note">
            <h2 class="ap-h2">{{ W['signin-heading'] }}</h2>
            <p class="ap-lede">{{ W['signin-body'] }}</p>
            <button type="button" class="ap-cta" @click="signIn">{{ W['signin-cta'] }}</button>
          </div>

          <div v-else-if="step === 'form' && already" class="ap-note">
            <h2 class="ap-h2">{{ W['already-heading'] }}</h2>
            <p class="ap-lede">{{ W['already-body'] }}</p>
            <a class="ap-back" :href="ROUTES.checkout + '/' + offer.sku">{{ fill(W.back, { offer: offer.title }) }}</a>
          </div>

          <div v-else-if="step === 'form'" class="ap-form"><FormRun :form="form" embed @complete="answered" /></div>

          <div v-else-if="step === 'call'" class="ap-call">
            <h2 class="ap-h2">{{ W['call-heading'] }}</h2>
            <p class="ap-lede">{{ fill(W['call-body'], { minutes: String(callType.duration || 20) }) }}</p>
            <SessionBooker v-if="options.length" :key="callType.slug" :options="options" @booked="booked" />
            <button type="button" class="ap-skip" @click="step = 'sent'">{{ W['call-skip'] }}</button>
          </div>

          <div v-else class="ap-note">
            <h2 class="ap-h2">{{ step === 'booked' ? W['booked-heading'] : W['sent-heading'] }}</h2>
            <p class="ap-lede">{{ step === 'booked' ? W['booked-body'] : W['sent-body'] }}</p>
            <a class="ap-back" :href="ROUTES.checkout + '/' + offer.sku">{{ fill(W.back, { offer: offer.title }) }}</a>
          </div>
        </template>
      </section>
    </main>
  </SiteLayout>
</template>

<style scoped>
.ap-page { min-height: 70vh }
.ap-shell { position: relative; max-width: 880px; margin: 0 auto; padding: 56px 16px 96px }
.ap-eyebrow { margin: 0 0 10px; font-family: var(--mono, ui-monospace, monospace); font-size: .78rem; letter-spacing: .12em; text-transform: uppercase; color: var(--ink2) }
.ap-title { margin: 0 0 28px; font-size: clamp(2rem, 4.4vw, 3rem); line-height: 1.08; color: var(--ink) }
.ap-h2 { margin: 0 0 10px; font-size: 1.35rem; color: var(--ink) }
.ap-lede { margin: 0 0 20px; font-size: 1.08rem; line-height: 1.55; color: var(--ink2) }
.ap-wait { min-height: 240px }
.ap-call, .ap-note { padding: 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--paper) }
/* THE FORM HOLDS ITS SHAPE: one card (the runner's own), the full column wide and one height from the first question to
   the last, so the page does not jump as a short question gives way to a long one; the answers run the column */
.ap-form :deep(.frun) { min-height: min(600px, 74vh); display: flex; flex-direction: column }
.ap-form :deep(.frun .qzstage) { flex: 1; align-items: flex-start; padding: 40px clamp(20px, 5vw, 56px) 24px }
.ap-form :deep(.frun .qzin) { max-width: none }
.ap-form :deep(.ff-in), .ap-form :deep(.ff-choices), .ap-form :deep(.ff-inwrap) { max-width: none }
.ap-form :deep(.fctl) { padding: 12px 20px 16px }
.ap-cta { display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 15.5px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 13px 26px; cursor: pointer }
.ap-skip { display: block; margin: 18px 0 0; padding: 0; font: inherit; font-size: 15px; color: var(--ink2); background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer }
.ap-skip:hover { color: var(--ink) }
.ap-back { display: inline-block; font-size: 15px; color: var(--ink); text-decoration: underline; text-underline-offset: 3px }
@media (max-width: 560px) { .ap-call, .ap-note { padding: 20px } .ap-form :deep(.frun) { min-height: min(560px, 78vh) } .ap-form :deep(.frun .qzstage) { padding: 28px 18px 16px } }
</style>
