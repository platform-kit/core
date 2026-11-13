<script setup lang="ts">
import type { PropType } from 'vue'
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
import { isSignedIn, authSettled, user } from 'platformkit/lib/auth.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { forms as FORMS } from '#content'
import { capture } from 'platformkit/lib/analytics.js'
import '../../instrument/ui/instrument.css'
import './forms.css'

const props = defineProps({ form: { type: Object as PropType<any>, required: true }, embed: { type: Boolean, default: false }, item: { type: String, default: '' } })
const emit = defineEmits(['complete', 'about'])
const model = computed(() => props.form.model)
const settings = computed(() => model.value.settings || {})
const kit = computed(() => model.value.kit || {})
const F = us('forms')
const W = { ...((F.runner || {}).buttons || {}), ...((F.runner || {}).messages || {}), ...((F.runner || {}).fields || {}), ...(((F.end || {}).state) || {}),
  'end-title': ((F.end || {}).form || {}).title, 'end-subtitle': ((F.end || {}).form || {}).subtitle, 'end-title-page': ((F.end || {}).page || {}).title, 'end-subtitle-page': ((F.end || {}).page || {}).subtitle }

const answers = reactive<any>({})
const runner = ref<any>(null)
const label = ref('')
const progress = ref(0)
const started = ref(false)
const done = ref(false)
/* the state every screen reads: the answers, the data, the words, how to send, and the end's states */
const state = reactive<any>({
  answers, data: model.value.data || {}, words: W, grade: null, already: false, closed: false, signin: false, unpaid: false, wasForm: settings.value.page === 'form-slides',
  autofocusAll: settings.value.autofocus === 'all-slides',
  submit: async (values: any, screen: { last: any; index: any; target?: any }) => {
    Object.assign(answers, values)
    if (settings.value.page !== 'form-slides') return
    /* an earlier form's question, asked here because this one needs its answer: kept as that form's */
    if (screen.target) {
      /* a form about each row answers for the row chosen by now, which may have been chosen a screen ago */
      const t = { form: screen.target.form, item: screen.target.about ? aboutItem.value : screen.target.item }
      await postSlide(t.form, values, { slide: 0, item: t.item }); keepEarlier(t, values); return
    }
    const r = await postSlide(props.form.slug, values, { end: !!screen.last, slide: screen.index, item: aboutItem.value })
    if (r && r.completed) finish(r)
  },
  active: null,   /* the screen on stage, for the Next control */
  restart: () => { for (const k of Object.keys(answers)) delete answers[k]; state.grade = null; state.already = false; done.value = false; startAt.value = 0; key.value++ },
})
const ctx = () => context(state.data, answers)
const key = ref(0)
const screens = computed(() => { void key.value; return [...pre.value, ...formScreens(model.value, ctx)].map((s: any) => ({ ...s, state })) })

/*
 * FOLLOWING UP ON EARLIER ANSWERS (openspec: forms-api). A workbook form names earlier answers (`uses`) and may be
 * about each row of an earlier list in turn (`about`). The reader's own answers to those forms are read here (their
 * own rows, under RLS), put in the context the questions and choices read, and an answer it needs and hasn't got is
 * asked first, in place, and kept as the earlier form's. A form about a row reads a form that is also about rows for
 * the same row.
 */
