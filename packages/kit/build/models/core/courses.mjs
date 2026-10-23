/*
 * The courses (openspec: courses): the admin's course builder. A course is a file (content/courses/<slug>.md;
 * build/courses-io.mjs is the grammar) and everything people do with it is rows. This edits the declaration — what
 * it is about, who gets in, how it is released, its cohorts, and its lessons in order, dragged into place — and the
 * projection makes the tables agree.
 *
 * The form is flatter than the file: who gets in is three fields rather than an `access` group, and each lesson's own
 * text is a field of its row rather than a `## <key>` section of the body. The grammar carries both ways.
 */
import { z } from 'zod/v4'
import matter from 'gray-matter'
import { Refusal } from '../util.mjs'
import { COURSES_DIR, KINDS, bodyParts, parseCourse, readCourses, projectCourses } from '../../courses-io.mjs'

const KIND_WORD = { text: 'Its own text', chapter: 'A book chapter', article: 'An article', form: 'A form or quiz', session: 'A session to book' }
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)))

/* a lesson as the form edits it → as the file says it */
function lessonOut(l) {
  /* the form edits one track and one download; any more the file had ride through in the row unseen (`more`) */
  const more = l.more || {}
  const track = l.video ? clean({ type: /\.(mp3|m4a|wav|ogg)(\?|$)/i.test(l.video) ? 'audio' : 'video', src: l.video, title: l.videoTitle }) : null
  const media = [...(track ? [track] : []), ...(more.media || [])]
  const downloads = [...(l.download ? [{ title: l.downloadTitle || 'Download', src: l.download }] : []), ...(more.downloads || [])]
  return clean({ key: l.key, title: l.title, section: l.section, kind: l.kind && l.kind !== 'text' ? l.kind : undefined, ref: l.kind && l.kind !== 'text' ? l.ref : undefined, required: l.required === false ? false : undefined, media: media.length ? media : undefined, downloads: downloads.length ? downloads : undefined })
}

/* every record the course builder saves, so a save cannot bend a file */
export function courseFile(d, about) {
  const lessons = (d.lessons || []).filter((l) => l && l.key)
  const fm = clean({
    title: d.title, image: d.image, position: d.position, published: d.published === false ? false : undefined,
    access: clean({ free: d.free === true ? true : undefined, skus: d.skus, tiers: d.tiers }),
    release: d.release && d.release !== 'all' ? d.release : undefined,
    drip: d.release && d.release !== 'all' && d.drip === 'section' ? 'section' : undefined,
    every: d.release && d.release !== 'all' && d.every != null ? d.every : undefined,
    inOrder: d.inOrder === true ? true : undefined, certificate: d.certificate === true ? true : undefined,
    cohorts: (d.cohorts || []).filter((c) => c && c.key).map((c) => clean({ key: c.key, starts: c.starts, space: c.space })),
    lessons: lessons.map(lessonOut),
  })
  const texts = lessons.filter((l) => (!l.kind || l.kind === 'text') && String(l.text || '').trim()).map((l) => `## ${l.key}\n\n${String(l.text).trim()}`)
  return matter.stringify([String(about || '').trim(), ...texts].filter(Boolean).join('\n\n') + '\n', fm)
}

