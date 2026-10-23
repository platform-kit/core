/*
 * WHAT THE COURSE SCREENS SHARE (openspec: courses): the words, the small formatters, a course's outline gathered into
 * its modules, and the one place a course's state is asked for and kept, so moving from the overview into the player
 * and back does not ask the database twice or flash an empty page between them.
 *
 * Everything here is the database's answer for this reader (course_state, courses_list); nothing decides what is open.
 */
import { computed, reactive } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'

/* the words, from the theme's content/ui/courses.md */
export const words = () => {
  const W = computed(() => us('courses').page || {})
  return {
    L: computed(() => W.value.list || {}),
    K: computed(() => W.value.course || {}),
    S: computed(() => W.value.lesson || {}),
  }
}

export const fill = (t, m = {}) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
export const pct = (d, t) => (t ? Math.min(100, Math.round((100 * d) / t)) : 0)
export const day = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(new Date(iso)) } catch { return String(iso || '') } }
export const shortDay = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso)) } catch { return '' } }

/* a course's description: its first paragraph leads, the rest is the "about" further down */
const paras = (s) => String(s || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
export const leadOf = (s) => (paras(s)[0] || '').replace(/[#*_>`]/g, '')
export const restOf = (s) => paras(s).slice(1).join('\n\n')

/* the outline, numbered and gathered under its modules in order, each knowing how much of it is done */
export function modulesOf(lessons = []) {
  const out = []
  lessons.forEach((l, i) => {
    const row = { ...l, n: i + 1 }
    const last = out[out.length - 1]
    if (last && last.name === (l.section || '')) last.lessons.push(row)
    else out.push({ name: l.section || '', n: out.length + 1, lessons: [row] })
  })
  for (const m of out) {
    const req = m.lessons.filter((l) => l.required)
    m.total = req.length
    m.done = req.filter((l) => l.done).length
    m.open = m.lessons.some((l) => l.open)
    m.opensAt = m.open ? null : (m.lessons.find((l) => l.why === 'not-yet' && l.opens_at) || {}).opens_at || null
    m.finished = m.total > 0 && m.done === m.total
  }
  return out
}

/* what a lesson is, as one icon and one word: a video or audio it carries, else what kind it is */
export function kindOf(l = {}) {
  const has = l.has || []
  if (l.kind === 'text') return has.includes('video') ? 'video' : has.includes('audio') ? 'audio' : 'text'
  return l.kind || 'text'
}

/* the next thing to do, and the next thing that will open */
export const nextOpen = (lessons = [], after = -1) => lessons.find((l, i) => i > after && l.open && !l.done) || lessons.find((l) => l.open && !l.done) || null
export const nextOpening = (lessons = []) => lessons.find((l) => !l.open && l.why === 'not-yet' && l.opens_at) || null

/* how the course releases its lessons, in a line */
export function cadenceOf(s = {}, K = {}) {
  if (s.release === 'all' || !s.every_days) return K['all-at-once']
  if (s.drip === 'section') return fill(K['every-section'], { n: s.every_days })
  return s.every_days === 1 ? K['every-day'] : fill(K['every-days'], { n: s.every_days })
}

/* a lesson that points at something the site already has, and where that is */
export function pointerHref(l = {}) {
  const ref = String(l.ref || '')
  if (l.kind === 'chapter') { const [book, n] = ref.split('#'); return `/content/books/${book}${n ? `?chapter=${n}` : ''}` }
  return { article: '/content/articles/', form: '/form/', session: '/book/' }[l.kind] + ref
}

export const rpc = async (fn, args) => {
  if (!supabase) return null
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

/* THE COURSE STATES THIS READER HAS SEEN, by slug: shown at once when a screen comes back to one, then asked again */
const states = reactive({})
export const courseState = (slug) => states[slug] || null
export async function loadCourse(slug) {
  const s = await rpc('course_state', { p_course: slug })
  states[slug] = s
  return s
}
export const keepCourse = (slug, s) => { if (s && s.slug) states[slug] = s }
export const forgetCourses = () => { for (const k of Object.keys(states)) delete states[k] }
