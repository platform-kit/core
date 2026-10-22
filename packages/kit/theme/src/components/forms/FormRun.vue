<script setup>
/*
 * A form, running: the document's model → the runner's screens (one per slide), the answers kept as
 * they come, each slide posted as it goes and the whole closed with `_end`; a return picks up where
 * it left off, from the server. Around the runner: the page progress (when the document shows it),
 * the slide controls (Previous · Next, unless hidden), and the states a form can be in before it
 * starts — closed, already answered, sign in first. Used by the form's own page (/form/<slug>), by a
 * landing page's Form section, and by the embed on another site.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Typeform from '../../instrument/ui/Typeform.vue'
import { formScreens } from 'platformkit/lib/forms/screens.js'
import { context } from 'platformkit/lib/forms/logic.js'
import { grade as gradeOf } from 'platformkit/supabase/functions/_shared/forms/score.js'
import { postSlide, getResponse } from 'platformkit/lib/forms/api.js'
import { embedContext, embedMessenger } from 'platformkit/lib/forms/typeform-embed.js'
import { us } from 'platformkit/lib/strings.js'
import { isSignedIn, authSettled } from 'platformkit/lib/auth.js'
import { capture } from 'platformkit/lib/analytics.js'
import '../../instrument/ui/instrument.css'
import './forms.css'

const props = defineProps({ form: { type: Object, required: true }, embed: { type: Boolean, default: false } })
const emit = defineEmits(['complete'])
const model = computed(() => props.form.model)
const settings = computed(() => model.value.settings || {})
const kit = computed(() => model.value.kit || {})
const F = us('forms')
const W = { ...((F.runner || {}).buttons || {}), ...((F.runner || {}).messages || {}), ...((F.runner || {}).fields || {}), ...(((F.end || {}).state) || {}),
  'end-title': ((F.end || {}).form || {}).title, 'end-subtitle': ((F.end || {}).form || {}).subtitle, 'end-title-page': ((F.end || {}).page || {}).title, 'end-subtitle-page': ((F.end || {}).page || {}).subtitle }

const answers = reactive({})
const runner = ref(null)
const label = ref('')
const progress = ref(0)
const started = ref(false)
const done = ref(false)
/* the state every screen reads: the answers, the data, the words, how to send, and the end's states */
const state = reactive({
  answers, data: model.value.data || {}, words: W, grade: null, already: false, closed: false, signin: false, unpaid: false, wasForm: settings.value.page === 'form-slides',
  autofocusAll: settings.value.autofocus === 'all-slides',
  submit: async (values, screen) => {
    Object.assign(answers, values)
    if (settings.value.page !== 'form-slides') return
    const r = await postSlide(props.form.slug, values, { end: !!screen.last, slide: screen.index })
    if (r && r.completed) finish(r)
  },
  active: null,   /* the screen on stage, for the Next control */
  restart: () => { for (const k of Object.keys(answers)) delete answers[k]; state.grade = null; state.already = false; done.value = false; startAt.value = 0; key.value++ },
})
const ctx = () => context(state.data, answers)
const key = ref(0)
const screens = computed(() => { void key.value; return formScreens(model.value, ctx).map((s) => ({ ...s, state })) })
/* inside Typeform's embed (the page opened at /to/<slug>?typeform-embed=…): its messages to the parent */
const tf = embedMessenger(embedContext())
let ro = null
function finish(r) {
  done.value = true
  if (tf) tf.submit(props.form.slug, r && r.response_id ? r.response_id : '')
  state.grade = Object.keys(kit.value.score || {}).length ? (r && r.score != null ? { score: r.score, total: r.total, passed: r.passed } : gradeOf(kit.value.score, answers, kit.value.pass)) : null
  capture('form_complete', { form: props.form.slug, score: state.grade ? state.grade.score : null })
  /* the response's own id goes with it: a caller that must point at what was answered — a space
     asking a form of somebody at its door — has nothing else to hold on to */
  emit('complete', { answers: { ...answers }, grade: state.grade, response: r && r.response_id ? r.response_id : null })
}
function onAnswer(screen, values) {
  if (!started.value) { started.value = true; capture('form_start', { form: props.form.slug }); if (tf) tf.started() }
  capture('form_slide', { form: props.form.slug, slide: screen.index })
  if (screen.last && settings.value.page !== 'form-slides') finish(null)
  /* a slide that is the last before the end, on a form: the post said completed; redirect if the end says so */
  const end = screens.value[screen.index + 1]
  if (screen.last && end && end.redirect && !props.embed) setTimeout(() => { location.href = end.redirect }, 400)
}
function onComplete() { /* the runner has run past the end slide: nothing beyond it */ }
/* slide controls: the runner's back, and the current screen's submit */
const current = ref(null)
const index = ref(0)
const canBack = computed(() => index.value > 0 && !(current.value && (current.value.disablePrev || current.value.end)))
const showControls = computed(() => settings.value['slide-controls'] !== 'hide' && settings.value.page !== 'single')
const showProgress = computed(() => settings.value['page-progress'] !== 'hide' && settings.value.page !== 'single')
const decorative = computed(() => settings.value['page-progress'] === 'decorative')
function back() { if (runner.value && runner.value.back()) sync() }
function next() { if (state.active && state.active.submit) state.active.submit() }
function sync() { if (!runner.value) return; index.value = runner.value.index(); current.value = shown.value[index.value] || null; if (tf && current.value) tf.screen(current.value.fields && current.value.fields[0] ? current.value.fields[0].name : 'slide-' + index.value) }

