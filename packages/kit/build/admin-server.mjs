/*
 * The admin content API — a Vite dev-server middleware, mounted only when Vite is serving (never in a production
 * build), so the whole read/write surface simply does not exist off localhost.
 *
 * One pipe for every model of the registry (build/models: the kit's core models, a site's own, every custom
 * model): a record is read through its model's grammar, a write runs the model's prepare, its fields, its checks,
 * the grammar and then its hook, and is refused before anything is written with every fault named. What the model
 * does not model is preserved, so a file round-trips without loss. Velite's own watcher re-embeds whatever this writes.
 * The calls themselves are answered by build/admin-pipe.mjs — the same function the `admin` Edge Function of cloud
 * mode runs over the rows; this file is the Node around it: Vite, the checkout as the store, velite for the
 * preview, the enrichment runs and a rendered print file streamed.
 *
 *   GET    /__admin/collections              every model: its fields, its parts, its count
 *   GET    /__admin/list?col=                every record of a model (the grid's rows; a model with a listing of its own answers whole)
 *   GET    /__admin/file?col=&name=          one record: { name, data, content, parsed, … }
 *   POST   /__admin/file                     { col, name, data, content, parsed, create?, check?, rename? } → the pipe
 *   DELETE /__admin/file?col=&name=
 *   POST   /__admin/preview                  { col, name, data, content } → the entry the build would make
 *   GET    /__admin/options?key=             an option list (a model's own; model:<key> a custom model's entries)
 *   POST   /__admin/action                   { col, action, name?, …payload } → the model's action (GET with a query for one that streams a file)
 *   POST   /__admin/upload                   { col, filename, dataBase64 } → the model's asset store
 *   POST   /__admin/upload-image             the body editor's images, content/uploads
 *   GET    /__admin/asset?col=&file=         an asset for the preview
 *   GET|POST /__admin/run[/stop]             the enrichment runs (the Books grid's scripts)
 */
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { registry, byKey, describe, compact, Refusal, NAME_RE } from './models/index.mjs'
import { adminRequest } from './admin-pipe.mjs'
import { gitStore } from './store/index.mjs'
import { loadTheme } from './theme.mjs'
import { loadSite } from './site.mjs'
import { VeliteFile } from 'velite'
import { loadDotEnv } from './tts/storage.mjs'

/* The keys from .env, for a process that has not read them. Vite puts only VITE_-prefixed values
   on import.meta.env and nothing on process.env, so a server-side key an admin route needs — an
   image source's, as the printers' — would be missing in development and present in production,
   which reads as a broken feature rather than an unset variable. It was reaching us only as a
   side effect of the print module importing the same loader, so a site with print off lost it. */
loadDotEnv()
/* the site's velite config, from cwd (the collections are the site's) */
const veliteConfig = (await import(pathToFileURL(path.join(process.cwd(), 'velite.config.js')).href)).default

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' }
const ROOT = process.cwd()   /* the site: the kit's scripts run in the site's root */
const KIT = (f) => fileURLToPath(new URL('./' + f, import.meta.url))   /* a sibling script of this one, wherever the kit is installed */
/* the registry, read fresh on every request so a model saved in the builder shows on the reload */
const SITE = await loadSite(ROOT)
const STORE = gitStore(ROOT)   /* the dev server edits the checkout, whatever the mode */
const models = () => registry(ROOT, { site: SITE, store: STORE })
/* a landing page is validated against the theme's section schemas (its manifest names the module) with the site's merged in (#site/landing under Node) */
const THEME = await loadTheme(SITE)
const { validateSections } = await import(pathToFileURL(THEME.schemas).href)

/* The live preview runs a draft through the collection's own velite schema, in
   this process, so what comes back is exactly the entry the build would write —
   the same markdown pipeline, transforms and checks. The schemas read the
   project's resolved config off the file object; this is that config, shaped
   the way velite resolves it, with nothing that touches the output directory. */
let PREVIEW_CONFIG = null
function previewConfig() {
  if (PREVIEW_CONFIG) return PREVIEW_CONFIG
  const o = veliteConfig.output || {}
  PREVIEW_CONFIG = {
    ...veliteConfig,
    configPath: path.join(ROOT, 'velite.config.js'),
    root: path.resolve(ROOT, veliteConfig.root || 'content'),
    output: {
      data: path.resolve(ROOT, o.data || '.velite'),
      assets: path.resolve(ROOT, o.assets || 'public/static'),
      base: o.base || '/static/',
      name: o.name || '[name]-[hash:8].[ext]',
      clean: false,
      format: 'esm',
    },
    loaders: [],
  }
  return PREVIEW_CONFIG
}
/* the form sends every field, set or not; the file on disk only carries the set
   ones, and the schema must see what the file would */
async function preview({ col, name, data, content }, models) {
  const c = byKey(models, col)
  /* a custom model's entries are the collection models_<key> in velite */
  const vk = c && c.model ? 'models_' + c.model.key.replace(/-/g, '_') : col
  const schema = veliteConfig.collections[vk] && veliteConfig.collections[vk].schema
  if (!c || !schema) return { status: 404, body: { error: 'no such collection' } }
  const safe = String(name || '').replace(/[^a-z0-9/_-]/gi, '').replace(/^\/+|\/+$/g, '') || 'untitled'
  const file = new VeliteFile({ path: path.join(ROOT, c.dir, safe + '.md'), config: previewConfig() })
  file.value = content || ''
  file.data = { data: compact(data), content: content || '' }
  const r = await schema.safeParseAsync(file.data.data, { meta: file })
  /* a draft that does not compile is an ordinary state while typing, not an
     error: 200 with the schema's issues, so the browser console stays quiet */
  if (!r.success) {
    return { status: 200, body: { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }
  }
  return { status: 200, body: { entry: r.data } }
}

/* what the pipe is given here: the checkout, velite's preview, the registry read fresh */
const ENV = { root: ROOT, store: STORE, models, describe, validateSections, preview, by: '' }

const send = (res, code, obj) => {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(obj))
}
const body = (req) => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', (c) => { s += c; if (s.length > 8e6) reject(new Error('too large')) })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch (e) { reject(e) } })
  req.on('error', reject)
})
const modelOf = async (col) => { const m = byKey(await models(), String(col || '')); if (!m) throw new Refusal(400, 'unknown collection'); return m }
const resolveFile = async (col, name) => { const m = await modelOf(col); const { fileOf } = await import('./models/index.mjs'); return fileOf(m, name, ROOT) }

