<script setup>
/*
 * A chapter's quiz, run by the same Typeform runner as the diagnostic: an intro
 * screen, one choice screen per question (options shuffled once), and a result
 * screen that scores it, records the attempt for the book's trophy, and offers
 * the next chapter or another go. Number keys answer, as in the instrument.
 * Loaded on demand from the reader, so a book page never pays for it until a
 * quiz is opened.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Typeform from '../../instrument/ui/Typeform.vue'
import '../../instrument/ui/instrument.css'
import { us } from 'platformkit/lib/content.js'
import { recordAttempt, passMark } from 'platformkit/lib/mastery.js'
import Trophy from '../Trophy.vue'
import { capture } from 'platformkit/lib/analytics.js'

const props = defineProps({
  slug: { type: String, required: true },
  chapter: { type: Object, required: true },   /* { title, quiz: [{ q, options, answer, why }] } */
  nextTitle: { type: String, default: '' },
})
const emit = defineEmits(['close', 'next'])
const Q = us('library').reader.quiz
const T = us('library').trophy.tier

/* the questions, each with its options shuffled once so the answer's position tells nothing */
const shuffled = (arr) => { const a = arr.map((v, i) => ({ v, i })); for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]] } return a }
const questions = props.chapter.quiz.map((q, n) => ({ ...q, n, order: shuffled(q.options) }))
const answers = ref({})   /* n → chosen original index */
const result = ref(null)
const runner = ref(null)
const progress = ref(0)

const need = passMark(questions.length)
const screens = computed(() => {
  const intro = { id: 'intro', kind: 'info', label: props.chapter.title, eyebrow: Q['intro-eyebrow'], headline: props.chapter.title,
    body: String(Q['intro-body'] || '').replace('{n}', questions.length).replace('{need}', need), options: [{ v: 'go', label: Q['intro-begin'] }] }
  const qs = questions.map((q) => ({ id: 'q:' + q.n, kind: 'choice', label: props.chapter.title, eyebrow: (q.n + 1) + ' ' + Q.of + ' ' + questions.length,
    headline: q.q, options: q.order.map((o) => ({ v: o.i, label: o.v })), meta: { n: q.n } }))
  return [intro, ...qs]
})
function onAnswer(screen, value) {
  if (screen.meta && typeof screen.meta.n === 'number') answers.value[screen.meta.n] = value
}
function onComplete() {
  const correct = questions.filter((q) => answers.value[q.n] === q.answer).length
  const r = recordAttempt(props.slug, props.chapter.title, correct, questions.length)
  result.value = { ...r, review: questions.map((q) => ({ q: q.q, right: answers.value[q.n] === q.answer, answer: q.options[q.answer], why: q.why })) }
  capture('book_quiz', { slug: props.slug, chapter: props.chapter.title, correct, total: questions.length, passed: r.passed, tier: r.tier || null })
}
/* a fresh round: new shuffles, the runner sees a new list */
const round = ref(0)
function again() { for (const q of questions) q.order = shuffled(q.options); answers.value = {}; result.value = null; round.value++ }

/* the number keys, as the instrument's shell forwards them */
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return
  if (e.key >= '1' && e.key <= '9' && runner.value && !result.value) runner.value.key(+e.key)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="qz bq">
    <div class="qzbar">
      <span class="lbl">{{ chapter.title }}</span>
      <span class="qzprog" aria-hidden="true"><i :style="{ width: (result ? 100 : progress * 100) + '%' }" /></span>
      <button type="button" class="qzicon" :aria-label="Q.back" :title="Q.back" @click="emit('close')">×</button>
    </div>
    <div class="qzstage">
      <div v-if="!result" :key="round" class="bq-run">
        <Typeform ref="runner" :screens="screens" :title="chapter.title" @answer="onAnswer" @complete="onComplete" @progress="progress = $event" />
      </div>
      <div v-else class="qzin bq-result">
        <span class="eyeb">{{ Q['intro-eyebrow'] }}</span>
        <h3 class="qh">{{ result.passed ? Q['result-passed'] : Q['result-not-yet'] }}</h3>
        <p class="qsay">{{ result.correct }} {{ Q.of }} {{ result.total }} {{ Q['result-score'] }}<template v-if="result.earned"> · {{ Q.earned }} <Trophy :tier="result.earned" :size="26" /> {{ T[result.earned] }}</template></p>
        <ol class="bq-review">
          <li v-for="(r, i) in result.review" :key="i" :class="{ right: r.right }">
            <b>{{ r.q }}</b>
            <span v-if="!r.right" class="bq-ans">{{ r.answer }}</span>
            <em v-if="r.why">{{ r.why }}</em>
          </li>
        </ol>
        <div class="qopts">
          <button v-if="!result.passed" type="button" class="qopt" @click="again"><span class="k">1</span><span class="qoptl">{{ Q.again }}</span></button>
          <button v-if="nextTitle" type="button" class="qopt" @click="emit('next')"><span class="k">{{ result.passed ? 1 : 2 }}</span><span class="qoptl">{{ Q['next-chapter'] }} <span class="qopts2">{{ nextTitle }}</span></span></button>
          <button type="button" class="qopt" @click="emit('close')"><span class="k">{{ (result.passed ? 1 : 2) + (nextTitle ? 1 : 0) }}</span><span class="qoptl">{{ Q.back }}</span></button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bq { margin: 26px 0 60px }
.bq-run { width: 100% }
.bq-review { list-style: none; margin: 18px 0 22px; padding: 0; display: flex; flex-direction: column; gap: 10px; text-align: left; max-width: 560px }
.bq-review li { padding: 10px 14px; border-radius: 12px; border: 1px solid var(--qhair); font-size: 14px; line-height: 1.45 }
.bq-review li.right { border-color: #05966955; background: #05966912 }
.bq-review b { display: block; font-weight: 600 }
.bq-ans { display: block; margin-top: 4px; color: #b45309 }
.bq-review em { display: block; margin-top: 4px; font-style: normal; font-size: 13px; color: var(--qink3) }
</style>
