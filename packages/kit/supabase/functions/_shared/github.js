/*
 * The push to the repository, for cloud mode: every row of public.content that is pending — what a publish made
 * live — goes to the branch Content → Publishing names as ONE commit through GitHub's git data API: a blob per file,
 * one tree over the branch's head (a published removal's entry gone), one commit with the message the publisher
 * gave (else "Publish: n pages") and their name, the ref moved to it. Only once the ref has moved are the rows
 * cleared of pending together (a removed one is gone for good); a failure anywhere leaves every row pending with
 * the reason — never a commit for some of them — and the cron asks again every minute (`push-pending`), bundling
 * whatever waits the same way. The settings — github:repo, github:branch, github:token — live in app_settings,
 * which only the service role reads; the token is never sent back to a browser.
 *
 * Plain JavaScript on fetch alone, so the function (Deno) and a kit test (Node, the API mocked) run the same file.
 */
const KEYS = ['github:repo', 'github:branch', 'github:token', 'github:last_push', 'github:error', 'cloud:hook', 'cloud:hook_at', 'cloud:hook_error']

export async function readSettings(sb) {
  const { data } = await sb.from('app_settings').select('key, value').in('key', KEYS)
  const out = {}; for (const r of data || []) out[r.key.slice(r.key.indexOf(':') + 1)] = r.value
  return out
}
/* what the page may know: never the token itself, only that one is set */
/* Where the pushes go is CONFIGURATION and comes from the repository (platformkit.config.js →
   build/cloud-config.mjs → cloud.json), so a fresh deployment already knows. A site that declares
   none may still be told in the admin, which is the old way and stays for one. The token is a
   secret either way and is only ever app_settings'. */
/* the file is written by the build (it is not in the kit's own tree), so it is read once, lazily,
   the way the content index is — a checkout that has not assembled simply declares nothing */
const NONE = { repo: '', branch: '', declared: false, off: false }
let cloud = null
async function declaredTarget() {
  if (cloud) return cloud
  try { const mod = await import('./cloud.json', { with: { type: 'json' } }); cloud = { ...NONE, ...(mod.default ?? mod) } }
  catch { cloud = NONE }
  return cloud
}
/*
 * The target: the declaration when there is one, else what the admin was told — and nothing at all
 * where the repository is declared OUT of the cycle (`cloud: { repo: false }`). That third state is
 * answered here rather than left for each caller to infer from an empty repository, because "no
 * repository yet" and "no repository, on purpose" want opposite things: the first asks for one, the
 * second must never be asked and must never reconcile against a checkout.
 */
async function targetOf(s) {
  const d = await declaredTarget()
  if (d.off) return { repo: '', branch: '', declared: true, off: true }
  return d.declared
    ? { repo: d.repo, branch: d.branch || 'main', declared: true, off: false }
    : { repo: s.repo || '', branch: s.branch || 'main', declared: false, off: false }
}
/* what shape this deployment is, for anybody who needs to ask: 'git' · 'off' · 'undecided' */
export async function cloudMode() {
  const d = await declaredTarget()
  return d.off ? 'off' : d.declared ? 'git' : 'undecided'
}

export async function githubSettings(sb) {
  const s = await readSettings(sb)
  const { repo, branch, declared, off } = await targetOf(s)
  /* with git out of the cycle nothing is owed to anybody: a pending row is not debt, it is just a
     row that has never been pushed and never will be, so it is not counted and not shown */
  if (off) return { mode: 'off', repo: '', branch: '', declared: true, token: false, connected: false, last_push: null, error: null, pending: 0, hook: !!s.hook, hook_at: s.hook_at || null, hook_error: s.hook_error || null }
  const { count } = await sb.from('content').select('path', { count: 'exact', head: true }).eq('pending', true)
  return { mode: declared ? 'git' : 'undecided', repo, branch, declared, token: !!s.token, connected: !!(repo && s.token), last_push: s.last_push || null, error: s.error || null, pending: count || 0, hook: !!s.hook, hook_at: s.hook_at || null, hook_error: s.hook_error || null }
}
/*
 * THE DEPLOY HOOK — what makes the static copy catch up where a push does not.
 *
 * In git mode the commit is what rebuilds the site. With git out of the cycle nothing does, so the
 * prerendered pages and the share images stay as the last build left them: a reader sees an edit at
 * once (the live layer) while every unfurl and crawler sees the old one. A URL the publish asks for
 * closes that, and it is useful in git mode too — a host that does not build on push needs it just
 * as much.
 *
 * It is a secret like the token: written, never read back to a browser, only "there is one".
 */
export async function saveHook(sb, url) {
  const v = String(url ?? '').trim()
  if (v && !/^https:\/\/[^\s]+$/.test(v)) throw new Error('a deploy hook is an https url')
  const rows = [{ key: 'cloud:hook', value: v }, { key: 'cloud:hook_error', value: '' }]
  const { error } = await sb.from('app_settings').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'key' })
  if (error) throw error
}

/* asked after a publish: fire and forget. The rows are already live, so a hook that refuses is
   something to show, never something that fails a publish. */
