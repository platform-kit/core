/*
 * Cloud mode's export, run by `platformkit build` before velite when CONTENT_STORE=cloud: the LIVE version of
 * every row of public.content written out as a file under content/ so the build — velite, the prerender, the
 * search index, the share images, the printed books — is what the editors published. Drafts are not the
 * export's: a row's draft columns are never read or touched here, and a row never published (no live version)
 * is left alone. The rule, row by row against the checkout:
 *
 *   a pending row (a publish not yet pushed)         wins: its live text is written over the file
 *   a row marked deleted (a published removal)       the file goes, when the deletion is still pending
 *   a row with no live version                       a draft not yet published: left alone
 *
 * and THREE MORE THAT BELONG TO THE REPOSITORY, and run only where there is one in the cycle
 * (`cloud: { repo, branch }`; never with `cloud: { repo: false }`):
 *
 *   a row not pending whose file differs             the file wins (a commit changed it): the row's live version is brought to it
 *   a file with no row                               a row is made of it, live (not pending: the repository has it)
 *   a row not pending with no file                   the file went by a commit: the row goes
 *
 * That last one is why the split matters. It reads a missing file as a deletion, which is right when
 * the repository is the record and catastrophic when it is not: a deployment with no repository has
 * no content files in its checkout at all, so every row would look deleted. It was unreachable there
 * only because nothing ever pushes and so nothing is ever not-pending — safety by side-effect, one
 * cleared token away from wiping the content. Now the rule simply does not exist without a repository.
 *
 * and every object of the content-assets bucket that the checkout lacks is written beside them; the other way, every
 * file the repository tracks under the library's roots (content/uploads, public — media-library) that the bucket lacks
 * is put there, so the library in cloud mode holds the checkout's files too (the .keep of an empty folder never comes
 * back). Nothing is pushed to the repository from here — the push is the function's, on a publish. `--dry` says what
 * would happen and touches nothing.
 *
 *   node build/content-export.mjs [--dry]          exports (reads SUPABASE_URL / VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
 *   exportRows(root, store, { dry, under }) → the report   what a kit test calls; `under` narrows it to one directory (default content/)
 */
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { gitStore, collectionOf, mimeOf } from './store/index.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [])
const TEXT = /\.(md|json|yml|yaml|txt|csv)$/i

/* what the deployment declared: 'git' (a repository is in the cycle) · 'off' (it is not) ·
   'undecided' (nothing declared — the admin asks, and the repository is treated as in the cycle,
   which is what it has always done) */
export function cloudModeOf(root) {
  try {
    const raw = fs.readFileSync(path.join(root, 'supabase/functions/_shared/cloud.json'), 'utf8')
    const c = JSON.parse(raw)
    return c.off ? 'off' : c.declared ? 'git' : 'undecided'
  } catch { return 'undecided' }
}

