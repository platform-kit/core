/*
 * A COURSE, as a file — the grammar, shared by the push, the admin's model and the tests (openspec: courses).
 *
 *   content/courses/<slug>.md
 *
 * Its frontmatter: `title`, `image`, `position`, `published`, `access` (`free: true` for anyone signed in, `skus`
 * bought in the store, `tiers` a membership includes), `release` (all · drip · cohort), `drip` (lesson · section:
 * what opens each time), `every` (days between them), `inOrder` (each lesson waits for the required one before it),
 * `certificate`, `cohorts` (each a `key`, a `starts` date and the `space` it meets in) and `lessons`, in order.
 *
 * A lesson is a `key`, a `title`, its `section`, whether it is `required` (it is, unless it says not) and its `kind`:
 *   text      its own words: the section of the body headed `## <key>`, with `media` (video or audio) and `downloads`
 *   chapter   a book's chapter: `ref: <book>#<n>`, the nth chapter counted from 1
 *   article   an article: `ref: <slug>`
 *   form      a form or quiz: `ref: <slug>`; finished when the reader has answered it (and passed, where it is scored)
 *   session   a booking type: `ref: <slug>`; finished when the reader has booked one
 *
 * The body before the first `## ` heading is what the course is about. A file says what exists and the push makes the
 * database agree; nothing reads a row back into a file. A course whose file has gone is unpublished, never deleted:
 * people's enrolments, progress and certificates hang off it.
 */
import matter from 'gray-matter'
import { asStore } from './store/index.mjs'

