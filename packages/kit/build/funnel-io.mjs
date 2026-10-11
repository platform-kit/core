/*
 * Funnels and blasts are markdown, and this is their grammar — read and written here for
 * velite's sake (they are not a velite collection: nothing on the site reads them), for
 * build/funnels.mjs (which compiles them beside the functions) and for the admin's editors.
 *
 * A funnel, content/funnels/<name>.md: frontmatter `title`, `published`, `design` (the email
 * design it is piped through, `campaign` by default), `cooldown` (the least time between two
 * of ITS emails to one person, `3d`), `audience` (the rules, rules.js's words), `goal` (optional: a path
 * on the site — the page a reader reaching means the email worked, credited on the funnel's analytics); the body a
 * step per `# ` heading — the heading is the step's name for the admin; under it a few
 * `field: value` lines (`id`: the email's identity, a uuid given once by the writer and never
 * edited — what the log is keyed on, so no one gets it twice however the funnel is renamed or
 * reordered; `after`: how long after the previous step — after entering, for the first;
 * `subject`; or, for a step that is a chat prompt rather than an email, `channel: chat` and `when`, the
 * triggers the browser watches for — src/lib/support/when.js — optionally `teaser`, the short line shown
 * above the chat launcher before the panel opens, and `image`, a picture (a gif) shown with the line, and no `after` or `subject`; the markdown is then
 * the line the prompt says), a blank line, then the email's markdown. A blast, content/blasts/<name>.md:
 * `id` (the same), `title`, `subject`, `design`, `audience`, `respect-cooldown`, `goal` (the same), and —
 * written by the send — `status` (draft | sent), `sent_at`, `sent`; the body the email's
 * markdown. `node build/funnels.mjs --key` gives an id to a hand-written file's emails. The policy,
 * content/emails/policy.md: `daily`, `weekly`, `monthly` (the most marketing emails one person
 * gets), `blasts-respect-cooldown`.
 */
import { asStore } from './store/index.mjs'
import { randomUUID } from 'node:crypto'
import matter from 'gray-matter'

export const FUNNELS_DIR = 'content/funnels', BLASTS_DIR = 'content/blasts', POLICY = 'content/emails/policy.md'
const DUMP = { lineWidth: -1 }
export const slugOk = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s || ''))
/* a goal is a path on the site: begins with /, no host, no space */
export const goalOk = (s) => s == null || s === '' || /^\/[^\s]*$/.test(String(s))

/* the step's head: `field: value` lines up to the first blank line; the rest is the markdown */
function splitStep(text) {
  const lines = text.replace(/^\n+/, '').split('\n')
  const fields = {}
  let i = 0
  for (; i < lines.length; i++) {
    const m = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(lines[i])
    if (!m) break
    fields[m[1]] = m[2].trim()
  }
  return { fields, body: lines.slice(i).join('\n').replace(/^\n+/, '').replace(/\s+$/, '') }
}
/* the file → { data, steps: [{ id, title, channel, after, subject, when, teaser, image, body }] } */
export function parseFunnel(raw) {
  const { data, content } = matter(raw)
  const parts = content.split(/^(?=# )/m).filter((p) => p.trim())
  const steps = parts.map((p) => {
    const m = /^# (.*)\n?([\s\S]*)$/.exec(p)
    const { fields, body } = splitStep(m ? m[2] : p)
    const channel = String(fields.channel || 'email').toLowerCase() === 'chat' ? 'chat' : 'email'
    return { id: UUID.test(fields.id || '') ? fields.id : '', title: (m ? m[1] : '').trim(), channel, after: fields.after || '0d', subject: fields.subject || '', when: fields.when || '', teaser: fields.teaser || '', image: fields.image || '', body }
  })
  return { data, steps }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/* the identity, given once: a step or a blast with none gets a uuid on the way to the file */
export const keyed = (id) => (UUID.test(id || '') ? String(id).toLowerCase() : randomUUID())
export function serialiseFunnel(data, steps) {
  const fm = {}
  for (const k of ['title', 'published', 'design', 'cooldown', 'audience', 'goal']) if (data[k] != null && data[k] !== '' && !(k === 'published' && data[k] === true)) fm[k] = data[k]
  const head = (s) => (s.channel === 'chat' ? `channel: chat\nwhen: ${s.when || ''}${String(s.teaser || '').trim() ? '\nteaser: ' + String(s.teaser).trim().replace(/\s+/g, ' ') : ''}${String(s.image || '').trim() ? '\nimage: ' + String(s.image).trim() : ''}` : `after: ${s.after || '0d'}\nsubject: ${s.subject || ''}`)
  const body = steps.map((s) => `# ${s.title || 'Step'}\nid: ${keyed(s.id)}\n${head(s)}\n\n${(s.body || '').trim()}\n`).join('\n')
  return matter.stringify('\n' + body, fm, DUMP)
}
export function parseBlast(raw) {
  const { data, content } = matter(raw)
  return { data, body: content.replace(/^\n+/, '').replace(/\s+$/, '') }
}
export function serialiseBlast(data, body) {
  const fm = { id: keyed(data.id) }
  for (const k of ['title', 'subject', 'design', 'audience', 'respect-cooldown', 'goal', 'status', 'sent_at', 'sent']) if (data[k] != null && data[k] !== '') fm[k] = data[k]
  return matter.stringify('\n' + (body || '').trim() + '\n', fm, DUMP)
}
/* the files, through the store (or a root, the checkout): every one async, nothing here opens the disk */
const names = async (store, dir) => (await asStore(store).list(dir)).filter((n) => !n.startsWith('_'))
export const funnelNames = (store = process.cwd()) => names(store, FUNNELS_DIR)
export const blastNames = (store = process.cwd()) => names(store, BLASTS_DIR)
export const readFunnel = async (store, name) => ({ name, ...parseFunnel(await asStore(store).read(FUNNELS_DIR + '/' + name + '.md')) })
export const readBlast = async (store, name) => ({ name, ...parseBlast(await asStore(store).read(BLASTS_DIR + '/' + name + '.md')) })
export const writeFunnel = (store, name, data, steps) => asStore(store).write(FUNNELS_DIR + '/' + name + '.md', serialiseFunnel(data, steps), { collection: 'funnels', slug: name, data, published: data.published !== false })
export const writeBlast = (store, name, data, body) => asStore(store).write(BLASTS_DIR + '/' + name + '.md', serialiseBlast(data, body), { collection: 'blasts', slug: name, data, body })
export async function readPolicy(store = process.cwd()) { try { return matter((await asStore(store).read(POLICY)) || '').data } catch (e) { return {} } }
/* every email in every file given its id where it has none — the files rewritten only when one was missing */
export async function keyAll(store = process.cwd()) {
  let n = 0
  for (const name of await funnelNames(store)) { const f = await readFunnel(store, name); if (f.steps.some((s) => !s.id)) { await writeFunnel(store, name, f.data, f.steps); n += f.steps.filter((s) => !s.id).length } }
  for (const name of await blastNames(store)) { const b = await readBlast(store, name); if (!UUID.test(b.data.id || '')) { await writeBlast(store, name, b.data, b.body); n++ } }
  return n
}
export const writePolicy = (store, data) => asStore(store).write(POLICY, matter.stringify('\n', data, DUMP), { collection: 'emails', slug: 'policy', data })