export default {
  key: 'courses', name: 'Courses', dir: COURSES_DIR, title: 'title', module: 'courses',
  creates: true, body: true, bodyLabel: 'What the course is about',
  grammar: {
    parse: (text) => {
      const f = matter(String(text || ''))
      const d = f.data || {}, a = d.access || {}
      const { about, texts } = bodyParts(f.content)
      const lessons = (Array.isArray(d.lessons) ? d.lessons : []).map((l) => {
        const [media, ...restMedia] = Array.isArray(l.media) ? l.media : l.media ? [l.media] : []
        const [dl, ...restDl] = Array.isArray(l.downloads) ? l.downloads : []
        const more = clean({ media: restMedia, downloads: restDl })
        return clean({ key: l.key, title: l.title, section: l.section, kind: l.kind || 'text', ref: l.ref, required: l.required !== false, text: texts[l.key], video: media && media.src, videoTitle: media && media.title, download: dl && dl.src, downloadTitle: dl && dl.title, more: Object.keys(more).length ? more : undefined })
      })
      const cohorts = (Array.isArray(d.cohorts) ? d.cohorts : []).map((c) => clean({ key: c.key, starts: c.starts instanceof Date ? c.starts.toISOString().slice(0, 10) : c.starts, space: c.space }))
      return { data: clean({ title: d.title, image: d.image, position: d.position, published: d.published !== false, free: a.free === true, skus: a.skus, tiers: a.tiers, release: d.release || 'all', drip: d.drip || 'lesson', every: d.every, inOrder: d.inOrder === true, certificate: d.certificate === true, cohorts, lessons }), content: about }
    },
    serialise: (rec) => courseFile(rec.data || {}, rec.content),
  },
  prepare: (rec, ctx) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(ctx.name || '').replace(/\.md$/, ''))) throw new Refusal(400, 'the address is lower-case words joined by hyphens')
    return rec
  },
  fields: z.object({
    title: z.string().meta({ label: 'Title', grid: true }),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    image: z.string().meta({ label: 'Image', widget: 'image' }).optional(),
    position: z.number().int().meta({ label: 'Where it sits', help: 'lower comes first; 99 when blank' }).optional(),
    free: z.boolean().meta({ label: 'Free to anyone signed in' }).optional(),
    skus: z.array(z.string()).meta({ label: 'Sold as', widget: 'multiselect', options: 'products', help: 'buying any of these products gets somebody in' }).optional(),
    tiers: z.array(z.string()).meta({ label: 'Included in', widget: 'multiselect', options: 'course-tiers', help: 'members on any of these tiers get in' }).optional(),
    release: z.enum(['all', 'drip', 'cohort']).meta({ label: 'Release', widget: 'select', choices: [{ value: 'all', label: 'All at once' }, { value: 'drip', label: 'Over time, from when somebody starts' }, { value: 'cohort', label: 'Over time, from a cohort\'s start date' }] }).optional(),
    drip: z.enum(['lesson', 'section']).meta({ label: 'Each time, open', widget: 'select', choices: [{ value: 'lesson', label: 'The next lesson' }, { value: 'section', label: 'The next section' }], shown: { field: 'release', is: 'in', value: ['drip', 'cohort'] } }).optional(),
    every: z.number().int().meta({ label: 'Every (days)', help: '0 opens everything at the start', shown: { field: 'release', is: 'in', value: ['drip', 'cohort'] } }).optional(),
    inOrder: z.boolean().meta({ label: 'Each lesson waits for the one before', help: 'a lesson opens only once the required lesson before it is finished' }).optional(),
    certificate: z.boolean().meta({ label: 'A certificate on finishing' }).optional(),
    cohorts: z.array(z.object({ key: z.string(), starts: z.string(), space: z.string().optional() })).meta({ label: 'Cohorts', widget: 'rows', kind: 'list', of: 'group', fields: [{ key: 'key', label: 'Name', kind: 'text' }, { key: 'starts', label: 'Starts', kind: 'date' }, { key: 'space', label: 'Space it meets in', kind: 'reference', options: 'comment-spaces' }], help: 'somebody joins the next cohort to start', shown: { field: 'release', is: 'is', value: 'cohort' } }).optional(),
    lessons: z.array(z.object({
      key: z.string(), title: z.string(), section: z.string().optional(), kind: z.string().optional(), ref: z.string().optional(), required: z.boolean().optional(),
      text: z.string().optional(), video: z.string().optional(), videoTitle: z.string().optional(), download: z.string().optional(), downloadTitle: z.string().optional(), more: z.any().optional(),
    })).meta({ label: 'Lessons', widget: 'rows', kind: 'list', of: 'group', help: 'in order; drag to move one', fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'key', label: 'Address', kind: 'text', help: 'lower-case words joined by hyphens; keep it once people have started' },
      { key: 'section', label: 'Section', kind: 'text' },
      { key: 'kind', label: 'Lesson', kind: 'select', choices: KINDS.map((k) => ({ value: k, label: KIND_WORD[k] })) },
      { key: 'ref', label: 'Which one', kind: 'text', help: 'a chapter is <book>#<n>; an article, a form or a session type is its address', shown: { field: 'kind', is: 'in', value: ['chapter', 'article', 'form', 'session'] } },
      { key: 'text', label: 'Text', kind: 'markdown', shown: { field: 'kind', is: 'in', value: ['text', undefined, ''] } },
      { key: 'video', label: 'Video or audio', kind: 'url' },
      { key: 'videoTitle', label: 'Its title', kind: 'text' },
      { key: 'download', label: 'Download', kind: 'file' },
      { key: 'downloadTitle', label: 'Download\'s name', kind: 'text' },
      { key: 'required', label: 'Required to finish', kind: 'boolean' },
    ] }).optional(),
  }),
  checks: [
    (rec, ctx) => {
      const name = String((ctx && ctx.name) || 'course').replace(/\.md$/, '')
      return parseCourse(name, courseFile(rec.data || {}, rec.content)).problems.map((message) => ({ path: /lesson/.test(message) ? 'lessons' : /cohort/.test(message) ? 'cohorts' : /access/.test(message) ? 'free' : 'title', message }))
    },
  ],
  /* over a checkout the script writes the rows; over rows the store is holding a database, so the projection runs here */
  after: async (rec, ctx) => { if (!(ctx.store && ctx.store.kind === 'rows')) await ctx.script('courses-push.mjs').catch((e) => console.warn('courses: not projected — ' + e.message)) },
  afterRemove: async (name, ctx) => { if (!(ctx.store && ctx.store.kind === 'rows')) await ctx.script('courses-push.mjs').catch((e) => console.warn('courses: not projected — ' + e.message)) },
  projected: async (ctx) => {
    const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
    if (!db) return
    await projectCourses({ courses: await readCourses(ctx.store), db })
  },
  options: {
    /* the membership tiers this site sells, read through the store, as the teams' ways read theirs */
    'course-tiers': async (ctx) => {
      const out = []
      for (const k of await ctx.store.list('content/store/products', { ext: 'md' }).catch(() => [])) {
        const d = matter(await ctx.store.read('content/store/products/' + k.replace(/\.md$/, '') + '.md')).data || {}
        if (d.kind === 'membership' && d.tier && !out.some((o) => o.value === d.tier)) out.push({ value: String(d.tier), label: String(d.title || d.tier) })
      }
      return out
    },
  },
}
