<script setup>
/*
 * A book's companion, edited as what it is rather than as markdown: the book's
 * chapters down the side (the companion may only speak of those — a title is
 * never typed here, it is the book's), and for the open chapter three tabs —
 * the Summary as prose in the markdown editor, the Essence as a list of lines,
 * the Quiz as questions with exactly four options and one right answer. What
 * leaves here is the body in its one canonical grammar (src/lib/companion-body.js,
 * the same code the build parses with), so the file can never be bent out of
 * shape by hand. A chapter the book no longer has is shown apart and can only be
 * removed. Nothing is saved until the drawer's Save.
 */
import pipe from '../../lib/admin/api.js'
import { ref, computed, watch } from 'vue'
import MarkdownEditor from './MarkdownEditor.vue'
import LineList from './LineList.vue'
import { parseCompanionBody, serialiseCompanionBody, bookChapterTitles } from '@platform-kit/kit/lib/companion-body.js'

const props = defineProps({
  modelValue: { type: String, default: '' },   /* the body markdown */
  book: { type: String, default: '' },         /* the book's slug, from the drawer's Book field */
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'chapters'])

/* ---- the book's chapters, by title, in the book's order ---- */
const bookTitles = ref(null)   /* null until known; [] when the book cannot be read */
watch(() => props.book, async (slug) => {
  bookTitles.value = null
  if (!slug) { bookTitles.value = []; return }
  try { const f = await pipe.read('books', slug); bookTitles.value = bookChapterTitles(f.content || '') }
  catch (e) { bookTitles.value = [] }
}, { immediate: true })

/* ---- the companion's chapters, hydrated from the body and written back as one string ---- */
let ids = 0
const chapters = ref([])   /* [{ id, title, summaryMd, essence, quiz }] */
let lastEmitted = null
function hydrate(md) {
  if (md === lastEmitted) return
  chapters.value = parseCompanionBody(md).chapters.map((c) => ({ id: ++ids, ...c }))
  emit('chapters', chapters.value.length)
}
watch(() => props.modelValue, hydrate, { immediate: true })
function emitAll() {
  lastEmitted = serialiseCompanionBody(chapters.value)
  emit('update:modelValue', lastEmitted)
  emit('chapters', chapters.value.length)
}
watch(chapters, emitAll, { deep: true })

/* the rail: every chapter of the book, written or not, then any the book no longer has */
const byTitle = computed(() => { const m = new Map(); for (const c of chapters.value) m.set(c.title, c); return m })
const rail = computed(() => {
  const titles = bookTitles.value || chapters.value.map((c) => c.title)
  const rows = titles.map((t, i) => ({ n: i + 1, title: t, chapter: byTitle.value.get(t) || null, stray: false }))
  if (bookTitles.value) for (const c of chapters.value) if (!bookTitles.value.includes(c.title)) rows.push({ n: null, title: c.title, chapter: c, stray: true })
  return rows
})
const written = computed(() => rail.value.filter((r) => r.chapter && !r.stray).length)
const total = computed(() => (bookTitles.value || []).length)

/* the open chapter: a title of the book's; opening one not yet written makes it, empty */
const activeTitle = ref('')
const active = computed(() => byTitle.value.get(activeTitle.value) || null)
function open(row) {
  if (!row.chapter) chapters.value.push({ id: ++ids, title: row.title, summaryMd: '', essence: [], quiz: [] })
  activeTitle.value = row.title
}
watch(rail, (rows) => { if (!activeTitle.value || !rows.some((r) => r.title === activeTitle.value)) { const first = rows.find((r) => r.chapter) || rows[0]; if (first) activeTitle.value = first.title } }, { immediate: true })
function removeChapter(c) {
  if (!confirm(`Remove the companion's “${c.title}” — its summary, essence and quiz?`)) return
  chapters.value.splice(chapters.value.indexOf(c), 1)
}
const activeIndex = computed(() => rail.value.findIndex((r) => r.title === activeTitle.value))

/* ---- the three parts ---- */
const TABS = [['summary', 'Summary'], ['essence', 'Essence'], ['quiz', 'Quiz']]
const tab = ref('summary')
const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length
const countOf = (c, k) => !c ? 0 : k === 'summary' ? words(c.summaryMd) : k === 'essence' ? c.essence.length : c.quiz.length
const unit = { summary: 'w', essence: '', quiz: '' }

/* a question: four options, always, and one of them right */
const blankQ = () => ({ q: '', options: ['', '', '', ''], answer: 0, why: '' })
function addQuestion() { active.value.quiz.push(blankQ()) }
function removeQuestion(i) { const x = active.value.quiz[i]; if (!x.q.trim() && x.options.every((o) => !o.trim()) || confirm('Remove this question?')) active.value.quiz.splice(i, 1) }
function moveQuestion(i, d) { const q = active.value.quiz; const j = i + d; if (j < 0 || j >= q.length) return; const [m] = q.splice(i, 1); q.splice(j, 0, m) }
/* what is still missing on a question, said beside it rather than refused at save */
/* a text field that grows with its text: one line until there is more */
const fit = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
const vAutosize = { mounted: fit, updated: fit }
const qNote = (x) => { const empty = x.options.filter((o) => !o.trim()).length; return !x.q.trim() ? 'needs a question' : empty ? `${empty} option${empty === 1 ? '' : 's'} empty` : !(x.options[x.answer] || '').trim() ? 'the right answer is empty' : '' }
</script>