export const COURSES_DIR = 'content/courses'
export const KINDS = ['text', 'chapter', 'article', 'form', 'session']
export const RELEASES = ['all', 'drip', 'cohort']
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => String(x).trim()).filter(Boolean)
const dateOf = (v) => { const d = v instanceof Date ? v : new Date(String(v || '')); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

/* the body, split: what the course is about, and each text lesson's words by its key */
export function bodyParts(body) {
  const parts = String(body || '').split(/^## +/m)
  const about = parts.shift().trim()
  const texts = {}
  for (const p of parts) { const nl = p.indexOf('\n'); const key = (nl < 0 ? p : p.slice(0, nl)).trim(); texts[key] = nl < 0 ? '' : p.slice(nl + 1).trim() }
  return { about, texts }
}

/* where a lesson that points at something sends the reader */
export function lessonHref(l) {
  const ref = String(l.ref || '')
  if (l.kind === 'chapter') { const [book, n] = ref.split('#'); return `/content/books/${book}${n ? `?chapter=${n}` : ''}` }
  if (l.kind === 'article') return `/content/articles/${ref}`
  if (l.kind === 'form') return `/form/${ref}`
  if (l.kind === 'session') return `/book/${ref}`
  return null
}

/* a course's file, parsed, with every problem in it named — a course with problems is not pushed */
export function parseCourse(slug, raw) {
  const f = matter(String(raw || ''))
  const d = f.data || {}
  const problems = []
  if (!SLUG.test(slug)) problems.push(`"${slug}" is not a course address: lowercase words joined by hyphens`)
  const title = String(d.title || '').trim()
  if (!title) problems.push('it has no title')
  const release = d.release == null ? 'all' : String(d.release)
  if (!RELEASES.includes(release)) problems.push(`release is ${release}; it is one of ${RELEASES.join(', ')}`)
  const drip = d.drip === 'section' ? 'section' : 'lesson'
  const every = d.every == null ? 7 : Number(d.every)
  if (!Number.isInteger(every) || every < 0) problems.push('every is a whole number of days')
  const a = d.access && typeof d.access === 'object' ? d.access : {}
  const access = { free: a.free === true, skus: list(a.skus), tiers: list(a.tiers) }
  if (!access.free && !access.skus.length && !access.tiers.length) problems.push('access says nobody: set free, skus or tiers')
  const cohorts = (Array.isArray(d.cohorts) ? d.cohorts : []).map((c, i) => {
    const key = String((c && c.key) || '').trim(), starts_on = dateOf(c && c.starts)
    if (!SLUG.test(key)) problems.push(`cohort ${i + 1} has no key`)
    if (!starts_on) problems.push(`cohort ${key || i + 1} has no starts date`)
    return { key, starts_on, space: c && c.space ? String(c.space) : null }
  })
  if (release === 'cohort' && !cohorts.length) problems.push('release is cohort and there are no cohorts')
  const { about, texts } = bodyParts(f.content)
  const seen = new Set()
  const lessons = (Array.isArray(d.lessons) ? d.lessons : []).map((l, i) => {
    const key = String((l && l.key) || '').trim()
    const kind = l && l.kind ? String(l.kind) : 'text'
    if (!SLUG.test(key)) problems.push(`lesson ${i + 1} has no key`)
    else if (seen.has(key)) problems.push(`lesson ${key} is there twice`)
    seen.add(key)
    if (!KINDS.includes(kind)) problems.push(`lesson ${key}: kind is ${kind}; it is one of ${KINDS.join(', ')}`)
    const ref = l && l.ref != null ? String(l.ref).trim() : null
    if (kind !== 'text' && !ref) problems.push(`lesson ${key} is a ${kind} and names none (ref)`)
    if (kind === 'chapter' && ref && !/^[a-z0-9-]+#\d+$/.test(ref)) problems.push(`lesson ${key}: a chapter is <book>#<n>, not ${ref}`)
    return {
      key, position: i + 1, section: l && l.section ? String(l.section) : null,
      title: String((l && l.title) || key).trim(), kind, ref,
      body: kind === 'text' ? (texts[key] ?? '') : null,
      /* what plays beside it (video or audio, the shape a page's featured media has) and what it offers to download */
      media: [...(Array.isArray(l && l.media) ? l.media : l && l.media ? [l.media] : []), ...(Array.isArray(l && l.downloads) ? l.downloads : []).map((x) => ({ type: 'file', src: String(x.src || ''), title: String(x.title || '') }))].filter((m) => m && m.src),
      required: !(l && l.required === false),
    }
  })
  if (!lessons.length) problems.push('it has no lessons')
  return {
    slug, title, about: about || null, image: d.image ? String(d.image) : null,
    position: Number.isFinite(Number(d.position)) ? Number(d.position) : 99,
    published: d.published !== false,
    access, release, drip, every_days: Number.isInteger(every) && every >= 0 ? every : 7,
    in_order: d.inOrder === true, certificate: d.certificate === true,
    cohorts, lessons, problems,
  }
}

export async function readCourses(store) {
  const st = asStore(store)
  const names = (await st.list(COURSES_DIR, { ext: 'md' })).filter((n) => !n.includes('/'))
  const out = []
  for (const n of names.sort()) { const slug = n.replace(/\.md$/, ''); out.push(parseCourse(slug, await st.read(`${COURSES_DIR}/${slug}.md`))) }
  return out
}

/*
 * THE DECLARATION, MADE REAL. Each course upserted by its slug, its lessons and cohorts made to match exactly, and a
 * course whose file has gone unpublished. A course with problems is left as it was, and named.
 */
export async function projectCourses({ courses, db }) {
  const out = { courses: 0, lessons: 0, unpublished: 0, refused: [] }
  const ok = courses.filter((c) => { if (c.problems.length) out.refused.push(`${c.slug}: ${c.problems.join('; ')}`); return !c.problems.length })
  const must = (r, what) => { if (r.error) throw new Error(`courses: ${what} — ${r.error.message}`); return r }
  for (const c of ok) {
    must(await db.from('courses').upsert({
      slug: c.slug, title: c.title, about: c.about, image: c.image, position: c.position, published: c.published,
      access: c.access, release: c.release, drip: c.drip, every_days: c.every_days, in_order: c.in_order, certificate: c.certificate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' }), `${c.slug} not written`)
    const keys = c.lessons.map((l) => l.key)
    must(await db.from('course_lessons').delete().eq('course', c.slug).not('key', 'in', `(${keys.map((k) => `"${k}"`).join(',')})`), `${c.slug}'s old lessons not removed`)
    must(await db.from('course_lessons').upsert(c.lessons.map((l) => ({ course: c.slug, ...l })), { onConflict: 'course,key' }), `${c.slug}'s lessons not written`)
    must(await db.from('course_cohorts').delete().eq('course', c.slug), `${c.slug}'s cohorts not cleared`)
    if (c.cohorts.length) must(await db.from('course_cohorts').insert(c.cohorts.map((h) => ({ course: c.slug, ...h }))), `${c.slug}'s cohorts not written`)
    out.courses++; out.lessons += c.lessons.length
  }
  const declared = new Set(courses.map((c) => c.slug))
  const { data: rows } = must(await db.from('courses').select('slug, published'), 'the courses not read')
  for (const r of rows || []) if (!declared.has(r.slug) && r.published) { must(await db.from('courses').update({ published: false }).eq('slug', r.slug), `${r.slug} not unpublished`); out.unpublished++ }
  return out
}