/* ---- the enrichment scripts, run from the Books grid ----
   One child process at a time (each call costs money, and two runs on one book
   would race on the file); its output is kept so the admin can show it live and
   a reload can pick a running job back up. */
/* one pipeline, build/enrich.mjs: 'enrich' runs every stage (the introduction first,
   then the companion); 'introduce' stops after the introduction */
const SCRIPTS = { enrich: [[KIT('enrich.mjs')]], introduce: [[KIT('enrich.mjs'), '--stage', 'introduce']] }
const jobs = []
/* the print editions' draft renders, by book, while the server runs */
const drafts = new Map()
const jobView = ({ child, ...j }) => j
async function startJob({ script, books, force }) {
  if (!SCRIPTS[script]) throw Object.assign(new Error('unknown script'), { code: 400 })
  if (!Array.isArray(books) || !books.length) throw Object.assign(new Error('choose at least one book'), { code: 400 })
  for (const b of books) { try { await fs.access(await resolveFile('books', b)) } catch { throw Object.assign(new Error('no such book: ' + b), { code: 404 }) } }
  if (jobs.some((j) => j.running)) throw Object.assign(new Error('a run is already going — stop it or wait for it to finish'), { code: 409 })
  const job = { id: Date.now().toString(36), script, books, force: !!force, running: true, code: null, log: '', started: new Date().toISOString(), ended: null, child: null, stopped: false }
  const push = (c) => { job.log += String(c); if (job.log.length > 200000) job.log = job.log.slice(-150000) }
  const done = (code) => { if (!job.running) return; job.running = false; job.code = code; job.ended = new Date().toISOString() }
  const queue = [...SCRIPTS[script]]
  const next = () => {
    const [file, ...extra] = queue.shift()
    const args = [path.join(ROOT, file), ...extra, ...books.flatMap((b) => ['--book', b]), '--write', '--review']
    if (force) args.push('--force')
    if (SCRIPTS[script].length > 1) push(`\n=== ${file} ===\n`)
    try {
      job.child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } })
      job.child.stdout.on('data', push); job.child.stderr.on('data', push)
      job.child.on('close', (code) => { if (code === 0 && queue.length && !job.stopped) next(); else done(code) })
      job.child.on('error', (e) => { push('\n' + e.message + '\n'); done(-1) })
    } catch (e) { push(e.message); done(-1) }
  }
  next()
  jobs.push(job); if (jobs.length > 10) jobs.shift()
  return job
}


export function adminServer() {
  return {
    name: 'admin-content-api',
    apply: 'serve',
    configureServer(server) {
      /* serve body-image uploads (content/uploads) at /uploads, so both the editor preview and the dev frontend resolve the same /uploads/<file> src */
      server.middlewares.use('/uploads', async (req, res, next) => {
        try {
          const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\//, ''))
          if (!rel || rel.includes('..')) return next()
          const dir = path.join(ROOT, 'content/uploads')
          const file = path.join(dir, rel)
          if (!file.startsWith(dir + path.sep)) return next()
          const buf = await fs.readFile(file)
          res.setHeader('content-type', MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream')
          res.setHeader('cache-control', 'no-store')
          return res.end(buf)
        } catch { return next() }
      })
      server.middlewares.use('/__admin', async (req, res) => {
        const url = new URL(req.url, 'http://x')
        const seg = url.pathname.replace(/^\//, '')
        const q = url.searchParams
        try {
          if (seg === 'run' && req.method === 'GET') { const id = q.get('id'); return send(res, 200, { jobs: jobs.filter((j) => !id || j.id === id).map(jobView) }) }
          if (seg === 'run' && req.method === 'POST') { try { return send(res, 200, { job: jobView(await startJob(await body(req))) }) } catch (e) { return send(res, e.code || 500, { error: e.message }) } }
          if (seg === 'run/stop' && req.method === 'POST') {
            const { id } = await body(req)
            const job = jobs.find((j) => j.id === id)
            if (!job) return send(res, 404, { error: 'no such run' })
            if (job.running && job.child) { job.stopped = true; job.child.kill('SIGTERM'); job.log += '\n— stopped —\n' }
            return send(res, 200, { job: jobView(job) })
          }

          /* everything else is the pipe's, answered the same way the admin function answers it */
          const r = await adminRequest(ENV, { method: req.method, seg, q, body: req.method === 'GET' || req.method === 'DELETE' ? null : await body(req) })
          if (r.stream) { const out = r.stream; res.writeHead(200, { 'content-type': out.type, 'cache-control': 'no-store', ...(out.size ? { 'content-length': out.size } : {}) }); return out.stream.pipe(res) }
          if (r.bytes) { res.statusCode = r.status; res.setHeader('content-type', r.type); res.setHeader('cache-control', 'no-store'); return res.end(Buffer.from(r.bytes)) }
          return send(res, r.status, r.body)
        } catch (e) {
          send(res, e.code && e.code < 600 ? e.code : 500, { error: String(e.message || e), ...(e.extra || {}) })
        }
      })
    },
  }
}