<template>
  <div class="co" :class="{ compact }">
    <aside class="co-toc">
      <div class="co-tochead"><span>Chapters</span><span v-if="bookTitles" class="co-tocn">{{ written }} / {{ total }}</span></div>
      <div class="co-list">
        <template v-for="r in rail" :key="r.title">
          <div v-if="r.stray && rail.indexOf(r) > 0 && !rail[rail.indexOf(r) - 1].stray" class="co-strayhead">Not in the book</div>
          <button type="button" class="co-item" :class="{ on: r.title === activeTitle, blank: !r.chapter, stray: r.stray }" @click="open(r)">
            <span class="co-n">{{ r.n ?? '!' }}</span>
            <span class="co-title">{{ r.title }}</span>
            <span class="co-meta"><template v-if="r.chapter">{{ words(r.chapter.summaryMd) }} w · {{ r.chapter.essence.length }} · {{ r.chapter.quiz.length }} q</template><template v-else>not written</template></span>
          </button>
        </template>
      </div>
      <div v-if="!book" class="co-tocfoot">Choose the book first.</div>
      <div v-else-if="bookTitles && !total" class="co-tocfoot">The book has no chapters yet.</div>
    </aside>

    <div class="co-main">
      <template v-if="active">
        <div class="co-head">
          <div class="co-headl">
            <span class="co-label">{{ rail[activeIndex] && rail[activeIndex].stray ? 'Not a chapter of the book' : 'Chapter ' + (activeIndex + 1) + (total ? ' of ' + total : '') }}</span>
            <h3 class="co-h">{{ active.title }}</h3>
          </div>
          <button v-if="rail[activeIndex] && rail[activeIndex].stray" type="button" class="co-rm" @click="removeChapter(active)">Remove</button>
        </div>
        <div class="co-tabs" role="tablist">
          <button v-for="[k, label] in TABS" :key="k" type="button" role="tab" :class="{ on: tab === k }" :aria-selected="tab === k" @click="tab = k">{{ label }}<span class="co-tabn">{{ countOf(active, k) }}{{ unit[k] }}</span></button>
        </div>

        <!-- summary: prose -->
        <div v-if="tab === 'summary'" class="co-pane co-summary">
          <MarkdownEditor :key="active.id" v-model="active.summaryMd" prose />
        </div>

        <!-- essence: lines that stand alone -->
        <div v-else-if="tab === 'essence'" class="co-pane">
          <p class="co-hint">The key insights, one a line, each standing on its own.</p>
          <LineList v-model="active.essence" multiline placeholder="An insight, in a sentence" add-label="+ Insight" />
        </div>

        <!-- quiz: questions, four options, one right -->
        <div v-else class="co-pane">
          <p class="co-hint">Four options each; choose the right one. A note under the question says why.</p>
          <div v-for="(x, i) in active.quiz" :key="i" class="co-q">
            <div class="co-qhead">
              <span class="co-qn">{{ i + 1 }}</span>
              <textarea v-model="x.q" v-autosize class="co-qtext" rows="1" placeholder="The question" @input="fit($event.target)" />
              <span class="co-qtools">
                <button type="button" class="co-qbtn" title="Move up" :disabled="i === 0" @click="moveQuestion(i, -1)">↑</button>
                <button type="button" class="co-qbtn" title="Move down" :disabled="i === active.quiz.length - 1" @click="moveQuestion(i, 1)">↓</button>
                <button type="button" class="co-qbtn co-qrm" title="Remove question" @click="removeQuestion(i)">×</button>
              </span>
            </div>
            <div class="co-opts">
              <label v-for="(o, j) in x.options" :key="j" class="co-opt" :class="{ right: x.answer === j }">
                <input type="radio" :name="'q' + active.id + '-' + i" :checked="x.answer === j" title="The right answer" @change="x.answer = j" />
                <textarea v-model="x.options[j]" v-autosize rows="1" :placeholder="'Option ' + 'ABCD'[j]" @input="fit($event.target)" />
              </label>
            </div>
            <textarea v-model="x.why" v-autosize rows="1" class="co-why" placeholder="Why (optional) — shown after answering" @input="fit($event.target)" />
            <em v-if="qNote(x)" class="co-qnote">{{ qNote(x) }}</em>
          </div>
          <button type="button" class="co-add" @click="addQuestion">+ Question</button>
        </div>
      </template>
      <p v-else class="co-empty">{{ bookTitles === null ? 'Reading the book…' : 'Pick a chapter to write its companion.' }}</p>
    </div>
  </div>
