/*
 * THE TAGS A SITE WRITES ABOUT — the one vocabulary, read and written through the store.
 *
 * It is the `tags` field every collection already carried, given a list to draw from. It is called
 * tags and nothing else: the field is `tags`, the column is `content_search.tags`, and a second
 * word for it would be a fourth vocabulary in a codebase that already has topics and concepts —
 * and "subject", which it was briefly called, is taken: a comment's subject is what a thread is
 * about (`comment_subjects`), which is not this at all.
 *
 * It is a declaration (content/tags.md), so it is a file in a checkout and a row of public.content
 * in cloud mode, and nothing here knows which. It is never a table: what that buys is that adding
 * a tag is a publish rather than a migration, which is the only way an editor on a deployment with
 * no checkout could add one at all.
 *
 * Every field that offers tags draws from `tagList`, and every save that may invent one goes
 * through `learnTags`, so there is one list and no second copy of it anywhere.
 */
import matter from 'gray-matter'
import { asStore } from './store/index.mjs'

export const TAGS_PATH = 'content/tags.md'

/*
 * ONE TAG, ONE SPELLING. Trimmed, collapsed and lowercased — so "Getting Started", "getting
 * started" and " Getting  Started " are one tag rather than three. This runs on the way IN (what a
 * writer picked or typed) and on the way OUT (what the vocabulary offers), so the two can never
 * disagree about whether two strings are the same tag.
 */
export const normalise = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/* the record as it is, or an empty one — a site that has never set a tag is not an error */
export async function readTags(store) {
  const raw = await asStore(store).read(TAGS_PATH)
  if (raw == null) return { free: false, tags: [], data: {}, content: '' }
  const fm = matter(raw)
  const d = fm.data || {}
  const list = Array.isArray(d.tags) ? d.tags : []
  return { free: d.free === true, tags: list.map(normalise).filter(Boolean), data: d, content: fm.content }
}

/* the vocabulary, sorted, for a field to offer */
export async function tagList(store) {
  return (await readTags(store)).tags.slice().sort((a, b) => a.localeCompare(b))
}

/* whether a writer may invent one */
export async function freeTagging(store) { return (await readTags(store)).free }

/*
 * WHAT A SAVE MAY TEACH IT. Given the tags a record now carries, any that the vocabulary does not
 * hold are added to it — but ONLY where free tagging is on. With the switch off an unknown tag is
 * not a new tag, it is a value the field should never have produced, and it is refused rather than
 * quietly learned.
 *
 * Answers what the record should carry (normalised) and what was added, so a caller can say so.
 */
export async function learnTags(store, values) {
  const s = asStore(store)
  const want = [...new Set((values || []).map(normalise).filter(Boolean))]
  const rec = await readTags(s)
  const unknown = want.filter((v) => !rec.tags.includes(v))
  if (!unknown.length) return { values: want, added: [], refused: [] }
  if (!rec.free) return { values: want.filter((v) => rec.tags.includes(v)), added: [], refused: unknown }
  const tags = [...rec.tags, ...unknown].sort((a, b) => a.localeCompare(b))
  await s.write(TAGS_PATH, matter.stringify('\n' + String(rec.content || '').replace(/^\n+/, ''), { ...rec.data, tags }, { lineWidth: -1 }))
  return { values: want, added: unknown, refused: [] }
}
