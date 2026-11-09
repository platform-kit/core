/*
 * WHAT THE COURSE SCREENS SHARE (openspec: courses): the words, the small formatters, a course's outline gathered into
 * its modules, and the one place a course's state is asked for and kept, so moving from the overview into the player
 * and back does not ask the database twice or flash an empty page between them.
 *
 * Everything here is the database's answer for this reader (course_state, courses_list); nothing decides what is open.
 */
import { computed, reactive, defineAsyncComponent, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { kinds as SITE_KINDS } from '#site/courses'

/*
 * THE SITE'S OWN LESSON KINDS (platformkit.config.js courses.kinds): a lesson of one is played by the site's component,
 * which finishes it as a reader marks a text lesson, and a kind with a progress measure says how far the reader has come
 * in the lesson's section. The kit knows nothing of what any of them is.
 */
const players: any = {}
export const siteKind = (l: any = {}) => (l.kind && Object.hasOwn(SITE_KINDS, l.kind) ? (SITE_KINDS as any)[l.kind] : null)
export const sitePlayer = (l: any) => { const k = siteKind(l); if (!k) return null; return players[l.kind] || (players[l.kind] = defineAsyncComponent(k.load)) }
const measureOf = (v: any) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Math.round(Number(v)))))
/* the reader's measures, by lesson key, for every lesson of a measured kind: asked when the course's state arrives or
   changes, and again when `refresh` is called (a site's component says it has recorded something) */
export function useMeasures(stateOf: any) {
  const out: any = reactive<any>({})
  let asked = 0
  async function refresh() {
    const s = stateOf()
    const mine = ++asked
    const measured = ((s && s.lessons) || []).filter((l: any) => { const k = siteKind(l); return k && typeof k.progress === 'function' })
    const got = await Promise.all(measured.map(async (l: any) => { try { return measureOf(await siteKind(l).progress({ course: s.slug, lesson: l, ref: l.ref })) } catch { return null } }))
    if (mine !== asked) return
    for (const k of Object.keys(out)) delete out[k]
    measured.forEach((l: any, i: any) => { out[l.key] = got[i] })
  }
  watch(stateOf, refresh, { immediate: true })
  return { measures: out, refresh }
}

/* the words, from the theme's content/ui/courses.md */
export const words = () => {
  const W = computed(() => us('courses').page || {})
  return {
    L: computed(() => W.value.list || {}),
    K: computed(() => W.value.course || {}),
    S: computed(() => W.value.lesson || {}),
  }
}

export const fill = (t: any, m: any = {}) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
export const pct = (d: any, t: any) => (t ? Math.min(100, Math.round((100 * d) / t)) : 0)
export const day = (iso: any) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(new Date(iso)) } catch { return String(iso || '') } }
export const shortDay = (iso: any) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso)) } catch { return '' } }

/* a course's description: its first paragraph leads, the rest is the "about" further down */
const paras = (s: any) => String(s || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
export const leadOf = (s: any) => (paras(s)[0] || '').replace(/[#*_>`]/g, '')
export const restOf = (s: any) => paras(s).slice(1).join('\n\n')

/* the outline, numbered and gathered under its modules in order, each knowing how much of it is done */
/* WHERE A LESSON STANDS, as the curriculum shows it (openspec: courses): a quiz passed (with its score), a quiz tried and
   not passed yet (with its best), done, open or closed. The icon follows: a not-passed quiz has its own. */
export const stateOf = (l: any = {}) => {
  const quiz = l.kind === 'form' && l.quiz && l.quiz.total ? l.quiz : null
  if (l.done) return quiz ? 'passed' : 'done'
  if (quiz && quiz.passed === false) return 'failed'
  return l.open ? 'open' : 'closed'
}
export const markOf = (l: any) => ({ passed: 'done', done: 'done', failed: 'missed', open: 'open', closed: 'closed' })[stateOf(l)]

export function modulesOf(lessons = [], measures: any = {}) {
  const out: any = []
  lessons.forEach((l: any, i) => {
    const row = { ...l, n: i + 1 }
    const last: any = out[out.length - 1]
    if (last && last.name === (l.section || '')) last.lessons.push(row)
    else out.push({ name: l.section || '', n: out.length + 1, lessons: [row] })
  })
  for (const m of out) {
    const req = m.lessons.filter((l: any) => l.required)
    m.total = req.length
    m.done = req.filter((l: any) => l.done).length
    m.open = m.lessons.some((l: any) => l.open)
    m.opensAt = m.open ? null : (m.lessons.find((l: any) => l.why === 'not-yet' && l.opens_at) || {}).opens_at || null
    m.finished = m.total > 0 && m.done === m.total
    /* the section's quiz, where it has one, and how it stands */
    m.quiz = m.lessons.find((l: any) => l.kind === 'form' && l.required && l.quiz && l.quiz.total) || null
    m.quizState = m.quiz ? stateOf(m.quiz) : null
    /* a section holding a lesson of a measured site kind shows that measure, not lessons done: null until there is one */
    const gauge = m.lessons.find((l: any) => { const k = siteKind(l); return k && typeof k.progress === 'function' })
    m.measured = !!gauge
    m.measure = gauge ? (measures[gauge.key] ?? null) : null
  }
  return out
}

/* what a lesson is, as one icon and one word: a video or audio it carries, else what kind it is */
export function kindOf(l: any = {}) {
  const has = l.has || []
  if (l.kind === 'text') return has.includes('video') ? 'video' : has.includes('audio') ? 'audio' : 'text'
  const own = siteKind(l)
  if (own) return own.icon || 'form'
  return l.kind || 'text'
}

/* the next thing to do, and the next thing that will open */
export const nextOpen = (lessons = [], after = -1) => lessons.find((l: any, i) => i > after && l.open && !l.done) || lessons.find((l: any) => l.open && !l.done) || null
export const nextOpening = (lessons = []) => lessons.find((l: any) => !l.open && l.why === 'not-yet' && l.opens_at) || null

/* how the course releases its lessons, in a line */
export function cadenceOf(s: any = {}, K: any = {}) {
  if (s.release === 'all' || !s.every_days) return K['all-at-once']
  if (s.drip === 'section') return fill(K['every-section'], { n: s.every_days })
  return s.every_days === 1 ? K['every-day'] : fill(K['every-days'], { n: s.every_days })
}

/* a lesson that points at something the site already has, and where that is */
export function pointerHref(l: any = {}) {
  const ref = String(l.ref || '')
  if (l.kind === 'chapter') { const [book, n] = ref.split('#'); return `/content/books/${book}${n ? `?chapter=${n}` : ''}` }
  return ({ article: '/content/articles/', form: '/form/', session: '/book/' } as any)[l.kind] + ref
}

export const rpc = async (fn: any, args?: any) => {
  if (!supabase) return null
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

/* THE COURSE STATES THIS READER HAS SEEN, by slug: shown at once when a screen comes back to one, then asked again */
const states: any = reactive<any>({})
export const courseState = (slug: any) => states[slug] || null
export async function loadCourse(slug: any) {
  const s = await rpc('course_state', { p_course: slug })
  states[slug] = s
  return s
}
export const keepCourse = (slug: any, s: any) => { if (s && s.slug) states[slug] = s }
export const forgetCourses = () => { for (const k of Object.keys(states)) delete states[k] }
