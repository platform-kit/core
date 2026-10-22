<script setup>
/*
 * Emails: every one the site sends — the store's three, the chat's, the two Supabase Auth
 * sends (their link is Supabase's own token, left intact), and the frame every funnel step and
 * blast is piped through — each a design built here in Templatical's drag-and-drop editor
 * (blocks, rich text with the merge tags, a section repeated per line or shown on a
 * condition), kept as content/emails/<kind>.json with its subject a line of
 * content/app/ui/emails.md. The rail on the left is the list; the page is one design. A save
 * writes both and compiles the designs beside the functions (build/emails.mjs); a test
 * compiles the design as it is (mjml in the browser) and the send-email function fills it with
 * the sample and sends it to the signed-in admin. Everything goes through the content pipe (the emails model: a save writes the design and the subject and compiles).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { supabase, configured as supabaseOn } from 'platformkit/lib/supabase.js'
import { isSignedIn, session } from 'platformkit/lib/auth.js'
import { TAGS, PAIRS, SAMPLES, KINDS, GOTRUE } from 'platformkit/supabase/functions/_shared/emails/tags.js'
import './admin-ui.css'

import pipe from '../../lib/admin/api.js'
/* the designs by kind, as the records carry them: { content: the design, subject } */
async function loadEmails() { const out = {}; for (const kind of KINDS) { const r = await pipe.read('emails', kind); out[kind] = { content: r.parsed, subject: r.data.subject || '' } } return out }

/* the rail: each email, what it is and when it goes, in groups */
const GROUPS = [
  ['The store', [['order', 'Order confirmation', 'when a payment lands'], ['shipped', 'Shipped', 'when the parcel leaves the printer'], ['files', 'Files ready', 'with a purchase that carries files']]],
  ['Accounts', [['magic-link', 'Confirm email', 'at sign-up, and a sign-in by link'], ['recovery', 'Password reset', 'from “Forgot your password?”']]],
  ['Coaching', [['chat', 'Chat message', 'when the other side is away']]],
  ['Sessions', [['session-booked', 'Session booked', 'to the reader and the host, with the invitation'], ['session-held', 'Time held', 'to the reader, when the host confirms bookings: the time is theirs until he says'], ['session-to-confirm', 'Waiting on you', 'to the host, when somebody is waiting for their yes'], ['session-declined', 'Declined', 'to the reader, when the host says no: the time is free and nothing is charged'], ['session-moved', 'Session moved', 'to both, the invitation updated'], ['session-cancelled', 'Session cancelled', 'to both, the invitation withdrawn'], ['session-reminder', 'Reminder', 'to the reader, at the hours the sending rules say']]],
  ['Support', [['support', 'Support reply', 'a reply the contact was not there to see'], ['support-digest', 'Waiting on us', 'to the staff, once a thread has waited too long with no one at the desk']]],
  ['Providers', [['provider-terms', 'New terms', 'to every provider on an earlier version, the moment a new one is published']]],
  ['Funnels & blasts', [['campaign', 'Campaign frame', 'every funnel step and blast goes through it']]],
]
const NAMES = Object.fromEntries(GROUPS.flatMap(([, l]) => l.map(([k, name, when]) => [k, { name, when }])))
const NOTE = {
  'magic-link': 'Sent by Supabase Auth. The button must go to its link — the “The link” tag.',
  recovery: 'Sent by Supabase Auth. The button must go to its link — the “The link” tag.',
  campaign: 'The written email — a funnel step, a blast — is dropped in as the HTML block. Keep that block, and the unsubscribe link.',
}
const kind = ref('order')
const emails = ref(null)
const loading = ref(true), saving = ref(false), msg = ref(''), note = ref('')
const subject = ref(''), savedSubject = ref('')
const editorDirty = ref(false)
const dirty = computed(() => editorDirty.value || subject.value !== savedSubject.value)
const me = computed(() => (session.value && session.value.user && session.value.user.email) || '')
const gotrue = computed(() => GOTRUE.includes(kind.value))

/* the site's colours as the designs use them (an email is fixed hex, never a token) */
const INK = '#0c0d0b', INK3 = '#6c6f69', PAPER = '#fbfaf3', HAIR = '#e6e2d6', ACCENT = '#b8402e'