export async function askRebuild(sb, { fetchFn = fetch } = {}) {
  const s = await readSettings(sb)
  if (!s.hook) return { asked: false }
  let err = ''
  try {
    const r = await fetchFn(s.hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!r.ok) err = 'the host answered ' + r.status
  } catch (e) { err = String((e && e.message) || e) }
  await sb.from('app_settings').upsert([
    { key: 'cloud:hook_at', value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { key: 'cloud:hook_error', value: err, updated_at: new Date().toISOString() },
  ], { onConflict: 'key' })
  return { asked: true, error: err || null }
}

/*
 * A COPY, because with no repository the rows are the only one. Every live record as its exact file
 * text, in its own path, as one zip — what a checkout of this site's content would look like.
 *
 * Drafts are not in it: it is a copy of the site as it stands, not of what somebody is part-way
 * through writing. It is a copy and not a record — there is no history in it, and a deployment that
 * wants history attaches a repository, which is one line of configuration.
 */
export async function contentArchive(sb) {
  /* Deno resolves npm:, node resolves the package it already has — this module is imported by a
     kit test under node as well as by the function, so it must load either way */
  const fflate = await import('npm:fflate@0.8.2').catch(() => import('fflate'))
  const { zipSync, strToU8 } = fflate.default ?? fflate
  const { data, error } = await sb.from('content').select('path, text').is('deleted_at', null).not('text', 'is', null).order('path')
  if (error) throw error
  const tree = {}
  for (const r of data || []) {
    const parts = String(r.path).split('/').filter(Boolean)
    let at = tree
    for (const p of parts.slice(0, -1)) at = (at[p] = at[p] || {})
    at[parts[parts.length - 1]] = strToU8(r.text)
  }
  return { bytes: zipSync(tree, { level: 6 }), files: (data || []).length }
}

export async function saveGithubSettings(sb, { repo, branch, token }) {
  const declared = await declaredTarget()
  const rows = []
  /* a declared target is not the admin's to change: the file says where this site publishes */
  if (!declared.declared) {
    rows.push({ key: 'github:repo', value: String(repo || '').trim() })
    rows.push({ key: 'github:branch', value: String(branch || '').trim() || 'main' })
  }
  if (token !== undefined && token !== '') rows.push({ key: 'github:token', value: String(token).trim() })
  rows.push({ key: 'github:error', value: '' })
  const { error } = await sb.from('app_settings').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'key' })
  if (error) throw error
}

/* ---- the git data API: one commit for everything pending ---- */
const API = 'https://api.github.com'
const headers = (token) => ({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' })
const b64 = (text) => { const bytes = new TextEncoder().encode(text); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
async function call(fetchFn, token, method, url, body) {
  const r = await fetchFn(API + url, { method, headers: headers(token), ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${method} ${url}: ${String(await r.text().catch(() => '')).slice(0, 200)}`)
  return r.json()
}
/* the files as one commit on the branch: every blob made, one tree over the branch's head (a removed file's entry
   gone), one commit, the ref moved — the commit's sha, or a throw with nothing moved */
export async function commitFiles({ fetchFn = fetch, token, repo, branch, files, message }) {
  const ref = await call(fetchFn, token, 'GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`).catch((e) => { throw new Error(/404/.test(e.message) ? `the branch ${branch} has no commit yet — push an initial commit first` : e.message) })
  const head = ref.object.sha
  const base = (await call(fetchFn, token, 'GET', `/repos/${repo}/git/commits/${head}`)).tree.sha
  const tree = []
  for (const f of files) {
    if (f.deleted) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue }
    const blob = await call(fetchFn, token, 'POST', `/repos/${repo}/git/blobs`, { content: b64(f.text), encoding: 'base64' })
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const made = await call(fetchFn, token, 'POST', `/repos/${repo}/git/trees`, { base_tree: base, tree })
  const commit = await call(fetchFn, token, 'POST', `/repos/${repo}/git/commits`, { message, tree: made.sha, parents: [head] })
  await call(fetchFn, token, 'PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha })
  return commit.sha
}

/* ---- every pending row, as one commit ---- */
export async function pushPending(sb, by = '', { fetchFn = fetch, message = '', limit = 200 } = {}) {
  const s = await readSettings(sb)
  const { repo, branch, off } = await targetOf(s)
  /* git out of the cycle: there is nothing to push to, and a row's pending flag is not debt */
  if (off) return { pushed: 0, skipped: 'no repository in this deployment' }
  if (!repo || !s.token) return { pushed: 0, skipped: 'no repository' }
  const { data: rows, error } = await sb.from('content').select('path, text, deleted_at, updated_by').eq('pending', true).order('updated_at', { ascending: true }).limit(limit)
  if (error) throw error
  if (!rows || !rows.length) return { pushed: 0 }
  const who = by || rows.map((r) => r.updated_by).filter(Boolean)[0] || ''
  const n = rows.length
  const line = (message || '').trim() || `Publish: ${n} ${n === 1 ? 'page' : 'pages'}`
  const now = new Date().toISOString()
  let sha = null, failed = null
  try {
    sha = await commitFiles({ fetchFn, token: s.token, repo, branch, message: who ? `${line} (${who})` : line, files: rows.map((r) => ({ path: r.path, text: r.text, deleted: !!r.deleted_at })) })
    /* only now, with the ref moved: the edits cleared together, the removals gone for good */
    const kept = rows.filter((r) => !r.deleted_at).map((r) => r.path), gone = rows.filter((r) => r.deleted_at).map((r) => r.path)
    if (kept.length) { const { error: e1 } = await sb.from('content').update({ pending: false, pushed_at: now, push_error: null }).in('path', kept); if (e1) throw e1 }
    if (gone.length) { const { error: e2 } = await sb.from('content').delete().in('path', gone); if (e2) throw e2 }
  } catch (e) {
    failed = String(e.message || e)
    await sb.from('content').update({ push_error: failed }).in('path', rows.map((r) => r.path))
  }
  await sb.from('app_settings').upsert([{ key: 'github:error', value: failed || '', updated_at: now }, ...(sha ? [{ key: 'github:last_push', value: now, updated_at: now }] : [])], { onConflict: 'key' })
  return { pushed: failed ? 0 : n, commit: sha, error: failed }
}
