<script setup>
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import CommentThread from './CommentThread.vue'
import { commentSubject } from '@platform-kit/kit/lib/comments.js'
import { marked } from 'marked'
import { loadDoc, bookShelf, bookCard, coverTint, us } from '@platform-kit/kit/lib/content.js'
import Book3D from '../Book3D.vue'
import { inject } from 'vue'
import { get as stored, set as store } from '@platform-kit/kit/lib/store.js'
import { companionFor, chapterCompanion, insightFor, summaryTime, useCompanion } from '@platform-kit/kit/lib/companions.js'
import { readerBook } from '@platform-kit/kit/lib/gated.js'
import { masteryOf, chapterResult, masteryRev } from '@platform-kit/kit/lib/mastery.js'
/* the words a chapter is read with, and the name its recording has — shared with
   build/tts.mjs, so a recording made here has the name the script would give it */
import { INTRO_KEY, bookChapters, chapterSpeech } from '@platform-kit/kit/lib/speech.js'
import { ttsSupported } from '@platform-kit/kit/lib/tts/support.js'
/* the chapter quiz rides the instrument's runner; it loads only when opened */
const BookQuiz = defineAsyncComponent(() => import('./BookQuiz.vue'))
/* the player loads its waveform library only when a chapter has a file to play */
const BookAudio = defineAsyncComponent(() => import('./BookAudio.vue'))
/* the slot a chapter with no recording shows on a desktop that could make one */
const BookGenerate = defineAsyncComponent(() => import('./BookGenerate.vue'))
import Trophy from '../Trophy.vue'

const R = us('library').reader
const PROG = us('library').progress.label
const TR = us('library').trophy.tier
const TC = us('library').trophy.cover || {}

/* System-authored (baked-in) marks: `==text==` in the book markdown becomes a
 * suggestion — a wavy coloured underline, deliberately NOT a background, so it
 * reads as "this line is worth noticing" without pre-empting the reader's own
 * highlighting. An optional colour tag follows the close: `==text=={ocean}`
 * (sun · leaf · sky · ocean · ember), default sun. It carries no `bk-hl` class,
 * so the highlight menu never treats it as one of the reader's own. */
const SUG_COLORS = ['sun', 'leaf', 'sky', 'ocean', 'ember']
marked.use({
  extensions: [{
    name: 'sysmark',
    level: 'inline',
    start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i },
    tokenizer(src) {
      const m = /^==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/.exec(src)
      if (!m) return
      const color = SUG_COLORS.includes(m[2]) ? m[2] : 'sun'
      return { type: 'sysmark', raw: m[0], color, tokens: this.lexer.inlineTokens(m[1]) }
    },
    renderer(token) {
      return `<mark class="sys-mark sug-${token.color}">${this.parser.parseInline(token.tokens)}</mark>`
    },
  }],
})

/* The same five colours as hex, so the element can be signalled outside the
   reader body (the cover-page teaser colours its quotation mark from these). */
const SUG_HEX = { sun: 'E1A200', leaf: '4CA646', sky: 'EFAE7A', ocean: '1785A0', ember: 'DD802F' }
function sugColor(color) { return '#' + (SUG_HEX[color] || SUG_HEX.sun) }

/*
 * The e-book reader. One markdown file is one book; its `# ` headings are the
 * chapters. Everything a reader keeps — place, bookmarks, highlights with
 * notes, type size, page colour — lives in this browser, per book.
 *
 * Highlights anchor by quote plus a little surrounding context, not by offsets,
 * so they survive edits to other parts of the chapter.
 */
const props = defineProps({ slug: { type: String, required: true } })
/* a buyer's files, asked for once signed in */
const files = ref(null)
onIdentity(async (id) => { files.value = null; if (id) { try { files.value = await filesFor(props.slug) } catch (e) { files.value = [] } } })
import { userClass, hasProduct, CLASSES, isSignedIn, onIdentity, can, entrySubject } from '@platform-kit/kit/lib/auth.js'
import { filesFor } from '@platform-kit/kit/lib/downloads.js'
import { chapterAllowance, requiredForChapter, allowedBy, requiredBy } from '@platform-kit/kit/lib/access.js'
import Gate from '../Gate.vue'
import { contentView } from '@platform-kit/kit/lib/analytics.js'

const meta = computed(() => (preview
  ? (preview.value ? bookCard(preview.value) : { title: '', author: '', cover: null })
  : bookShelf().find((b) => b.slug === props.slug) || { title: props.slug, author: '', cover: null }))
const fm = ref({})            /* the book's own frontmatter */
const chapters = ref([])
const view = ref('cover')     /* every book opens on its title page */
const modal = ref('')         /* '', 'contents', 'search', 'saved', 'type' */
const missing = ref(false)
const ch = ref(0)
/*
 * WHETHER THIS CHAPTER TAKES COMMENTS AT ALL. The button was unconditional, and a site whose policy
 * is `allow: off` — which is the default, so every site until somebody turns it on — showed a
 * Comments control that opened a panel with a header and nothing in it. CommentThread was right to
 * draw nothing; what was wrong was the chrome around it.
 *
 * Asked per chapter, because the policy is per subject: a book may take comments on one chapter and
 * not another, and the control follows the chapter the reader is on rather than the book.
 */
const canSay = ref(false)
const askedSay = new Map()
async function askCanSay() {
  const key = chapterSubject.value
  if (!key) { canSay.value = false; return }
  if (askedSay.has(key)) { canSay.value = askedSay.get(key); return }
  let ok = false
  try { ok = !!(await commentSubject('book-chapter', key)) } catch (e) { ok = false }
  askedSay.set(key, ok)
  /* the reader may have turned the page while this was in flight */
  if (key === chapterSubject.value) canSay.value = ok
  /* and a panel standing open on a chapter that takes none is closed rather than left empty */
  if (!ok && key === chapterSubject.value) saying.value = false
}
/* the chapter's own conversation, open beside the page */
const saying = ref(false)
/* the chapter the comments are about, named once so the button and the panel cannot disagree */
const chapterSubject = computed(() => props.slug + '/chapters/' + (ch.value + 1))
const body = ref(null)
const suggestions = ref([])   /* every baked-in editorial mark: { text, color } */
const teaser = ref([])        /* a randomised handful, one per colour, for the cover */

/* ---- reader preferences + kept things, per book ---- */
/* the admin's live preview provides a draft entry in place of the compiled one;
   its reading state is kept apart from the real book's */
const preview = inject('dl-preview', null)
const KEY = 'dl.book.' + (preview ? '__preview__' : props.slug)
const state = ref({ ch: 0, size: 1, scheme: 'paper', bookmarks: [], highlights: [], mode: 'full' })   /* mode: full | summary */
function saveState() { store(KEY, JSON.stringify(state.value)) }
try { Object.assign(state.value, JSON.parse(stored(KEY) || '{}')) } catch (e) { /* fresh */ }

const SIZES = [15.5, 17.5, 20]
/* Typefaces for the book text only — the chrome keeps the house face. All are
   system stacks except the two the site already ships. */