const uses = computed(() => (kit.value.uses || {}) as Record<string, { form: string; field: string; top: boolean; last?: boolean }>)
const about = computed(() => kit.value.about as { name: string; form: string; field: string } | null)
const follows = computed(() => !!(about.value || Object.keys(uses.value).length))
const modelOf = (slug: string) => { const f = (FORMS || []).find((x: any) => x.slug === slug); return f ? f.model : null }
const isAbout = (slug: string) => { const m = modelOf(slug); return !!(m && m.kit && m.kit.about) }
const rowsOf = (v: any) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x: any) => String(x).trim()).filter(Boolean)
/* store[form][item or ''] = { answers, completed } */
const store = reactive<Record<string, Record<string, { answers: any; completed: boolean }>>>({})
const items = ref<string[]>([])
const aboutItem = ref(props.item || '')
const pre = ref<any[]>([])
const answerAt = (form: string, field: string) => { const s = store[form] || {}; const e = s[isAbout(form) ? aboutItem.value : ''] ; return e ? e.answers[field] : undefined }
function resolve() {
  if (about.value) state.data[about.value.name] = aboutItem.value
  for (const [name, r] of Object.entries(uses.value)) { const v = answerAt(r.form, r.field); const rows = rowsOf(v); state.data[name] = r.top ? rows[0] || '' : r.last ? rows[rows.length - 1] || '' : v }
}
async function loadEarlier() {
  const uid = user.value && user.value.id
  if (!uid || !supabase) return
  const slugs = [...new Set([props.form.slug, ...Object.values(uses.value).map((r) => r.form), ...(about.value ? [about.value.form] : [])])]
  const { data: rs } = await (supabase as any).from('form_responses').select('id, form, item, completed_at, started_at').eq('user_id', uid).in('form', slugs).order('started_at')
  const ids = (rs || []).map((r: any) => r.id)
  const { data: as } = ids.length ? await (supabase as any).from('form_answers').select('response_id, field, value').in('response_id', ids) : { data: [] }
  for (const r of rs || []) {
    const answers: any = {}
    for (const a of as || []) if (a.response_id === r.id) answers[a.field] = a.value
    ;(store[r.form] ||= {})[r.item || ''] = { answers, completed: !!r.completed_at }
  }
}
function aboutRows() { const a = about.value; if (!a) return []; const e = (store[a.form] || {})['']; return rowsOf(e && e.answers[a.field]) }
function settleItem() {
  items.value = aboutRows()
  if (about.value && (!aboutItem.value || !items.value.includes(aboutItem.value))) aboutItem.value = items.value[0] || ''
  resolve()
  emit('about', { items: items.value, item: aboutItem.value, done: items.value.filter((i) => ((store[props.form.slug] || {})[i] || {}).completed) })
}
/* an earlier form's field, with whatever of its own form it offers from asked first where that is missing too */
function blockOf(slug: string, field: string): any {
  const m = modelOf(slug); if (!m) return null
  const walk = (bs: any[]): any => { for (const b of bs || []) { if (b.type === 'field' && b.name === field) return b; const f = b.blocks && walk(b.blocks); if (f) return f } return null }
  for (const s of m.slides || []) { const f = walk(s.blocks); if (f) return f }
  return null
}
/* the copy above an earlier question, such as the line naming the situation it is about, comes with it when every name it
   shows is one this form knows too; copy naming anything else would show a blank */