</template>

<style scoped>
.co { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; height: 100%; border: 1px solid var(--hair); border-radius: 12px; overflow: hidden; background: var(--paper) }
.co.compact { grid-template-columns: 220px minmax(0, 1fr) }
.co-toc { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--hair); background: var(--wash) }
.co-tochead { display: flex; justify-content: space-between; font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); padding: 12px 14px 8px }
.co-tocn { letter-spacing: 0 }
.co-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 6px }
.co-strayhead { font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #b3261e; padding: 12px 8px 4px }
.co-item { display: grid; grid-template-columns: 22px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; align-items: center; width: 100%; text-align: left; font: inherit; padding: 7px 8px; border-radius: 8px; cursor: pointer; color: var(--ink2); background: none; border: 0 }
.co-item:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.co-item.on { background: var(--paper); color: var(--ink); box-shadow: 0 1px 0 var(--hair), 0 0 0 1px var(--hair) }
.co-item.blank .co-title { color: var(--ink3); font-weight: 400 }
.co-item.stray .co-n { color: #b3261e }
.co-n { grid-row: 1 / span 2; font-family: var(--m); font-size: 11px; color: var(--ink3); text-align: right }
.co-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.co-meta { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.co-item.blank .co-meta { font-style: italic }
.co-tocfoot { font-size: 12px; color: var(--ink3); padding: 10px 14px; border-top: 1px solid var(--hair) }
.co-main { display: flex; flex-direction: column; min-height: 0; padding: 14px 18px 16px; overflow-y: auto }
.co-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 0 0 10px }
.co-headl { display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.co-label { font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3) }
.co-h { font-family: var(--fd); font-size: 20px; font-weight: 600; color: var(--ink); margin: 0 }
.co-rm { font: inherit; font-size: 12px; color: #b3261e; background: none; border: 1px solid #b3261e55; border-radius: 999px; padding: 4px 10px; cursor: pointer }
.co-tabs { display: inline-flex; gap: 2px; padding: 3px; margin: 0 0 12px; background: var(--wash); border: 1px solid var(--hair); border-radius: 10px; align-self: flex-start }
.co-tabs button { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 13px; font-weight: 500; color: var(--ink3); background: none; border: 0; border-radius: 7px; padding: 6px 13px; cursor: pointer }
.co-tabs button:hover { color: var(--ink) }
.co-tabs button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px #0000001a, 0 0 0 1px var(--hair) }
.co-tabn { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.co-pane { display: flex; flex-direction: column; gap: 10px; min-height: 0 }
.co-summary { flex: 1 }
.co-summary :deep(.md) { flex: 1; min-height: 0 }
.co-hint { font-size: 12px; color: var(--ink3); margin: 0 }
.co-q { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 10px; background: var(--wash) }
.co-qhead { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: start }
.co-qn { font-family: var(--m); font-size: 12px; color: var(--ink3); padding-top: 8px; text-align: right }
.co-qtext { font: inherit; font-size: 14px; font-weight: 500; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 7px 10px; resize: none; line-height: 1.4; min-height: 34px }
.co-qtools { display: flex; gap: 2px }
.co-qbtn { width: 26px; height: 26px; font: inherit; font-size: 13px; color: var(--ink3); background: none; border: 1px solid transparent; border-radius: 6px; cursor: pointer }
.co-qbtn:hover:not(:disabled) { color: var(--ink); border-color: var(--hair); background: var(--paper) }
.co-qbtn:disabled { opacity: .3; cursor: default }
.co-qrm:hover:not(:disabled) { color: #b3261e }
.co-opts { display: grid; grid-template-columns: 1fr; gap: 6px; padding-left: 30px }
.co-opt { display: flex; align-items: flex-start; gap: 8px; padding: 0 8px 0 10px; background: var(--paper); border: 1px solid var(--hair); border-radius: 8px }
.co-opt.right { border-color: #0b6e4f88; background: #0b6e4f0d }
.co-opt input[type=radio] { accent-color: #0b6e4f; margin: 10px 0 0; flex: none }
.co-opt textarea { flex: 1; min-width: 0; font: inherit; font-size: 13px; line-height: 1.4; color: var(--ink); background: none; border: 0; padding: 7px 0; resize: none; min-height: 32px }
.co-opt textarea:focus, .co-qtext:focus, .co-why:focus { outline: none }
.co-qtext:focus, .co-why:focus { border-color: var(--accent2) }
.co-why { font: inherit; font-size: 12.5px; line-height: 1.4; color: var(--ink2); background: var(--paper); border: 1px dashed var(--hair); border-radius: 8px; padding: 7px 10px; margin-left: 30px; resize: none; min-height: 32px }
.co-qnote { font-size: 11.5px; color: #b45309; font-style: normal; margin-left: 30px }
.co-add { align-self: flex-start; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; cursor: pointer }
.co-add:hover { border-color: var(--ink3) }
.co-empty { font-size: 13px; color: var(--ink3); margin: 0 }
</style>