export async function exportRows(root, rows, { dry = false, log = () => {}, under = 'content', mode = null } = {}) {
  const git = gitStore(root)
  const sb = rows.client
  /* the repository's own rules run only where there is one */
  const withRepo = (mode || cloudModeOf(root)) !== 'off'
  const out = { written: [], updated: [], inserted: [], removedFiles: [], removedRows: [], assets: [], seeded: [] }
  const { data, error } = await sb.from('content').select('path, text, pending, deleted_at, sha').like('path', under + '/%')
  if (error) throw error
  const byPath = new Map((data || []).map((r) => [r.path, r]))
  /* the rows against the files */
  for (const r of data || []) {
    const file = await git.read(r.path)
    if (r.deleted_at) {
      if (r.pending && file != null) { out.removedFiles.push(r.path); if (!dry) await git.remove(r.path) }
      continue
    }
    if (r.text == null) continue   /* never published: nothing live to write, nothing to compare */
    if (file == null) {
      /* THE ROW IS WRITTEN OUT unless the repository is the record and has dropped the file. With no
         repository in the cycle the checkout never holds content, so a missing file means nothing. */
      if (r.pending || !withRepo) { out.written.push(r.path); if (!dry) await git.write(r.path, r.text) }
      else { out.removedRows.push(r.path); if (!dry) await sb.from('content').delete().eq('path', r.path) }
      continue
    }
    if (file === r.text) continue
    if (r.pending || !withRepo) { out.written.push(r.path); if (!dry) await git.write(r.path, r.text) }
    else { out.updated.push(r.path); if (!dry) await rows.write(r.path, file, { ...metaOf(r.path, file), live: true, pending: false }) }
  }
  /* the files with no row — the repository's rule: a file it tracks is content the rows have not
     heard of yet. With no repository in the cycle a stray file in the checkout is not a record, and
     the export that just WROTE those files would read its own output back in. */
  const base = path.join(root, under)
  for (const abs of withRepo ? walk(base) : []) {
    const rel = path.relative(root, abs).split(path.sep).join('/')
    if (!TEXT.test(rel) || byPath.has(rel)) continue
    if (rel.startsWith('content/uploads/')) continue
    const text = fs.readFileSync(abs, 'utf8')
    out.inserted.push(rel)
    if (!dry) await rows.write(rel, text, { ...metaOf(rel, text), live: true, pending: false })
  }
  /* the assets the checkout lacks */
  const list = async (prefix) => { const { data: objs } = await sb.storage.from('content-assets').list(prefix, { limit: 1000 }); const files = []; for (const o of objs || []) { if (o.id) files.push(prefix + '/' + o.name); else files.push(...(await list(prefix + '/' + o.name))) } return files }
  const inBucket = new Set()
  for (const rel of await list(under)) {
    inBucket.add(rel)
    if (rel.split('/').pop() === '.keep') continue
    if (await git.exists(rel)) continue
    out.assets.push(rel)
    if (!dry) { const bytes = await rows.getAsset(rel); if (bytes) await git.putAsset(rel, bytes) }
  }
  /* the checkout's tracked files under the library's roots, into the bucket where it lacks them — the whole run's
     concern (under = content); a test narrowing `under` to a probe directory seeds nothing */
  if (under === 'content') {
    const have = new Set([...inBucket, ...(await list('public'))])
    for (const rel of trackedUnder(root, ['content/uploads', 'public'])) {
      if (have.has(rel)) continue
      out.seeded.push(rel)
      if (!dry) { const bytes = await git.getAsset(rel); if (bytes) await rows.putAsset(rel, bytes, mimeOf(rel)) }
    }
  }
  log(`content-export: ${out.written.length} row(s) written out (pending edits), ${out.updated.length} row(s) brought to a newer file, ${out.inserted.length} file(s) made rows, ${out.removedFiles.length} file(s) removed, ${out.removedRows.length} row(s) removed, ${out.assets.length} asset(s) pulled, ${out.seeded.length} file(s) put in the bucket${dry ? ' — dry, nothing touched' : ''}`)
  return out
}
/* the checkout's files under some directories of the site — tracked or not yet, never the gitignored (a build's output under public/ is not the library's) */
function trackedUnder(root, dirs) {
  try {
    const { execFileSync } = require('node:child_process')
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...dirs], { cwd: root }).toString('utf8').split('\0').filter(Boolean)
  } catch { return [] }   /* no git here: nothing seeded */
}

/* a file's row keys: the frontmatter and the body, the collection and slug of its path, whether it is published */
export function metaOf(rel, text) {
  const { collection, slug } = collectionOf(rel)
  let data = null, body = text, published = true
  if (/\.md$/i.test(rel)) { try { const fm = matter(text); data = fm.data; body = fm.content; published = fm.data.published !== false } catch { /* not frontmatter */ } }
  return { collection, slug, data, body, published }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const { rowsStore } = await import('./store/rows.mjs')
  const { supabaseUrl, serviceKey } = await import('./tts/storage.mjs')
  const url = supabaseUrl(), key = serviceKey()
  if (!url || !key) { console.error('content-export: no database in reach (SUPABASE_URL / VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1) }
  await exportRows(process.cwd(), rowsStore({ url, key, by: 'deploy' }), { dry: process.argv.includes('--dry'), log: console.log })
}