function copyAbove(slug: string, field: string): any[] {
  const m = modelOf(slug); if (!m) return []
  const known = new Set([...Object.keys(uses.value || {}), ...(about.value ? [about.value.name] : [])])
  const s = (m.slides || []).find((x: any) => (x.blocks || []).some((b: any) => b.type === 'field' && b.name === field))
  return s ? s.blocks.filter((b: any) => b.type === 'markdown' && !b.condition && (b.deps || []).every((d: string) => known.has(d))) : []
}
function missingScreens() {
  const out: any[] = [], seen = new Set<string>()
  const ask = (slug: string, field: string, item: string) => {
    const k = slug + '.' + field + '@' + item
    if (seen.has(k)) return
    seen.add(k)
    const b = blockOf(slug, field); if (!b) return
    const has = ((store[slug] || {})[item] || { answers: {} }).answers
    for (const n of [...(b.params.optionsfrom || []), ...(b.params.choicesfrom || [])]) if (blockOf(slug, n) && !rowsOf(has[n]).length) ask(slug, n, item)
    if (!rowsOf(has[field]).length) out.push({ kind: 'form', id: 'earlier:' + k, index: -1, type: 'body', blocks: [...copyAbove(slug, field), b], fields: [b], isForm: true, post: true, end: false, last: false, first: !out.length, jump: '', progress: 0, align: '', disablePrev: true, button: '', redirect: '', restart: false, submitText: '', target: { form: slug, item, about: isAbout(slug) } })
  }
  if (about.value && !aboutRows().length) ask(about.value.form, about.value.field, '')
  for (const r of Object.values(uses.value)) if (!rowsOf(answerAt(r.form, r.field)).length && !(about.value && r.form === about.value.form && r.field === about.value.field)) ask(r.form, r.field, isAbout(r.form) ? aboutItem.value : '')
  return out
}
/* the earlier form's answer, kept here too, so what follows reads it at once */
function keepEarlier(target: { form: string; item: string }, values: any) {
  const e = ((store[target.form] ||= {})[target.item] ||= { answers: {}, completed: false })
  Object.assign(e.answers, values)
  Object.assign(state.data, values)
  settleItem()
}
/* inside Typeform's embed (the page opened at /to/<slug>?typeform-embed=…): its messages to the parent */
const tf = embedMessenger(embedContext())
let ro: any = null
function finish(r: any) {
  done.value = true
  if (tf) tf.submit(props.form.slug, r && r.response_id ? r.response_id : '')
  state.grade = Object.keys(kit.value.score || {}).length ? (r && r.score != null ? { score: r.score, total: r.total, passed: r.passed } : gradeOf(kit.value.score, answers, kit.value.pass)) : null
  capture('form_complete', { form: props.form.slug, score: state.grade ? state.grade.score : null })
  /* the response's own id goes with it: a caller that must point at what was answered — a space
     asking a form of somebody at its door — has nothing else to hold on to */
  if (about.value) { ((store[props.form.slug] ||= {})[aboutItem.value] ||= { answers: {}, completed: false }).completed = true; settleItem() }
  emit('complete', { answers: { ...answers }, grade: state.grade, response: r && r.response_id ? r.response_id : null, item: aboutItem.value })
}
function onAnswer(screen: { index: number; last: any }, values: any) {
  if (!started.value) { started.value = true; capture('form_start', { form: props.form.slug }); if (tf) tf.started() }
  capture('form_slide', { form: props.form.slug, slide: screen.index })
  if (screen.last && settings.value.page !== 'form-slides') finish(null)
  /* a slide that is the last before the end, on a form: the post said completed; redirect if the end says so */
  const end = screens.value[screen.index + 1]
  if (screen.last && end && end.redirect && !props.embed) setTimeout(() => { location.href = end.redirect }, 400)
}
function onComplete() { /* the runner has run past the end slide: nothing beyond it */ }
/* slide controls: the runner's back, and the current screen's submit */
const current = ref<any>(null)
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
  } catch (e) { payError.value = (e && (e as any).message) || String(e) } finally { paying.value = false }
}
onMounted(async () => {
  try {
    if (follows.value) {
      await loadEarlier()
      settleItem()
      /* the earlier forms' answers by their own names, for what a question offers from them: the current row's only */
      for (const [slug, byItem] of Object.entries(store)) if (slug !== props.form.slug) { const e = byItem[isAbout(slug) ? aboutItem.value : '']; if (e) Object.assign(state.data, e.answers) }
      resolve()
      pre.value = missingScreens()
    }
    if (settings.value.page === 'form-slides' && kit.value.published !== false) {
      const r = await getResponse(props.form.slug, aboutItem.value)
      if (r && r.answers) Object.assign(answers, r.answers)
      if (r && r.last_slide != null) lastSlide.value = r.last_slide
      /* WHAT IT COSTS. A paid form says so before the first question rather than after it — and
         a response already open was paid for when it was started, so it is theirs to finish. */
      if (r && r.unpaid) { state.unpaid = true; sku.value = r.sku || kit.value.paid || '' }
      if (r && r.completed && kit.value.once) { state.already = true; done.value = true }
      else if (r && r.answers && Object.keys(r.answers).length) started.value = true
    }
  } catch (e) { if (e && (e as any).code === 'signin') state.signin = true }
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
function openSignIn() { if ((window as any).DLauth) (window as any).DLauth.open({ intent: 'form' }) }
/* where a return opens: the first slide with an unanswered field (a form already finished, on `once`: its end) — decided once, as the answers land */
const startAt = ref(0)
const lastSlide = ref<any>(null)
function placeStart() {
  const list = screens.value
  if (state.already) { startAt.value = list.length - 1; return }
  /* a workbook form opens at its first question, with everything the reader wrote there to change */
  if (kit.value.workbook) { startAt.value = 0; return }
  if (pre.value.length) { startAt.value = 0; return }
  /* the slide after the last one posted (the server says which), never the end */
  startAt.value = lastSlide.value == null ? 0 : Math.min(pre.value.length + lastSlide.value + 1, list.length - 1)
}
const shown = computed(() => (state.signin || state.unpaid || !ready.value ? [] : screens.value.slice(startAt.value)))
</script>

<template>
  <div class="qz frun" :class="{ 'frun-embed': embed, 'frun-single': settings.page === 'single', 'frun-workbook': kit.workbook }" :dir="settings.dir || null">
    <div v-if="showProgress" class="fprog" :role="decorative ? undefined : 'progressbar'" :aria-label="decorative ? null : W['page-progress']" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="decorative ? null : (current ? current.progress : 0)">
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