const FONTS = [
  { k: 'bitter', label: 'Bitter', stack: '"Bitter", Georgia, serif' },
  { k: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { k: 'palatino', label: 'Palatino', stack: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", serif' },
  { k: 'charter', label: 'Charter', stack: 'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif' },
  { k: 'system', label: 'System Sans', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif' },
  { k: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { k: 'mono', label: 'Plex Mono', stack: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace' },
]
const fontStack = computed(() =>
  (FONTS.find((f) => f.k === state.value.font) || FONTS[0]).stack)
function setFont(k) { state.value.font = k; saveState() }

/* ---- the book ---- */
async function load() {
  gatedState.value = ''
  const d = preview
    ? (preview.value ? { data: preview.value, body: preview.value.raw || '' } : null)
    : await loadDoc('books', props.slug)
  if (!d) { missing.value = true; return }
  missing.value = false
  fm.value = d.data || {}
  chapters.value = bookChapters(d.body)
  /* the book's introduction (frontmatter) is its own page, the first one: the same
     words in either mode, never locked ahead of chapter one, keyed for its
     recording by INTRO_KEY rather than its editable label */
  if (fm.value.introduction) chapters.value.unshift({ key: INTRO_KEY, title: R.intro.label, md: String(fm.value.introduction).trim(), intro: true })
  ch.value = Math.min(state.value.ch || 0, chapters.value.length - 1)
  fetchGated()
  prepareSpeech().catch(() => {})

  /* pull every baked-in mark out of the raw markdown for the cover teaser */
  const found = []
  const re = /==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/g
  let mm
  while ((mm = re.exec(d.body))) {
    const color = SUG_COLORS.includes(mm[2]) ? mm[2] : 'sun'
    const text = mm[1].replace(/[_*`]/g, '').replace(/\s+/g, ' ').trim()
    if (text) found.push({ text, color })
  }
  suggestions.value = found
  rollTeaser()

  render()
  if (!preview) contentView({ kind: 'book', id: props.slug, title: fm.value.title, topics: fm.value.topics, tags: fm.value.tags })
}
onMounted(load)
if (preview) watch(preview, load)

/* one random mark of each colour present — re-rolled each time the cover shows,
   so the passages on offer change on every visit. Shown spirit-to-earth. */
const TEASER_ORDER = ['sun', 'ember', 'sky', 'ocean', 'leaf']
function rollTeaser() {
  const byColor = {}
  for (const s of suggestions.value) (byColor[s.color] || (byColor[s.color] = [])).push(s)
  teaser.value = TEASER_ORDER
    .filter((c) => byColor[c])
    .map((c) => { const a = byColor[c]; return a[Math.floor(Math.random() * a.length)] })
}
function teaserText(t) {
  return t.length > 150 ? t.slice(0, 150).replace(/\s+\S*$/, '') + '…' : t
}
watch(view, (v) => { if (v === 'cover') rollTeaser() })

/* about 200 words a minute, and honest rounding */
const words = computed(() => chapters.value.reduce((n, c) => n + c.md.split(/\s+/).length, 0))
const readTime = computed(() => {
  const mins = Math.max(1, Math.round(words.value / 200))
  return mins < 60 ? R.time.about + ' ' + mins + ' ' + (mins === 1 ? R.time.minute : R.time.minutes)
    : R.time.about + ' ' + Math.round(mins / 60 * 10) / 10 + ' ' + R.time.hours
})
const started = computed(() => state.value.ch > 0 || state.value.bookmarks.length > 0 || state.value.highlights.length > 0)
/* ---- the companion: summaries, the insight, the quizzes and the trophy ---- */
const essOpen = ref(false)   /* the bottom line, opened past its first three lines */
const comp = computed(() => (preview ? null : companionFor(props.slug)))
const hasSummary = (i) => !!(comp.value && chapters.value[i] && (chapterCompanion(props.slug, chapters.value[i].title) || {}).summaryMd)
const chapterQuiz = (i) => (comp.value && chapters.value[i] ? (chapterCompanion(props.slug, chapters.value[i].title) || {}).quiz || [] : [])
const insight = computed(() => (preview ? '' : insightFor(props.slug)))
/* one page ahead of the chapters when the book has an introduction */
const introOffset = computed(() => (chapters.value[0] && chapters.value[0].intro ? 1 : 0))
/* the chapters proper, for the cover's count */
const chapterCount = computed(() => chapters.value.length - introOffset.value)
const summaryTimeLabel = computed(() => { const m = summaryTime(props.slug); return m ? R.time.about + ' ' + m + ' ' + (m === 1 ? R.time.minute : R.time.minutes) : '' })
const mastery = computed(() => { void masteryRev.value; return preview ? { done: 0, total: 0, tier: null } : masteryOf(props.slug) })
const quizResult = computed(() => { void masteryRev.value; return chapters.value[ch.value] ? chapterResult(props.slug, chapters.value[ch.value].title) : null })
function setMode(m) { if (state.value.mode !== m) { state.value.mode = m; essOpen.value = false; saveState(); if (view.value === 'read') repaint() } }
const inSummary = computed(() => state.value.mode === 'summary' && !!comp.value)
/* The spoken chapter, if build/tts.mjs made one: the book's `audio` maps a
   chapter title to the file for its text and the file for its summary. The
   player follows the mode — the summary's recording in summary mode, the text's
   otherwise — and a chapter with no file for its mode has no player at all. */
const audio = computed(() => {
  const a = fm.value && fm.value.audio, c = chapters.value[ch.value]
  const key = c && (c.key || c.title)
  if (!a || !c || !a[key]) return null
  /* the introduction reads the same in both modes, so it has one recording */
  const kind = inSummary.value && !c.intro ? 'summary' : 'full'
  const e = a[key][kind]
  return e && e.src ? { src: e.src, seconds: e.seconds || 0, kind: c.intro ? 'intro' : kind, title: c.title } : null
})

/* ---- the chapter read aloud on this machine, when no recording exists ----
   On a desktop that can run the voice (src/lib/tts/support.js), a chapter with
   no recording for its mode gets a Generate slot instead of the player; the
   reader's own words for the page (the same choice render() makes) are hashed
   to the name the build script would give the recording, made in a worker, kept
   in the browser under that name, and played through the ordinary player. */
const canSpeak = ttsSupported()
const speech = shallowRef(null)   /* the lazily loaded module: src/lib/tts/audiobook.js (its own state is reactive) */
const speechHash = ref({})        /* "<key>|<kind>" → hash, for every page in both modes */
/* what one page is read with, in one mode: mirrors render() */
function jobFor(i, summary) {
  const c = chapters.value[i]
  if (!c) return null
  const cc = summary && !c.intro ? chapterCompanion(props.slug, c.title) : null
  const kind = cc && cc.summaryMd ? 'summary' : 'full'
  return { index: i, key: c.key || c.title, kind, title: c.title, text: chapterSpeech(c, kind === 'summary' ? cc.summaryMd : undefined) }
}
const hashKey = (j) => j.key + '|' + j.kind
async function prepareSpeech() {
  if (!canSpeak || preview) return
  const m = speech.value || (speech.value = await import('@platform-kit/kit/lib/tts/audiobook.js'))
  const map = {}, all = []
  for (let i = 0; i < chapters.value.length; i++) for (const summary of [false, true]) {
    const j = jobFor(i, summary)
    if (!j || !j.text || map[hashKey(j)]) continue
    map[hashKey(j)] = await m.hashText(j.text); all.push(map[hashKey(j)])
  }
  speechHash.value = map
  await m.hydrate(all)
  /* then the bucket, for every page without a recording from the store: one
     another reader spoke is played, not made; nothing waits on these */
  for (const [k, h] of Object.entries(map)) if (!recorded(k)) m.probe(props.slug, h).catch(() => {})
}
/* whether the store's manifest has a recording for "<key>|<kind>" */
function recorded(k) {
  const a = fm.value && fm.value.audio, [key, kind] = k.split('|')
  const e = a && a[key] && a[key][kind]
  return !!(e && e.src)
}
const currentJob = computed(() => jobFor(ch.value, inSummary.value))
const currentHash = computed(() => (currentJob.value ? speechHash.value[hashKey(currentJob.value)] : null))
const localTrack = computed(() => (speech.value && currentHash.value ? speech.value.tracks[currentHash.value] : null))
/* a recording made here plays exactly as one from the store */
const localAudio = computed(() => {
  const t = localTrack.value, c = chapters.value[ch.value]
  if (!t || t.status !== 'done' || !c) return null
  return { src: t.url, seconds: t.seconds || 0, kind: c.intro ? 'intro' : currentJob.value.kind, title: c.title, local: true }
})
const playable = computed(() => audio.value || localAudio.value)
const canGenerate = computed(() => canSpeak && !!speech.value && !playable.value && !gate.value && view.value === 'read' && !!currentHash.value)
/* the current chapter first, then every one after it that has no recording, in
   order — up to the first locked chapter, which is never made */
function generateFrom() {
  const m = speech.value; if (!m) return
  const list = []
  for (let i = ch.value; i < chapters.value.length; i++) {
    if (isLocked(i)) break
    const j = jobFor(i, inSummary.value)
    if (!j || !j.text) continue
    const a = fm.value && fm.value.audio, e = a && a[j.key] && a[j.key][j.kind]
    if (e && e.src) continue
    const hash = speechHash.value[hashKey(j)]
    if (hash) list.push({ hash, text: j.text, title: j.title })
  }
  if (list.length) m.start(props.slug, list)
}
watch(currentHash, (h) => { if (h && speech.value) { speech.value.prioritise(h); if (!audio.value) speech.value.probe(props.slug, h).catch(() => {}) } })
onBeforeUnmount(() => { if (speech.value) speech.value.stop() })
const quizOpen = ref(false)
/* the bottom line: the chapter's key insights, shown under the text in both
   modes — three by default, the rest on request */
const essence = computed(() => (chapters.value[ch.value] && comp.value ? (chapterCompanion(props.slug, chapters.value[ch.value].title) || {}).essence || [] : []))
const essShown = computed(() => (essOpen.value ? essence.value : essence.value.slice(0, 3)))
function openQuiz() { quizOpen.value = true; window.scrollTo({ top: 0, behavior: 'smooth' }) }
function quizNext() { quizOpen.value = false; if (ch.value < chapters.value.length - 1) ch.value++ }
function finishReading() { view.value = 'cover'; window.scrollTo(0, 0) }

/* how far through the book, by chapter — drives the bar under the sticky header */
const progress = computed(() => chapters.value.length ? Math.round(((ch.value + 1) / chapters.value.length) * 100) : 0)
function begin(atCh, mode) {
  if (mode) setMode(mode)
  if (typeof atCh === 'number') ch.value = atCh
  view.value = 'read'
  quizOpen.value = false
  render()
}
function openModal(name) { modal.value = modal.value === name ? '' : name }
/* the phone's tools menu */
const toolsOpen = ref(false)
function onEsc(e) {
  if (e.key === 'Escape') { if (modal.value) modal.value = ''; return }
  /* left / right turn the page while reading — but not while a modal is open or
     the reader is typing in the search box or a note */
  if (view.value !== 'read' || modal.value || quizOpen.value) return
  const tag = (e.target && e.target.tagName) || ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return
  if (e.key === 'ArrowRight' && ch.value < chapters.value.length - 1 && !isLocked(ch.value)) { ch.value++; e.preventDefault() }
  else if (e.key === 'ArrowLeft' && ch.value > 0) { ch.value--; e.preventDefault() }
}

/* ---- access: the rung this reader stands on for THIS book (a bought book reads
   as paid), how many chapters that unlocks, and the gate shown past them ---- */
const rank = (c) => CLASSES.indexOf(c)
const effClass = computed(() => (hasProduct(props.slug) && rank(userClass.value) < rank('paid') ? 'paid' : userClass.value))
/* THE BAR IS THE ABILITY'S, and it already knows that a book bought outright lifts its buyer to
   paid for that book — the same lift effClass makes below for the chapter allowance, which is a
   count rather than a bar and stays where it is. */
const bookAllowed = computed(() => can('read', entrySubject({ kind: 'books', slug: props.slug, canAccess: fm.value.canAccess })))
/* the allowance counts chapters; the introduction page in front of them is free with the first */
const firstLocked = computed(() => { if (!bookAllowed.value) return 0; const n = chapterAllowance(fm.value, effClass.value); return n > 0 ? n + introOffset.value : 0 })
const isLocked = (i) => i >= firstLocked.value
const gate = ref(null)   /* null, or { required, teaser } while the current chapter is locked */

/* ---- the chapters the bundle could not carry. The published book is the one a guest may read
   (_shared/gate.js): from gatedFrom on, a chapter is its title and teaser. A reader allowed further is
   sent the rest by reader-content, once per book; until it arrives such a chapter says it is opening,
   and if it cannot be fetched it says so with a retry — never the paywall, which would tell somebody who
   has paid that they have not. ---- */
const gatedState = ref('')   /* '' | 'loading' | 'error' | 'done' */
const waitingFor = (i) => typeof fm.value.gatedFrom === 'number' && !isLocked(i) && !(chapters.value[i] && chapters.value[i].intro)
  && i - introOffset.value >= fm.value.gatedFrom && gatedState.value !== 'done'
async function fetchGated() {
  if (preview || typeof fm.value.gatedFrom !== 'number') return
  if (!(firstLocked.value - introOffset.value > fm.value.gatedFrom)) return
  if (gatedState.value === 'loading' || gatedState.value === 'done') return
  gatedState.value = 'loading'
  try {
    const r = await readerBook(props.slug)
    const intro = chapters.value[0] && chapters.value[0].intro ? chapters.value[0] : null
    const next = bookChapters(r.raw)
    if (intro) next.unshift(intro)
    chapters.value = next
    useCompanion(props.slug, r.companion)
    gatedState.value = 'done'
  } catch (e) {
    gatedState.value = 'error'
  }
  repaint()
}
function retryGated() { gatedState.value = ''; fetchGated() }
watch(firstLocked, () => fetchGated())
/* somebody else signed in, or nobody: the book as published again, then whatever this reader may have */
watch(isSignedIn, () => { if (gatedState.value) { gatedState.value = ''; load() } })

const html = ref('')
/* v-html with an unchanged string never patches the DOM, so painted marks
   would survive their own deletion — blank it for a tick to force the patch */
async function repaint() {
  html.value = ''
  await nextTick()
  await render()
}
async function render() {
  const c = chapters.value[ch.value]
  if (!c) return
  /* past the free allotment (or a canAccess bar): the paywall, never the text.
     Every way of reaching a chapter lands here, so this is the one gate. */
  if (isLocked(ch.value)) {
    gate.value = {
      required: bookAllowed.value ? requiredForChapter(fm.value, ch.value - introOffset.value) : requiredBy(fm.value.canAccess),
      teaser: c.md.replace(/[#*_=`{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 260),
    }
    html.value = ''
    state.value.ch = ch.value
    saveState()
    toolbar.value.open = false
    return
  }
  gate.value = null
  if (waitingFor(ch.value)) { html.value = ''; return }
  const cc = inSummary.value && !c.intro ? chapterCompanion(props.slug, c.title) : null
  if (c.intro) {
    html.value = marked.parse(c.md)   /* the introduction: the same page whichever way the book is read */
  } else if (cc && cc.summaryMd) {
    /* the summary; the reader's own highlights anchor to the full text, so they
       are not painted here. The bottom line follows the text in both modes. */
    html.value = '<div class="rd-sum">' + marked.parse(cc.summaryMd) + '</div>'   /* through the reader's own marked, so ==marks== render */
  } else {
    html.value = (inSummary.value ? '<p class="rd-nosum">' + escapeHtml(R.mode['no-summary']) + '</p>' : '') + marked.parse(c.md)
  }
  state.value.ch = ch.value
  saveState()
  await nextTick()
  if (!cc) paintHighlights()
  toolbar.value.open = false
}
const escapeHtml = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
watch(ch, () => { quizOpen.value = false; essOpen.value = false; render(); askCanSay() })
watch(chapterSubject, askCanSay, { immediate: true })
/* between one chapter fading out and the next fading in, the window is at the top */
function toTop() { window.scrollTo({ top: 0, left: 0, behavior: "instant" }) }
/* signing in or buying re-opens whatever it unlocks, in place */
watch(effClass, render)

/* ---- highlights: anchor by quote + context, paint by walking text nodes ---- */
function textNodesUnder(el) {
  const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n; while ((n = w.nextNode())) out.push(n)
  return out
}
function paintHighlights() {
  const el = body.value
  if (!el) return
  for (const h of state.value.highlights.filter((x) => x.ch === ch.value)) {
    const nodes = textNodesUnder(el)
    const full = nodes.map((n) => n.textContent).join('')
    let at = -1
    for (let i = full.indexOf(h.quote); i >= 0; i = full.indexOf(h.quote, i + 1)) {
      const pre = full.slice(Math.max(0, i - 16), i)
      if (!h.prefix || pre.endsWith(h.prefix.slice(-Math.min(16, h.prefix.length)))) { at = i; break }
    }
    if (at < 0) continue
    let pos = 0
    for (const node of nodes) {
      const start = pos, end = pos + node.textContent.length
      pos = end
      const s = Math.max(at, start), e = Math.min(at + h.quote.length, end)
      if (s >= e) continue
      const range = document.createRange()
      range.setStart(node, s - start); range.setEnd(node, e - start)
      const mark = document.createElement('mark')
      mark.className = 'bk-hl hl-' + (h.color || 'sun')
      mark.dataset.id = h.id
      try { range.surroundContents(mark) } catch (err) { /* crosses elements; the node-by-node pass covers it */ }
    }
  }
}

/* ---- the selection toolbar ----
   Selection the way people actually select: drag on desktop, long-press and
   handles on mobile. selectionchange is the one event both produce, so it is
   debounced and the toolbar follows the end of the selection. Toolbar buttons
   prevent pointerdown so the selection survives the tap. */
const COLORS = ['sun', 'leaf', 'sky', 'ocean', 'ember']
const toolbar = ref({ open: false, x: 0, y: 0 })
let pending = null
let selTimer = null
function onSelChange() {
  clearTimeout(selTimer)
  selTimer = setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !body.value || !body.value.contains(sel.anchorNode) ||
        !body.value.contains(sel.focusNode)) { toolbar.value.open = false; return }
    const quote = sel.toString().trim()
    if (quote.length < 3) { toolbar.value.open = false; return }
    const rects = sel.getRangeAt(0).getClientRects()
    const r = rects[rects.length - 1] || sel.getRangeAt(0).getBoundingClientRect()
    const host = body.value.getBoundingClientRect()
    pending = { quote, prefix: prefixFor(sel) }
    /* clamped so the pill never hangs off a phone screen */
    const x = Math.max(120, Math.min(host.width - 120, r.right - host.left))
    toolbar.value = { open: true, x, y: r.bottom - host.top + 10 }
  }, 200)
}
function prefixFor(sel) {
  try {
    const r = sel.getRangeAt(0).cloneRange()
    r.setStart(body.value, 0)
    return r.toString().slice(0, -sel.toString().length).slice(-16)
  } catch (e) { return '' }
}
async function addHighlight(color, withNote) {
  if (!pending) return
  const h = { id: 'h' + Date.now(), ch: ch.value, quote: pending.quote,
    prefix: pending.prefix, note: '', color: color || state.value.lastColor || 'sun' }
  state.value.lastColor = h.color
  state.value.highlights.push(h)
  saveState()
  window.getSelection().removeAllRanges()
  toolbar.value.open = false
  await repaint()
  if (withNote) { modal.value = 'saved'; editing.value = h.id }
}

/* tapping a painted highlight opens its own little menu: recolor, note, delete */
const markMenu = ref({ open: false, x: 0, y: 0, id: '' })
const editing = ref('')
function onBodyClick(e) {
  const m = e.target.closest && e.target.closest('mark.bk-hl')
  if (!m) { markMenu.value.open = false; return }
  const host = body.value.getBoundingClientRect()
  const r = m.getBoundingClientRect()
  const mx = Math.max(140, Math.min(host.width - 140, r.left - host.left + r.width / 2))
  markMenu.value = { open: true, x: mx, y: r.bottom - host.top + 8, id: m.dataset.id }
}
async function recolor(color) {
  const h = state.value.highlights.find((x) => x.id === markMenu.value.id)
  if (h) { h.color = color; state.value.lastColor = color; saveState(); await repaint() }
  markMenu.value.open = false
}
function noteFromMenu() {
  modal.value = 'saved'; editing.value = markMenu.value.id; markMenu.value.open = false
}
async function removeHighlight(id) {
  state.value.highlights = state.value.highlights.filter((h) => h.id !== id)
  editing.value = ''
  markMenu.value.open = false
  saveState(); await repaint()
}
const doomHighlight = (id) => confirmThen(id, () => removeHighlight(id))
const doomBookmark = (id) => confirmThen(id, () => removeBookmark(id))

/* ---- bookmarks: one per chapter, toggled ---- */
const hasBookmark = computed(() => state.value.bookmarks.some((b) => b.ch === ch.value))
function toggleBookmark() {
  if (hasBookmark.value) {
    state.value.bookmarks = state.value.bookmarks.filter((b) => b.ch !== ch.value)
  } else {
    const frac = body.value ? Math.min(1, window.scrollY / Math.max(1, document.body.scrollHeight - innerHeight)) : 0
    state.value.bookmarks.push({ id: 'b' + Date.now(), ch: ch.value, frac,
      label: chapters.value[ch.value].title })
  }
  saveState()
}
function gotoBookmark(b) {
  ch.value = b.ch
  nextTick().then(() => window.scrollTo(0, b.frac * (document.body.scrollHeight - innerHeight)))
}
function removeBookmark(id) {
  state.value.bookmarks = state.value.bookmarks.filter((b) => b.id !== id); saveState()
}

/* ---- in-book search ---- */
const q = ref('')
const found = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (needle.length < 2) return []
  const out = []
  chapters.value.forEach((c, i) => {
    const t = c.md.toLowerCase()
    let at = t.indexOf(needle)
    while (at >= 0 && out.length < 30) {
      out.push({ ch: i, chTitle: c.title,
        excerpt: '…' + c.md.slice(Math.max(0, at - 34), at + needle.length + 60).replace(/\s+/g, ' ') + '…' })
      at = t.indexOf(needle, at + needle.length)
    }
  })
  return out
})
function gotoHit(hit) { ch.value = hit.ch; modal.value = ''; q.value = ''; view.value = 'read' }

/* ---- the saved modal's tabs, and deletes that ask twice ----
   Nothing kept is destroyed on one tap: the first tap arms the button and it
   asks plainly; a second tap within a few seconds does it. */
const savedTab = ref('bookmarks')
const noted = computed(() => state.value.highlights.filter((h) => h.note && h.note.trim()))
const confirmId = ref('')
let confirmTimer = null
function armed(id) { return confirmId.value === id }
function confirmThen(id, fn) {
  if (confirmId.value === id) { confirmId.value = ''; clearTimeout(confirmTimer); fn(); return }
  confirmId.value = id
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmId.value = '' }, 3000)
}