/* what this person has answered already: a return picks up on the next slide; a `once` form already finished shows its end */
const ready = ref(false)
/* the offer this form is answered by buying, where it has one */
const sku = ref('')
const paying = ref(false)
const payError = ref('')
async function pay() {
  if (paying.value) return
  paying.value = true; payError.value = ''
  try {
    const { checkout } = await import('platformkit/lib/commerce.js')
    /* back to this very form, so the answer is the next thing they see */
    await checkout([{ sku: sku.value, quantity: 1 }], { return: location.pathname + location.search })
  } catch (e) { payError.value = (e && e.message) || String(e) } finally { paying.value = false }
}
onMounted(async () => {
  try {
    if (settings.value.page === 'form-slides' && kit.value.published !== false) {
      const r = await getResponse(props.form.slug)
      if (r && r.answers) Object.assign(answers, r.answers)
      if (r && r.last_slide != null) lastSlide.value = r.last_slide
      /* WHAT IT COSTS. A paid form says so before the first question rather than after it — and
         a response already open was paid for when it was started, so it is theirs to finish. */
      if (r && r.unpaid) { state.unpaid = true; sku.value = r.sku || kit.value.paid || '' }
      if (r && r.completed && kit.value.once) { state.already = true; done.value = true }
      else if (r && r.answers && Object.keys(r.answers).length) started.value = true
    }
  } catch (e) { if (e && e.code === 'signin') state.signin = true }
  placeStart()
  ready.value = true
  if (tf) {
    const cs = getComputedStyle(document.documentElement)
    tf.theme(cs.getPropertyValue('--paper').trim() || '#fff', cs.getPropertyValue('--ink').trim() || '#000')
    tf.ready()
    const root = document.querySelector('.frun')
    if (root && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => tf.height(Math.max(root.scrollHeight, document.documentElement.scrollHeight))); ro.observe(root); ro.observe(document.documentElement) }
    tf.height(document.documentElement.scrollHeight)
  }
})
onBeforeUnmount(() => { if (ro) ro.disconnect() })
watch([ready, screens], () => { setTimeout(sync, 0) })
watch(authSettled, () => { if (kit.value.respond === 'authenticated' && !isSignedIn.value) state.signin = true; else state.signin = false }, { immediate: true })
watch(isSignedIn, (v) => { if (v) state.signin = false })
function openSignIn() { if (window.DLauth) window.DLauth.open({ intent: 'form' }) }
/* where a return opens: the first slide with an unanswered field (a form already finished, on `once`: its end) — decided once, as the answers land */
const startAt = ref(0)
const lastSlide = ref(null)
function placeStart() {
  const list = screens.value
  if (state.already) { startAt.value = list.length - 1; return }
  /* the slide after the last one posted (the server says which), never the end */
  startAt.value = lastSlide.value == null ? 0 : Math.min(lastSlide.value + 1, list.length - 1)
}
const shown = computed(() => (state.signin || state.unpaid || !ready.value ? [] : screens.value.slice(startAt.value)))
</script>

<template>
  <div class="qz frun" :class="{ 'frun-embed': embed, 'frun-single': settings.page === 'single' }" :dir="settings.dir || null">
    <div v-if="showProgress" class="fprog" :role="decorative ? null : 'progressbar'" :aria-label="decorative ? null : W['page-progress']" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="decorative ? null : (current ? current.progress : 0)">
      <i :style="{ width: (current ? current.progress : 0) + '%' }" />
    </div>
    <div class="qzstage">
      <div class="qzfull">
        <div v-if="kit.published === false" class="qzin fend"><h3 class="qh">{{ W.off }}</h3></div>
        <div v-else-if="state.signin" class="qzin fend">
          <h3 class="qh">{{ W.signin }}</h3>
          <div class="fact"><button type="button" class="qbtn" @click="openSignIn">{{ W['signin-button'] }}</button></div>
        </div>
        <!-- WHAT IT COSTS: said before the first question, never after it -->
        <div v-else-if="state.unpaid" class="qzin fend">
          <h3 class="qh">{{ W.pay }}</h3>
          <p v-if="W['pay-line']" class="qsay">{{ W['pay-line'] }}</p>
          <div class="fact"><button type="button" class="qbtn" :disabled="paying" @click="pay">{{ paying ? W['pay-going'] : W['pay-button'] }}</button></div>
          <p v-if="payError" class="ff-msg" role="alert">{{ payError }}</p>
        </div>
        <Typeform v-else-if="shown.length" ref="runner" :key="key + ':' + startAt" :screens="shown" @answer="onAnswer" @complete="onComplete" @label="(l) => (label = l)" @progress="() => sync()" />
        <div v-else class="qzin fend"><p class="qsay">{{ W.loading }}…</p></div>
      </div>
    </div>
    <div v-if="showControls && ready && !state.signin && !state.unpaid && kit.published !== false && !(current && current.end)" class="fctl">
      <button type="button" class="qzicon" :disabled="!canBack" :aria-label="W.previous" :title="W.previous" @click="back"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg></button>
      <button type="button" class="qzicon" :disabled="!current || current.end" :aria-label="W.next" :title="W.next" @click="next"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></button>
    </div>
  </div>
</template>