let editor = null, mjml = null
const host = ref(null)
async function compile(content) {
  const { renderToMjml } = await import('@templatical/renderer')
  if (!mjml) mjml = (await import('mjml-browser')).default
  const mj = await renderToMjml(content, { allowHtmlBlocks: true })
  const r = mjml(mj, { validationLevel: 'soft' })
  const bad = (r.errors || []).filter((e) => e && e.level !== 'warning')
  if (bad.length) throw new Error(bad.map((e) => e.formattedMessage || e.message).join('; '))
  return r.html
}
async function mount() {
  await unmount()
  if (!host.value || !emails.value) return
  const { init } = await import('@templatical/editor')
  await import('@templatical/editor/style.css')
  const k = kind.value
  editor = await init({
    container: host.value,
    content: emails.value[k].content || undefined,
    branding: false, smallScreenNotice: false, uiTheme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', changeDebounce: 400,
    onChange() { editorDirty.value = true },
    onDirtyChange(d) { editorDirty.value = d },
    onError(e) { note.value = (e && e.message) || String(e) },
    mergeTags: { syntax: 'handlebars', tags: TAGS[k], autocomplete: true, showRawValue: false },
    displayConditions: { conditions: PAIRS[k], allowCustom: true },
    logicTags: { pairs: PAIRS[k] },
    htmlBlockPreview: true,
    fonts: { defaultFont: 'Georgia', defaultFallback: 'Georgia, Times New Roman, serif' },
    colors: { presets: [INK, INK3, PAPER, HAIR, ACCENT, '#ffffff'], allowCustom: true },
    templateDefaults: { width: 600, backgroundColor: PAPER, textColor: INK, linkColor: INK, fontFamily: 'Georgia' },
    blockDefaults: { button: { backgroundColor: INK, textColor: PAPER, borderRadius: 999, fontSize: 15, align: 'left' }, divider: { color: HAIR, thickness: 1 } },
    render: { compileMjml: async (mj) => { if (!mjml) mjml = (await import('mjml-browser')).default; return mjml(mj, { validationLevel: 'soft' }).html } },
    testEmail: {
      defaultRecipient: me.value,
      async send({ recipient, content }) { await sendTo(recipient, await compile(content)) },
      onSent({ recipient }) { note.value = `Test sent to ${recipient}` },
    },
  })
  editorDirty.value = false
}
async function unmount() { if (editor) { try { editor.unmount() } catch (e) { /* gone */ } editor = null } }
async function sendTo(to, html) {
  if (!supabaseOn || !isSignedIn.value) throw new Error('Sign in as an admin to send a test')
  const { data, error } = await supabase.functions.invoke('send-email', { body: { kind: kind.value, to, html, subject: subject.value } })
  if (error) throw error
  if (data && data.error) throw new Error(data.error)
  if (!data || !data.ok) throw new Error('Not sent — the relay refused it')
}

async function load() {
  loading.value = true; msg.value = ''
  try { emails.value = await loadEmails(); subject.value = emails.value[kind.value].subject; savedSubject.value = subject.value }
  catch (e) { msg.value = e.message }
  finally { loading.value = false }
  await nextTick(); await mount()
}
/* the editor's chrome follows the admin's theme */
let themeWatch = null
onMounted(() => { load(); themeWatch = new MutationObserver(() => { if (editor) editor.setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') }); themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) })
onBeforeUnmount(() => { unmount(); if (themeWatch) themeWatch.disconnect() })
async function pick(k) {
  if (k === kind.value) return
  if (dirty.value && !confirm('Leave this email with unsaved changes?')) return
  kind.value = k
  subject.value = emails.value[k].subject; savedSubject.value = subject.value; msg.value = ''; note.value = ''
  await nextTick(); await mount()
}
async function save() {
  if (!editor || !emails.value) return
  saving.value = true; msg.value = ''
  try {
    const content = editor.getContent()
    await pipe.save('emails', kind.value, { data: { subject: subject.value }, parsed: content })
    emails.value[kind.value] = { content, subject: subject.value }
    savedSubject.value = subject.value; editorDirty.value = false
    msg.value = 'Saved and compiled'
  } catch (e) { msg.value = e.message }
  finally { saving.value = false }
}
async function discard() { if (!emails.value) return; subject.value = savedSubject.value; await mount() }
</script>

<template>
  <div class="em">
    <p v-if="loading" class="ui-muted">Loading…</p>
    <template v-else-if="emails">
      <nav class="em-rail ui-rail" aria-label="Emails">
        <template v-for="[group, list] in GROUPS" :key="group">
          <div class="ui-railhead">{{ group }}</div>
          <button v-for="[k, name, when] in list" :key="k" type="button" class="ui-railitem" :class="{ 'ui-on': kind === k }" @click="pick(k)"><b>{{ name }}</b><small>{{ when }}</small></button>
        </template>
      </nav>
      <div class="em-main">
        <div class="em-head">
          <div class="em-title">
            <h2>{{ NAMES[kind].name }}</h2>
            <p class="ui-help">{{ NAMES[kind].when }}<template v-if="NOTE[kind]"> · {{ NOTE[kind] }}</template><template v-else> · the Test button in the editor sends it to you, filled with the sample.</template></p>
          </div>
          <span class="ui-grow" />
          <span v-if="note" class="ui-muted em-note">{{ note }}</span>
        </div>
        <label class="ui-field em-subject">
          <span>Subject<small v-if="gotrue"> · sent by Supabase Auth with this line</small><small v-else> · a tag in braces is filled in, as in the design</small></span>
          <input v-model="subject" class="ui-input" />
        </label>
        <div ref="host" class="em-editor" />
        <div class="ui-savebar">
          <span class="ui-dirty" :class="{ 'ui-clean': !dirty }">{{ dirty ? 'Unsaved changes' : (msg || 'All changes saved') }}</span>
          <span v-if="dirty && msg" class="ui-err">{{ msg }}</span>
          <span class="ui-grow" />
          <button type="button" class="ui-btn ui-ghost" :disabled="!dirty" @click="discard">Discard</button>
          <button type="button" class="ui-btn ui-primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </template>
    <p v-else class="ui-err">{{ msg }}</p>
  </div>
</template>

<style scoped>
.em { width: 100%; flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 22px; align-items: stretch }
.em-rail { align-self: start; position: sticky; top: 0 }
.em-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0 }
.em-head { display: flex; align-items: center; gap: 14px }
.em-title h2 { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em; margin: 0 0 3px }
.em-note { white-space: nowrap }
.em-subject { max-width: 640px }
.em-editor { flex: 1; min-height: 560px; border: 1px solid var(--hair); border-radius: 14px; overflow: hidden; background: var(--card); box-shadow: 0 1px 2px #0000000a, 0 10px 30px -24px #00000040 }
@media (max-width: 1000px) { .em { grid-template-columns: 1fr } .em-rail { position: static; flex-direction: row; flex-wrap: wrap } }
</style>