/* ---- the site's dark mode drives the reader's night pages ---- */
const globalDark = ref(false)
function readGlobalDark() {
  const t = document.documentElement.dataset.theme
  globalDark.value = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)
}
let themeObserver = null
onMounted(() => {
  readGlobalDark()
  themeObserver = new MutationObserver(readGlobalDark)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readGlobalDark)
})
onBeforeUnmount(() => {
  if (themeObserver) themeObserver.disconnect()
  matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', readGlobalDark)
})

/* ---- prefs ---- */
/* the site's theme is the page: light reads on paper, dark reads at night */
const scheme = computed(() => (globalDark.value ? 'night' : 'paper'))
function setSize(i) { state.value.size = i; saveState() }

onMounted(() => {
  document.addEventListener('selectionchange', onSelChange)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelChange)
  document.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <div class="reader" :class="['scheme-' + scheme, { 'has-audio': !!playable || canGenerate }]">
    <!-- the title page carries its own title, so the sticky bar (back + title)
         only rides along once you're reading -->
    <div v-if="view !== 'cover' || missing" class="rd-bar">
      <a class="rd-back" href="/content/books" :aria-label="R.bar.back">&larr;</a>
      <button type="button" class="rd-title" @click="view = 'cover'">
        <b>{{ meta.title }}</b>
        <span v-if="view === 'read' && chapters[ch]">{{ chapters[ch].title }}</span>
      </button>
      <!-- on a phone the tools live behind one button, as a sheet under the bar -->
      <button v-if="view === 'read'" type="button" class="rd-more" :class="{ on: toolsOpen }" :aria-label="R.bar.more" :aria-expanded="toolsOpen" @click="toolsOpen = !toolsOpen">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="4" cy="10" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="16" cy="10" r="1.7"/></svg>
      </button>
      <div class="rd-tools" :class="{ open: toolsOpen }" v-if="view === 'read'" @click="toolsOpen = false">
        <span v-if="comp" class="rd-mode" role="group">
          <button type="button" :class="{ on: !inSummary }" @click="setMode('full')">{{ R.mode.full }}</button>
          <button type="button" :class="{ on: inSummary }" @click="setMode('summary')">{{ R.mode.summary }}</button>
        </span>
        <button type="button" @click="openModal('contents')">{{ R.bar.chapters }}</button>
        <button type="button" @click="openModal('saved')">{{ R.bar.saved }}</button>
        <button type="button" class="rd-ico" :aria-label="R.bar['search-title']" :title="R.bar.search"
                @click="openModal('search')">
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
            <path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="rd-ico" :aria-label="R.bar.type" :title="R.bar['type-title']"
                @click="openModal('type')">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
               stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <!-- WHAT PEOPLE SAY ABOUT THIS CHAPTER. Not about the book: "what did you think of The
             Kybalion" is not a conversation anybody has, and "chapter four lost me" is. The thread
             opens beside the page rather than under it, because a reader is in the middle of
             reading and should be able to look at it and carry on. -->
        <button v-if="canSay" type="button" class="rd-ico" :class="{ on: saying }" :aria-label="R.bar.comments"
                :title="R.bar.comments" :aria-expanded="saying" @click="saying = !saying">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L4.5 17v-3.5h1a2 2 0 0 1-2-2z" />
          </svg>
        </button>
        <button type="button" class="rd-bm" :class="{ on: hasBookmark }"
                :title="hasBookmark ? R.bar['bookmark-remove'] : R.bar['bookmark-add']"
                :aria-pressed="hasBookmark" @click="toggleBookmark">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.4L5.5 20.5v-16a1 1 0 0 1 1-1Z"
                  :fill="hasBookmark ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.7"
                  stroke-linejoin="round" />
          </svg>
        </button>
      </div>
      <div v-if="view === 'read'" class="rd-progress" :aria-label="progress + '% ' + PROG['aria-read']" role="progressbar" :aria-valuenow="progress">
        <span class="rd-progress-fill" :style="{ width: progress + '%' }" />
      </div>
    </div>

    <!-- the views cross-fade, and inside the page each chapter fades in as the last
         fades out; the window goes to the top between the two so a chapter opens at its head -->
    <Transition name="rdview" mode="out-in">
    <div v-if="missing" key="missing" class="rd-page"><p>{{ R.bar.missing }}</p></div>

    <!-- ------------------------------------------------ the title page ---- -->
    <div v-else-if="view === 'cover'" key="cover" class="rd-coverpage">
      <div class="rd-covart">
        <span class="rd-covart-glow" aria-hidden="true"
              :style="{ backgroundImage: meta.cover ? 'url(' + meta.cover.blurDataURL + ')' : coverTint(props.slug) }" />
        <Book3D v-if="meta.cover" class="rd-coverimg" :slug="props.slug" :art="meta.cover.src" :alt="meta.title + ' cover'" :title="meta.title" :author="meta.author" mode="still" :fill="0.86" />
        <!-- coverless books get the same simulated cover the shelf shows, same 2:3 -->
        <span v-else class="rd-coversim" :style="{ backgroundImage: coverTint(props.slug) }">
          <span class="rd-coversim-title">{{ meta.title }}</span>
          <span v-if="meta.author" class="rd-coversim-author">{{ meta.author }}</span>
        </span>
      </div>

      <div class="rd-coverinfo">
        <p v-if="meta.author" class="rd-covauthor">{{ meta.author }}</p>
        <h1>{{ meta.title }}</h1>
        <!-- the trophy this reader has earned on the book, when there is one -->
        <div v-if="mastery.tier" class="rd-covtrophy" :class="'is-' + mastery.tier">
          <Trophy :tier="mastery.tier" :size="44" :label="TR.label + ': ' + TR[mastery.tier]" />
          <span><b>{{ TR[mastery.tier] }}</b><i>{{ String(TC.progress || '').replace('{done}', mastery.done).replace('{total}', mastery.total) }}</i></span>
        </div>
        <p v-if="fm.description" class="rd-covdesc">{{ fm.description }}</p>
        <div v-if="insight" class="rd-covinsight">
          <span class="rd-covsug-eyebrow">{{ R.cover.insight }}</span>
          <p>{{ insight }}</p>
        </div>

        <div class="rd-covactions">
          <button type="button" class="rd-begin" @click="begin(started ? undefined : 0)">
            {{ started ? R.cover.continue : R.cover.begin }}
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 8h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <!-- how to read it: the whole text, or the summary. A choice, not a second button -->
          <div v-if="comp && summaryTimeLabel" class="rd-covmode" role="radiogroup" :aria-label="R.mode.full + ' / ' + R.mode.summary">
            <button type="button" role="radio" :aria-checked="!inSummary" :class="{ on: !inSummary }" @click="setMode('full')"><b>{{ R.mode.full }}</b><span>{{ readTime }}</span></button>
            <button type="button" role="radio" :aria-checked="inSummary" :class="{ on: inSummary }" @click="setMode('summary')"><b>{{ R.mode.summary }}</b><span>{{ summaryTimeLabel }}</span></button>
          </div>
        </div>
        <!-- a book without a companion still says how long it is -->
        <p v-if="!comp || !summaryTimeLabel" class="rd-covstat"><span>{{ chapterCount }} {{ chapterCount === 1 ? 'chapter' : 'chapters' }}</span><span>{{ readTime }}</span></p>

        <!-- the files a buyer of the printed edition holds: the PDF, the EPUB, each version -->
        <div v-if="files && files.length" class="rd-covfiles">
          <span class="rd-covsug-eyebrow">{{ R.cover.files }}</span>
          <p class="rd-covfiles-subtitle">{{ R.cover['files-subtitle'] }}</p>
          <ul>
            <li v-for="f in files" :key="f.contents + f.format"><a :href="f.url" download>{{ R.cover['download-' + f.format] || f.format }}</a> <span>· {{ R.cover['file-' + f.contents] || f.contents }}</span></li>
          </ul>
        </div>

        <div v-if="teaser.length" class="rd-covsug">
          <span class="rd-covsug-eyebrow">{{ R.cover.highlights }}</span>
          <ul class="rd-covsug-list">
            <li v-for="(t, i) in teaser" :key="i" class="rd-covsug-item">
              <svg class="rd-covsug-mark" viewBox="0 0 28 24" :style="{ color: sugColor(t.color) }" aria-hidden="true">
                <path fill="currentColor" d="M2 22V13.2C2 7.4 5 3.6 11 2l1 3.1C8.4 6.3 6.6 8.3 6.5 11H11v11H2Zm15 0V13.2C17 7.4 20 3.6 26 2l1 3.1C23.4 6.3 21.6 8.3 21.5 11H26v11h-9Z"/>
              </svg>
              <span class="rd-covsug-q">{{ teaserText(t.text) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- --------------------------------------------------- the page ---- -->
    <div v-else key="read" class="rd-page">
      <Transition name="rdv" mode="out-in" @after-leave="toTop">
      <div :key="ch + ':' + (state.mode || '') + ':' + (gate ? 'g' : quizOpen ? 'q' : 'p')" class="rd-leaf">
      <div v-if="gate" class="rd-body rd-gated" :style="{ fontSize: SIZES[state.size] + 'px', fontFamily: fontStack }">
        <Gate kind="book" :required="gate.required" :teaser="gate.teaser" :book-slug="props.slug"
              :progress="{ n: Math.min(firstLocked, chapters.length), total: chapters.length }" />
      </div>
      <BookQuiz v-else-if="quizOpen" :slug="props.slug" :chapter="{ title: chapters[ch].title, quiz: chapterQuiz(ch) }"
                :next-title="ch < chapters.length - 1 && !isLocked(ch + 1) ? chapters[ch + 1].title : ''" @close="quizOpen = false" @next="quizNext" />
      <div v-else-if="waitingFor(ch)" class="rd-body rd-wait" :style="{ fontSize: SIZES[state.size] + 'px', fontFamily: fontStack }" role="status">
        <p class="rd-wait-line">{{ gatedState === 'error' ? R.gated.error : R.gated.loading }}</p>
        <button v-if="gatedState === 'error'" type="button" class="rd-wait-retry" @click="retryGated">{{ R.gated.retry }}</button>
      </div>
      <template v-else>
        <div ref="body" class="rd-body" :style="{ fontSize: SIZES[state.size] + 'px', fontFamily: fontStack }"
             v-html="html" @click="onBodyClick" />
        <div v-if="essence.length" class="rd-bottom">
          <span class="rd-covsug-eyebrow">{{ R.summary.essence }}</span>
          <ul class="rd-ess">
            <li v-for="(e, i) in essShown" :key="i">{{ e }}</li>
          </ul>
          <button v-if="essence.length > 3" type="button" class="rd-essmore" @click="essOpen = !essOpen">{{ essOpen ? R.summary['show-less'] : R.summary['show-more'] + ' (' + (essence.length - 3) + ')' }}</button>
        </div>
        <div v-if="chapterQuiz(ch).length" class="rd-quizpanel">
          <span class="rd-covsug-eyebrow">{{ R.quiz['panel-title'] }}</span>
          <p>{{ R.quiz['panel-subtitle'] }}</p>
          <div class="rd-quizrow">
            <span class="rd-quizleft">
              <button type="button" class="rd-begin rd-quizbtn" @click="openQuiz">{{ quizResult ? R.quiz.again : R.quiz.take }}</button>
              <span v-if="quizResult" class="rd-quizbest" :class="{ passed: quizResult.best / quizResult.total >= 0.8 }">{{ quizResult.best / quizResult.total >= 0.8 ? R.quiz.passed : R.quiz.best }} &middot; {{ quizResult.best }} {{ R.quiz.of }} {{ quizResult.total }}</span>
            </span>
            <!-- the natural next step stays in reach beside the quiz -->
            <button v-if="ch < chapters.length - 1" type="button" class="rd-keep" :disabled="isLocked(ch + 1)" @click="ch++">{{ R.quiz['keep-reading'] }} <span aria-hidden="true">&rarr;</span></button>
            <button v-else type="button" class="rd-keep" @click="finishReading">{{ R.quiz['finish-reading'] }} <span aria-hidden="true">&rarr;</span></button>
          </div>
        </div>
        <div v-else class="rd-nextrow">
          <button v-if="ch < chapters.length - 1" type="button" class="rd-keep" :disabled="isLocked(ch + 1)" @click="ch++">{{ R.quiz['keep-reading'] }} <span aria-hidden="true">&rarr;</span></button>
          <button v-else type="button" class="rd-keep" @click="finishReading">{{ R.quiz['finish-reading'] }} <span aria-hidden="true">&rarr;</span></button>
        </div>
      </template>
      </div>
      </Transition>
      <div v-if="toolbar.open" class="rd-toolbar" :style="{ left: toolbar.x + 'px', top: toolbar.y + 'px' }"
           @pointerdown.prevent>
        <button v-for="c in COLORS" :key="c" type="button" class="rd-dot" :class="'dot-' + c"
                :aria-label="R.a11y['highlight-in'] + ' ' + c" @click="addHighlight(c, false)" />
        <span class="rd-tsep" />
        <button type="button" class="rd-tnote" @click="addHighlight(null, true)">{{ R.tabs['add-note'] }}</button>
      </div>
      <div v-if="markMenu.open" class="rd-toolbar rd-markmenu"
           :style="{ left: markMenu.x + 'px', top: markMenu.y + 'px' }" @pointerdown.prevent>
        <button v-for="c in COLORS" :key="c" type="button" class="rd-dot" :class="'dot-' + c"
                :aria-label="R.a11y.recolour + ' ' + c" @click="recolor(c)" />
        <span class="rd-tsep" />
        <button type="button" class="rd-tnote" @click="noteFromMenu">{{ R.tabs.note }}</button>
        <button type="button" class="rd-tnote rd-tdel" @click="doomHighlight(markMenu.id)">
          {{ armed(markMenu.id) ? R.tabs['delete-confirm'] : R.tabs.delete }}</button>
      </div>
      <div class="rd-turn">
        <BookAudio v-if="playable" :key="playable.src" :src="playable.src" :seconds="playable.seconds" :title="playable.title" :kind="playable.kind" />
        <BookGenerate v-else-if="canGenerate" :status="speech.status" :track="localTrack" :ahead="currentHash ? speech.ahead(currentHash) : 0" @generate="generateFrom" />
        <Transition name="rdv" mode="out-in">
        <div class="rd-turn-in" :key="ch">
          <button type="button" class="rd-turn-btn" :disabled="ch === 0" :aria-label="R.a11y.prev" @click="ch--">
            <span class="rd-turn-arrow">&larr;</span><span class="rd-turn-t">{{ chapters[ch - 1]?.title || '' }}</span>
          </button>
          <span class="rd-where">{{ ch + 1 }} / {{ chapters.length }}</span>
          <button type="button" class="rd-turn-btn rd-turn-next" :disabled="ch >= chapters.length - 1 || isLocked(ch)" :aria-label="R.a11y.next" @click="ch++">
            <span class="rd-turn-t">{{ chapters[ch + 1]?.title || '' }}</span><span class="rd-turn-arrow">&rarr;</span>
          </button>
        </div>
        </Transition>
      </div>
    </div>
    </Transition>

    <!-- ---------------------------------------------------- modals ---- -->
    <div v-if="modal" class="rd-veil" @click.self="modal = ''">
      <div class="rd-modal" role="dialog" :aria-label="modal">
        <div class="rd-mhead">
          <b>{{ { contents: R.modal.contents, search: R.modal.search, saved: R.modal.saved, type: R.modal.type }[modal] }}</b>
          <button type="button" class="rd-x" :aria-label="R.a11y.close" @click="modal = ''">&times;</button>
        </div>

        <div v-if="modal === 'contents'" class="rd-mbody">
          <button v-for="(c, i) in chapters" :key="i" type="button" class="rd-row"
                  :class="{ on: i === ch }" @click="ch = i; modal = ''; view = 'read'">
            <span class="rd-n">{{ i + 1 }}</span>{{ c.title }}
          </button>
        </div>

        <div v-else-if="modal === 'search'" class="rd-mbody">
          <input v-model="q" type="search" :placeholder="R.modal['search-placeholder']" class="rd-search" />
          <button v-for="(hit, i) in found" :key="i" type="button" class="rd-row" @click="gotoHit(hit)">
            <span class="rd-n">{{ hit.ch + 1 }}</span><span class="rd-x2">{{ hit.excerpt }}</span>
          </button>
          <p v-if="q.trim().length >= 2 && !found.length" class="rd-none">{{ R.modal['not-found'] }}</p>
        </div>

        <div v-else-if="modal === 'saved'" class="rd-mbody">
          <div class="rd-tabs">
            <button v-for="tname in ['bookmarks', 'highlights', 'notes']" :key="tname" type="button"
                    class="rd-tab" :class="{ on: savedTab === tname }" @click="savedTab = tname">
              {{ R.tabs[tname] }}</button>
          </div>

          <template v-if="savedTab === 'bookmarks'">
            <div v-for="b in state.bookmarks" :key="b.id" class="rd-row rd-static">
              <button type="button" class="rd-go" @click="gotoBookmark(b); modal = ''; view = 'read'">{{ b.label }}</button>
              <button type="button" class="rd-trash" :class="{ armed: armed(b.id) }"
                      :aria-label="armed(b.id) ? R.tabs['delete-confirm'] : R.tabs.delete"
                      :title="armed(b.id) ? R.tabs['delete-confirm'] : R.tabs.delete"
                      @click="doomBookmark(b.id)"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M3.5 5.5h13M8 5V3.8A.8.8 0 0 1 8.8 3h2.4a.8.8 0 0 1 .8 1.2V5M5.5 5.5l.7 10.6a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10.6M8.2 8.5v5M11.8 8.5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
            </div>
            <p v-if="!state.bookmarks.length" class="rd-none">{{ R.tabs['no-bookmarks'] }}</p>
          </template>

          <template v-else-if="savedTab === 'highlights'">
            <div v-for="h in state.highlights" :key="h.id" class="rd-row rd-static">
              <button type="button" class="rd-go" @click="ch = h.ch; modal = ''; view = 'read'">
                <span class="rd-quote" :class="'q-' + (h.color || 'sun')">&ldquo;{{ h.quote.slice(0, 90) }}{{ h.quote.length > 90 ? '\u2026' : '' }}&rdquo;</span>
              </button>
              <button type="button" class="rd-trash" :class="{ armed: armed(h.id) }"
                      :aria-label="armed(h.id) ? R.tabs['delete-confirm'] : R.tabs.delete"
                      :title="armed(h.id) ? R.tabs['delete-confirm'] : R.tabs.delete"
                      @click="doomHighlight(h.id)"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M3.5 5.5h13M8 5V3.8A.8.8 0 0 1 8.8 3h2.4a.8.8 0 0 1 .8 1.2V5M5.5 5.5l.7 10.6a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10.6M8.2 8.5v5M11.8 8.5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
            </div>
            <p v-if="!state.highlights.length" class="rd-none">{{ R.tabs['no-highlights'] }}</p>
          </template>

          <template v-else>
            <div v-for="h in (editing && !noted.find((x) => x.id === editing) ? state.highlights.filter((x) => x.id === editing).concat(noted) : noted)"
                 :key="h.id" class="rd-hl-row">
              <span class="rd-quote" :class="'q-' + (h.color || 'sun')">&ldquo;{{ h.quote.slice(0, 70) }}{{ h.quote.length > 70 ? '\u2026' : '' }}&rdquo;</span>
              <textarea v-if="editing === h.id" v-model="h.note" rows="3"
                        :placeholder="R.tabs['note-placeholder']" @change="saveState()" />
              <p v-else class="rd-note" @click="editing = h.id">{{ h.note }}</p>
              <div class="rd-hl-tools">
                <button type="button" @click="editing = editing === h.id ? '' : h.id">{{ editing === h.id ? R.tabs.done : R.tabs.edit }}</button>
                <button type="button" class="rd-trash" :class="{ armed: armed(h.id + ':note') }"
                        :aria-label="armed(h.id + ':note') ? R.tabs['clear-confirm'] : R.tabs.clear"
                        :title="armed(h.id + ':note') ? R.tabs['clear-confirm'] : R.tabs.clear"
                        @click="confirmThen(h.id + ':note', () => { h.note = ''; saveState() })"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M3.5 5.5h13M8 5V3.8A.8.8 0 0 1 8.8 3h2.4a.8.8 0 0 1 .8 1.2V5M5.5 5.5l.7 10.6a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10.6M8.2 8.5v5M11.8 8.5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
              </div>
            </div>
            <p v-if="!noted.length && !editing" class="rd-none">{{ R.tabs['no-notes'] }}</p>
          </template>
        </div>

        <div v-else-if="modal === 'type'" class="rd-mbody rd-typepanel">
          <div class="rd-h">{{ R.type.typeface }}</div>
          <div class="rd-fonts">
            <button v-for="f in FONTS" :key="f.k" type="button" class="rd-font"
                    :class="{ on: (state.font || 'bitter') === f.k }"
                    :style="{ fontFamily: f.stack }" @click="setFont(f.k)">
              <span class="rd-fsample">Aa</span>{{ f.label }}
              <svg v-if="(state.font || 'bitter') === f.k" viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 5.5 4.4 8.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>

          <div class="rd-h">{{ R.type.size }}</div>
          <div class="rd-sizes">
            <button v-for="(s, i) in SIZES" :key="s" type="button" :class="{ on: state.size === i }"
                    :style="{ fontSize: 12 + i * 4 + 'px' }" @click="setSize(i)">Aa</button>
          </div>
          <div class="rd-h">{{ R.type.page }}</div>
          <p class="rd-none">{{ R.type['page-note'] }}</p>
        </div>
      </div>
    </div>

    <!-- THE DRAWER. It slides in from the right over the page, dismissed by the backdrop, by the
         button or by Escape, and it shows THIS chapter's thread and no other. Mounted only while
         open, so a reader who never opens it never loads a conversation. -->
    <Teleport to="body">
      <Transition name="rdcm">
        <div v-if="saying" class="rdcm-veil" @click.self="saying = false">
          <aside class="rdcm" role="dialog" :aria-label="R.bar.comments">
            <header class="rdcm-head">
              <b>{{ chapters[ch] ? chapters[ch].title : meta.title }}</b>
              <button type="button" :aria-label="R.bar.close" @click="saying = false">&times;</button>
            </header>
            <div class="rdcm-body">
              <CommentThread kind="book-chapter" :subject="chapterSubject" bare />
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* the fades: a view or a chapter leaves quickly and the next arrives a beat slower, rising a touch */
.rdview-enter-active { transition: opacity .42s ease }
.rdview-leave-active { transition: opacity .2s ease }
.rdview-enter-from, .rdview-leave-to { opacity: 0 }
/* the bottom bar rises into place a beat after the page it belongs to */
@keyframes rd-rise { from { opacity: 0; transform: translateY(100%) } to { opacity: 1; transform: none } }
.rd-turn { animation: rd-rise .55s cubic-bezier(.22, .9, .3, 1) .15s both }
.rdv-enter-active { transition: opacity .42s ease, transform .42s cubic-bezier(.22, .9, .3, 1) }
.rdv-leave-active { transition: opacity .2s ease, transform .2s ease }
.rdv-enter-from { opacity: 0; transform: translateY(10px) }
.rdv-leave-to { opacity: 0; transform: translateY(-6px) }
@media (prefers-reduced-motion: reduce) { .rdv-enter-active, .rdv-leave-active, .rdview-enter-active, .rdview-leave-active { transition: none } .rd-turn { animation: none } }
/* the reader brings its own page colour; night stays night in either site theme */
.reader { --pg: #FBFAF4; --pgink: #26261F; --pgink2: #52524A; --pghair: #00000014;
  --hl-sun: #F5E27A73; --hl-leaf: #A9DFA366; --hl-sky: #F7D0AE73; --hl-ocean: #9AD2E070; --hl-ember: #F3BE8A70 }
.reader.scheme-night { --pg: #0C1524; --pgink: #E9EDF4; --pgink2: #A6B0C0; --pghair: #FFFFFF1C;
  --hl-sun: #C9A72E52; --hl-leaf: #5F9A5652; --hl-sky: #B4835256; --hl-ocean: #3E7E9456; --hl-ember: #B0713A56 }

/* flow-root, because the title page's 72px of air above it is a MARGIN, and a margin on a first
   child collapses out of its parent: the reader was pushed down 72px and its page colour began
   below the gap, so between the header and the book there was a band of the site's own paper with
   a hard edge under it. It showed wherever the site's paper and the book's page differ — white
   against cream on the default look, which is where it was found. The air belongs on the page. */
.reader { background: var(--pg); display: flow-root; min-height: calc(100vh - 74px); padding-bottom: 96px }
/* the title page */
.rd-coverpage { display: grid; grid-template-columns: 268px minmax(0, 1fr); gap: 60px;
  max-width: 840px; margin: 72px auto 0; padding: 0 26px; align-items: start }
/* the cover art, with a soft ambient glow bloomed from its own colours */
.rd-covart { position: relative; isolation: isolate }
.rd-covart-glow { position: absolute; inset: -12% -12% -22%; z-index: 0; border-radius: 40px;
  background-position: center; background-size: cover; filter: blur(52px) saturate(1.4);
  opacity: .5; pointer-events: none }
.rd-coversim { position: relative; z-index: 1; width: 100%; aspect-ratio: 2 / 3;
  border-radius: 5px 12px 12px 5px; box-shadow: 0 2px 5px #0000001f, 0 34px 64px -26px #000000a6 }
.rd-coverimg { position: relative; z-index: 1; width: 100% }
.rd-covfiles { margin: 22px 0 0; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 12px }
.rd-covfiles-subtitle { margin: 4px 0 8px; font-size: 13px; color: var(--ink3) }
.rd-covfiles ul { list-style: none; margin: 0; padding: 0 } .rd-covfiles li { font-size: 14px; line-height: 1.7 } .rd-covfiles li span { color: var(--ink3) }
.rd-covfiles a { color: var(--accent2); text-decoration: none } .rd-covfiles a:hover { text-decoration: underline; text-underline-offset: 3px }
.rd-coversim { display: flex; flex-direction: column; justify-content: space-between; padding: 24px 22px;
  background: linear-gradient(165deg, var(--accent2), var(--accent)); color: #F6FBF6;
  box-shadow: inset 6px 0 0 #00000022, 0 34px 64px -26px #000000a6 }
.rd-coversim-title { font-family: var(--fd); font-size: 21px; font-weight: 600; line-height: 1.2; letter-spacing: -.01em }
.rd-coversim-author { font-family: var(--m); font-size: 10px; letter-spacing: .12em;
  text-transform: uppercase; opacity: .8; margin-top: 10px }
.rd-coverinfo { padding-top: 6px }
.rd-covauthor { font-family: var(--m); font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
  color: var(--pgink2); margin: 0 0 12px }
.rd-coverinfo h1 { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600;
  font-size: clamp(33px, 4.4vw, 48px); color: var(--pgink); letter-spacing: -.016em; line-height: 1.05 }
.rd-covdesc { font-size: 16.5px; color: var(--pgink2); line-height: 1.62; margin: 20px 0 0; max-width: 50ch }
/* the primary action, prominent and high on the page */
.rd-covactions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; margin: 28px 0 0 }
.rd-covinsight { margin: 22px 0 0; max-width: 50ch } .rd-covinsight p { margin: 6px 0 0; font-family: var(--fd); font-size: 19px; line-height: 1.4; color: var(--pgink) }
/* secondary to the button: translucent, quiet, the chosen side a soft wash */
.rd-covmode { display: inline-flex; border: 1px solid var(--pghair); border-radius: 999px; padding: 3px; gap: 2px; background: color-mix(in srgb, var(--pg) 35%, transparent) }
.rd-covmode button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; font: inherit; color: var(--pgink2); background: none; border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer; text-align: left; opacity: .75; transition: opacity .15s }
.rd-covmode button:hover { opacity: 1 }
.rd-covmode button b { font-size: 12.5px; font-weight: 600; color: inherit } .rd-covmode button span { font-family: var(--m); font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .75 }
.rd-covmode button.on { color: var(--pgink); background: color-mix(in srgb, var(--pgink) 10%, transparent); opacity: 1 }
.rd-covstat { display: flex; flex-wrap: wrap; gap: 6px 0; margin: 16px 0 0 }
.rd-covstat > span + span::before { content: '·'; margin: 0 8px; opacity: .6 }
.rd-covtrophy { display: inline-flex; align-items: center; gap: 12px; margin: 14px 0 0; padding: 8px 16px 8px 8px; border: 1px solid var(--pghair); border-radius: 999px }
.rd-covtrophy span { display: flex; flex-direction: column }
.rd-covtrophy b { font-family: var(--fd); font-size: 14px; font-weight: 600; line-height: 1.2 }
.rd-covtrophy i { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--pgink2); margin-top: 2px }
.rd-covtrophy.is-gold b { color: #b8811c } .rd-covtrophy.is-silver b { color: #7c8593 } .rd-covtrophy.is-bronze b { color: #a3612c }
.rd-mode { display: inline-flex; border: 1px solid var(--pghair); border-radius: 999px; padding: 2px; margin-right: 4px }
.rd-mode button { border: 0 !important; padding: 4px 10px !important } .rd-mode button.on { background: var(--pgink); color: var(--pg) !important }
.rd-body :deep(.rd-sum) { }
.rd-body :deep(.rd-nosum) { font-family: var(--m); font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--pgink2); border-left: 2px solid var(--pghair); padding-left: 12px }
.rd-bottom { margin: 40px 0 0; padding: 24px 0 0; border-top: 1px solid var(--pghair) }
.rd-ess { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px }
.rd-ess li { position: relative; padding: 12px 16px 12px 34px; border: 1px solid var(--pghair); border-radius: 12px; font-family: var(--fd); font-size: 17px; line-height: 1.45; color: var(--pgink) }
.rd-ess li::before { content: ''; position: absolute; left: 14px; top: 1.1em; width: 9px; height: 9px; border-radius: 50%; background: var(--accent, #0e8c8c) }
.rd-essmore { margin-top: 12px; font: inherit; font-size: 13px; color: var(--pgink2); background: none; border: 1px solid var(--pghair); border-radius: 999px; padding: 6px 14px; cursor: pointer }
.rd-essmore:hover { color: var(--pgink); border-color: var(--pgink2) }
/* a chapter on its way from reader-content, or one that could not be fetched */
.rd-wait { min-height: 40vh }
.rd-wait-line { color: var(--pgink2); margin: 0 }
.rd-wait-retry { margin-top: 14px; font: inherit; font-size: 14px; font-weight: 600; color: var(--pgink); background: none; border: 1.5px solid var(--pgink); border-radius: 999px; padding: 8px 18px; cursor: pointer }
.rd-wait-retry:hover { background: var(--pgink); color: var(--pg) }
.rd-quizpanel { margin: 44px 0 0; padding: 22px 0 0; border-top: 1px solid var(--pghair); max-width: 56ch }
.rd-quizpanel p { margin: 6px 0 14px; color: var(--pgink2); font-size: 15px }
.rd-quizrow { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap }
.rd-quizleft { display: inline-flex; align-items: center; gap: 16px; flex-wrap: wrap }
.rd-nextrow { display: flex; justify-content: flex-end; margin: 40px 0 0; padding-top: 22px; border-top: 1px solid var(--pghair) }
.rd-keep { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-weight: 600; font-size: 14px; line-height: 1.3; color: var(--pgink); background: none; border: 1.5px solid var(--pgink); border-radius: 999px; padding: 10px 20px; cursor: pointer }
.rd-keep:hover:not(:disabled) { background: var(--pgink); color: var(--pg) } .rd-keep:disabled { opacity: .35; cursor: default }
.rd-begin.rd-quizbtn { padding: 10px 20px; font-size: 14px; border: 1.5px solid var(--pgink); line-height: 1.3; box-shadow: none }
.rd-quizbest { font-family: var(--m); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--pgink2) } .rd-quizbest.passed { color: #059669 }
.rd-begin { display: inline-flex; align-items: center; gap: 9px; font: inherit; font-weight: 600; font-size: 15px;
  color: var(--pg); background: var(--pgink); border: 0; border-radius: 999px; padding: 13px 26px; cursor: pointer;
  box-shadow: 0 8px 22px -10px #00000073; transition: transform .16s ease, box-shadow .16s ease }
.rd-begin:hover { transform: translateY(-2px); box-shadow: 0 12px 28px -10px #00000080 }
.rd-begin svg { transition: transform .18s ease }
.rd-begin:hover svg { transform: translateX(3px) }
.rd-covstat { font-family: var(--m); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--pgink2) }
.rd-covtags { display: flex; flex-wrap: wrap; gap: 7px; margin: 22px 0 0 }
.rd-tag { font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--pgink2); border: 1px solid var(--pghair); border-radius: 999px; padding: 3px 11px }
/* the cover-page teaser: a randomised handful of the book's baked-in marks, each
   drawn with its own element colour so the cover hints at what's inside */
.rd-covsug { margin-top: 38px; padding-top: 30px; border-top: 1px solid var(--pghair); max-width: 56ch }
.rd-covsug-eyebrow { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--pgink2); margin-bottom: 18px }
.rd-covsug-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 18px }
.rd-covsug-item { display: flex; gap: 13px; align-items: flex-start }
.rd-covsug-mark { flex: none; width: 22px; height: 19px; margin-top: 5px }
.rd-covsug-q { font-family: var(--fd); font-style: italic; font-size: 17px; line-height: 1.55; color: var(--pgink) }

@media (max-width: 640px) {
  .rd-coverpage { grid-template-columns: 1fr; gap: 30px; margin-top: 40px }
  .rd-covart { max-width: 200px }
}

/* modals */
.rd-veil { position: fixed; inset: 0; z-index: 60; background: #0a0d0b5c; backdrop-filter: blur(5px);
  display: flex; align-items: flex-start; justify-content: center; padding: 10vh 18px 0 }
.rd-modal { width: 560px; max-width: 100%; background: var(--pg); color: var(--pgink);
  border: 1px solid var(--pghair); border-radius: 16px; box-shadow: 0 30px 80px -18px #00000077;
  max-height: 72vh; display: flex; flex-direction: column }
.rd-mhead { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 15px 20px; border-bottom: 1px solid var(--pghair) }
.rd-mhead b { font-size: 15px }
.rd-x { font: inherit; font-size: 20px; line-height: 1; color: var(--pgink2); background: none;
  border: 0; cursor: pointer; padding: 2px 6px }
.rd-x:hover { color: var(--pgink) }
.rd-mbody { padding: 12px 16px 16px; overflow-y: auto }
.rd-x2 { font-size: 13px; line-height: 1.5 }

/* three columns, equal sides, so the title sits dead-centre of the sticky bar:
   [back]  [ book title · chapter, centred ]  [tools] */
.rd-bar { position: sticky; top: 0; z-index: 20; display: grid;
  grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px;
  background: var(--pg); border-bottom: 1px solid var(--pghair); padding: 12px 22px }
.rd-back { justify-self: start; color: var(--pgink2); text-decoration: none; font-size: 17px }
.rd-title { justify-self: center; min-width: 0; display: flex; gap: 10px; align-items: baseline;
  justify-content: center; text-align: center; color: var(--pgink);
  background: none; border: 0; font: inherit; cursor: pointer; padding: 0 }
.rd-title b { font-size: 14.5px; white-space: nowrap }
.rd-title span { font-size: 12.5px; color: var(--pgink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch }
.rd-tools { justify-self: end; display: flex; gap: 6px }
.rd-more { display: none; place-items: center; width: 34px; height: 34px; border-radius: 999px; border: 1px solid var(--pghair); background: none; color: var(--pgink2); cursor: pointer; justify-self: end; grid-area: tools }
.rd-more.on { color: var(--pgink); border-color: var(--pgink2) }
.rd-tools button { font: inherit; font-size: 12px; color: var(--pgink2); background: none;
  border: 1px solid var(--pghair); border-radius: 999px; padding: 5px 12px; cursor: pointer }
.rd-tools button.on, .rd-tools button:hover { color: var(--pgink); border-color: var(--pgink2) }
.rd-bm, .rd-ico { display: inline-flex; align-items: center; justify-content: center }
.rd-bm.on { color: var(--pgink) }
/* reading progress: a hairline-thin bar riding the foot of the sticky header */
.rd-progress { position: absolute; left: 0; right: 0; bottom: -1px; height: 3px; background: var(--pghair) }
.rd-progress-fill { display: block; height: 100%; background: var(--pgink); opacity: .55; transition: width .3s ease }

.rd-h { font-family: var(--m); font-size: 10px; letter-spacing: .15em; text-transform: uppercase;
  color: var(--pgink2); margin: 14px 0 8px }
.rd-h:first-child { margin-top: 2px }
.rd-row { display: flex; gap: 12px; align-items: baseline; width: 100%; text-align: left;
  background: none; border: 0; border-top: 1px solid var(--pghair); font: inherit; font-size: 14.5px;
  color: var(--pgink2); padding: 10px 4px; cursor: pointer }
.rd-row:hover, .rd-row.on { color: var(--pgink) }
.rd-row.on { font-weight: 700 }
.rd-n { font-family: var(--m); font-size: 11px; color: var(--pgink2); flex: none }
.rd-x { font-size: 13px; line-height: 1.5 }
.rd-static { cursor: default }
.rd-go { background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; padding: 0; flex: 1 }
.rd-del { background: none; border: 0; font: inherit; color: var(--pgink2); cursor: pointer }
.rd-del:hover { color: var(--pgink) }
.rd-none { font-size: 13px; color: var(--pgink2); margin: 6px 4px }
.rd-search { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; color: var(--pgink);
  background: transparent; border: 1px solid var(--pghair); border-radius: 9px; padding: 9px 12px; margin-bottom: 8px }
.rd-tabs { display: flex; gap: 6px; margin: 2px 0 12px }
.rd-tab { font: inherit; font-size: 12px; color: var(--pgink2); background: none;
  border: 1px solid var(--pghair); border-radius: 999px; padding: 6px 14px; cursor: pointer }
.rd-tab.on { color: var(--pg); background: var(--pgink); border-color: var(--pgink) }
.rd-del.armed { color: #b3402e; font-weight: 700 }
.rd-trash { display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 30px; height: 30px; border-radius: 8px; background: none; border: 0;
  color: var(--pgink2); cursor: pointer }
.rd-trash:hover { background: var(--pghair); color: var(--pgink) }
.rd-trash.armed { color: #fff; background: #b3402e }
.rd-quote.q-sun { box-shadow: inset 0 -6px 0 -2px var(--hl-sun) }
.rd-quote.q-leaf { box-shadow: inset 0 -6px 0 -2px var(--hl-leaf) }
.rd-quote.q-sky { box-shadow: inset 0 -6px 0 -2px var(--hl-sky) }
.rd-quote.q-ocean { box-shadow: inset 0 -6px 0 -2px var(--hl-ocean) }
.rd-quote.q-ember { box-shadow: inset 0 -6px 0 -2px var(--hl-ember) }
.rd-hl-row { border-top: 1px solid var(--pghair); padding: 10px 4px }
.rd-quote { font-size: 13.5px; color: var(--pgink); font-style: italic; line-height: 1.5 }
.rd-note { font-size: 13px; color: var(--pgink2); margin: 7px 0 0; cursor: text }
.rd-hl-row textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
  color: var(--pgink); background: transparent; border: 1px solid var(--pghair); border-radius: 8px;
  padding: 8px 10px; margin-top: 7px }
.rd-hl-tools { display: flex; gap: 14px; margin-top: 7px }
.rd-hl-tools button { background: none; border: 0; font: inherit; font-size: 11.5px;
  color: var(--pgink2); cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 3px }

.rd-typepanel .rd-sizes { display: flex; gap: 10px }
.rd-fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px }
.rd-font { display: flex; align-items: center; gap: 10px; font-size: 14.5px; color: var(--pgink2);
  background: none; border: 1px solid var(--pghair); border-radius: 10px; padding: 9px 12px;
  cursor: pointer; text-align: left }
.rd-font:hover { color: var(--pgink); border-color: var(--pgink2) }
.rd-font.on { color: var(--pgink); border-color: var(--pgink); font-weight: 700 }
.rd-font svg { margin-left: auto }
.rd-fsample { font-size: 17px }
@media (max-width: 560px) { .rd-fonts { grid-template-columns: 1fr } }
.rd-sizes button { font-family: inherit; background: none; border: 1px solid var(--pghair);
  border-radius: 9px; width: 52px; height: 40px; cursor: pointer; color: var(--pgink2) }
.rd-sizes button.on { border-color: var(--pgink); color: var(--pgink) }

/* the foot clears the fixed chapter bar, and the player above it when there is one */
.rd-page { position: relative; max-width: 660px; margin: 0 auto; padding: 34px 22px 90px }
.has-audio .rd-page { padding-bottom: 170px }
.rd-body { color: var(--pgink); line-height: 1.78; font-family: var(--f) }
.rd-body :deep(h2) { font-size: 1.35em; margin: 1.6em 0 .5em; color: var(--pgink) }
.rd-body :deep(h3) { font-size: 1.12em; margin: 1.4em 0 .4em; color: var(--pgink) }
.rd-body :deep(p) { margin: 0 0 1em; color: var(--pgink) }
.rd-body :deep(blockquote) { border-left: 2px solid var(--pghair); margin: 0 0 1em; padding: 2px 0 2px 16px; color: var(--pgink2) }
.rd-body :deep(mark.bk-hl) { color: inherit; border-radius: 2px; cursor: pointer; padding: 1px 0 }
.rd-body :deep(mark.hl-sun) { background: var(--hl-sun) }
.rd-body :deep(mark.hl-leaf) { background: var(--hl-leaf) }
.rd-body :deep(mark.hl-sky) { background: var(--hl-sky) }
.rd-body :deep(mark.hl-ocean) { background: var(--hl-ocean) }
.rd-body :deep(mark.hl-ember) { background: var(--hl-ember) }
/* system-suggested marks: a gentle long-wavelength coloured squiggle underneath
   the words (a repeating SVG wave, not CSS `wavy`, so we control the wavelength),
   with no background and no click behaviour — a hint, not a highlight. The wave
   repeats per line fragment, so it survives wrapping. */
.rd-body :deep(mark.sys-mark) {
  background-color: transparent; background-image: var(--sug-wave);
  background-repeat: repeat-x; background-position: left 100%; background-size: 20px 5px;
  color: inherit; text-decoration: none; padding-bottom: 3px;
}
.rd-body :deep(mark.sug-sun) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%23E1A200'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.rd-body :deep(mark.sug-leaf) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%234CA646'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.rd-body :deep(mark.sug-sky) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%23EFAE7A'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.rd-body :deep(mark.sug-ocean) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%231785A0'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.rd-body :deep(mark.sug-ember) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%23DD802F'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.rd-toolbar { position: absolute; transform: translateX(-50%); display: flex; gap: 7px;
  align-items: center; background: var(--pgink); border-radius: 999px; padding: 8px 12px;
  box-shadow: 0 8px 22px -8px #00000066; z-index: 30 }
.rd-dot { width: 19px; height: 19px; border-radius: 50%; border: 2px solid #ffffff30;
  cursor: pointer; padding: 0 }
.rd-dot:hover { border-color: #ffffffAA; transform: scale(1.12) }
.dot-sun { background: #F0D75E } .dot-leaf { background: #93CE8B } .dot-sky { background: #F3CBA6 }
.dot-ocean { background: #8FC4DB } .dot-ember { background: #EBAF74 }
.rd-tsep { width: 1px; height: 16px; background: #ffffff2c }
.rd-tnote { font: inherit; font-size: 12px; color: var(--pg); background: none; border: 0;
  padding: 2px 6px; cursor: pointer; border-radius: 6px }
.rd-tnote:hover { background: #ffffff22 }
.rd-tdel:hover { background: #b3402e }
/* the page-turn bar rides the bottom of the viewport, so forward/back is always
   under the same thumb no matter how long the chapter — settling at the foot of
   the last page. Arrow keys do the same. */
/* fixed to the foot of the viewport, so forward/back sit under the same thumb on
   every page; the controls align to the reading column inside a full-width bar */
.rd-turn { position: fixed; left: 0; right: 0; bottom: 0; z-index: 25;
  background: var(--pg); border-top: 1px solid var(--pghair);
  box-shadow: 0 -8px 24px -18px #00000066 }
.rd-turn-in { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px;
  width: 100%; max-width: 660px; margin: 0 auto; padding: 12px 22px calc(12px + env(safe-area-inset-bottom, 0px)) }
.rd-turn-btn { display: inline-flex; align-items: center; gap: 9px; font: inherit; font-size: 13px;
  color: var(--pgink2); background: none; border: 0; cursor: pointer; min-width: 0; max-width: 100%; padding: 4px 2px; justify-self: start }
.rd-turn-next { justify-self: end }
.rd-turn-btn:hover:not(:disabled) { color: var(--pgink) }
.rd-turn-btn:disabled { opacity: .3; cursor: default }
.rd-turn-arrow { flex: none; font-size: 19px; line-height: 1 }
.rd-turn-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.rd-where { font-family: var(--m); font-size: 11px; color: var(--pgink2); white-space: nowrap; text-align: center }

@media (max-width: 640px) {
  /* two rows: the title (book over chapter, centred) on top, then the back
     button hard left with every tool right-aligned beside it */
  .rd-bar { gap: 8px 10px; padding: 10px 12px;
    grid-template-columns: auto 1fr;
    grid-template-areas: "title title" "back tools" }
  .rd-title { grid-area: title; justify-self: center; flex-direction: column; gap: 2px; align-items: center }
  .rd-title b { white-space: normal; text-align: center }
  .rd-title span { display: block; max-width: 78vw }
  .rd-back { grid-area: back; justify-self: start }
  /* the tools: hidden behind the menu button; open, a sheet under the bar */
  .rd-more { display: inline-grid }
  .rd-tools { display: none }
  .rd-tools.open { display: flex; flex-direction: column; align-items: stretch; gap: 4px; position: absolute; left: 12px; right: 12px; top: calc(100% - 2px); z-index: 30;
    padding: 10px; background: var(--pg); border: 1px solid var(--pghair); border-radius: 14px; box-shadow: 0 16px 40px -18px #00000066 }
  .rd-tools.open button { width: 100%; text-align: left; font-size: 14px; padding: 10px 12px; border: 0; border-radius: 8px; display: flex; align-items: center; gap: 10px }
  .rd-tools.open .rd-mode { display: grid; grid-template-columns: 1fr 1fr; margin: 0 0 4px; padding: 3px }
  .rd-tools.open .rd-mode button { text-align: center; justify-content: center; padding: 8px 10px !important }
  .rd-tools.open .rd-ico, .rd-tools.open .rd-bm { justify-content: flex-start; width: 100% }
  .rd-tools.open .rd-ico::after, .rd-tools.open .rd-bm::after { content: attr(title); font-size: 14px }
  .rd-page { padding: 24px 16px 0 }
  .rd-veil { padding: 4vh 10px 0 }
  .rd-covmeta { gap: 14px 24px }
  .rd-turn-btn { max-width: 40% }
}

/* THE CHAPTER'S CONVERSATION, beside the page. It slides in from the right rather than opening a
   page of its own, because a reader is in the middle of reading: they should be able to look at
   what people said, say something, and carry on from the same line. */
.rdcm-veil { position: fixed; inset: 0; z-index: 120; background: rgb(0 0 0 / .32);
  display: flex; justify-content: flex-end }
.rdcm { width: min(480px, 100%); height: 100%; overflow-y: auto; background: var(--paper);
  box-shadow: -20px 0 60px -30px rgb(0 0 0 / .6); display: flex; flex-direction: column }
.rdcm-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 14px 18px; background: var(--paper); border-bottom: 1px solid var(--hair) }
.rdcm-head b { font-family: var(--fd); font-size: 15px; font-weight: 650; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.rdcm-head button { width: auto; flex: none; font: inherit; font-size: 20px; line-height: 1; color: var(--ink3);
  background: none; border: 0; padding: 2px 4px; cursor: pointer }
.rdcm-head button:hover { color: var(--ink) }
.rdcm-body { padding: 4px 18px 40px }
.rdcm-body :deep(.cmt) { margin: 0 }
/* the surface's one curve, as everywhere else that moves here */
.rdcm-enter-active, .rdcm-leave-active { transition: opacity .24s cubic-bezier(.2, .8, .2, 1) }
.rdcm-enter-active .rdcm, .rdcm-leave-active .rdcm { transition: transform .24s cubic-bezier(.2, .8, .2, 1) }
.rdcm-enter-from, .rdcm-leave-to { opacity: 0 }
.rdcm-enter-from .rdcm, .rdcm-leave-to .rdcm { transform: translateX(100%) }
@media (prefers-reduced-motion: reduce) {
  .rdcm-enter-active, .rdcm-leave-active, .rdcm-enter-active .rdcm, .rdcm-leave-active .rdcm { transition: none }
}
@media (max-width: 640px) { .rdcm { width: 100% } }
</style>
