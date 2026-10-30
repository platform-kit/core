#!/usr/bin/env node
/*
 * Spoken books, made locally. One recording per chapter of a book and one per
 * chapter summary in its companion, so a reader can listen in either mode:
 *
 *   node build/tts.mjs --book <slug> [--chapter <title>] [--summaries-only|--text-only]
 *   node build/tts.mjs --all
 *   --workers N   parallel engines (default: sized to the machine — one per core,
 *                 within memory; see sizeEngines)
 *   --dry         list what would be spoken, and how much of it is already done
 *   --local       render into the store and skip the bucket
 *   --pull        bring the bucket's recordings into the store and stop (the
 *                 same reconciliation every run does first, on its own)
 *
 * TTS_COMMIT=1 makes a run that changed the store commit it and push, so the
 * repository keeps itself complete — a deploy that spoke a new book pushes the
 * recordings back, a local run that pulled from the bucket does too. It is
 * opt-in because it writes to the repository: set it in the deploy environment
 * (with credentials that can push; TTS_COMMIT_BRANCH names the branch, default
 * main) and in the shell of anyone running the script by hand who wants that.
 * TTS_COMMIT=local commits without pushing. A push that fails is reported and
 * does not fail the run: the recordings are safe in the bucket, and the next
 * run that can push will carry them. A machine that is already logged in to
 * GitHub pushes as itself; a build box sets TTS_GITHUB_TOKEN (or GITHUB_TOKEN /
 * GH_TOKEN), a token with read and write on this repository's contents, and
 * the script reaches GitHub through it without storing it anywhere.
 *
 * The voice is Supertonic 3 (Supertone, OpenRAIL-M weights; the engine code is
 * the archived project's own Node example, MIT, vendored in build/tts/supertonic)
 * on the CPU through onnxruntime-node — the same in the devcontainer as on any
 * machine, no Python, no GPU. `node build/tts/setup.mjs` fetches the weights
 * once (≈380 MB). Nothing is paid for and nothing leaves the machine but the
 * finished audio. Each engine (build/tts/worker.mjs) speaks a chapter whole: the
 * engine cuts it at sentence ends, speaks each piece, and joins them with a
 * breath between; the WAV is then encoded as mono mp3 (ffmpeg, TTS_BITRATE,
 * default 128k — the same rate the reader's in-browser engine writes). TTS_VOICE picks the voice (M5 by default — the
 * warm, soft-spoken one made for audiobooks; F5 its counterpart), TTS_STEPS the
 * denoising steps, TTS_SPEED the pace.
 *
 * The recordings live in the repository, under audio/books/<slug>/: the MP3s as
 * Git LFS objects, the manifest (index.json — chapter title → the text's
 * recording and the summary's) as a plain file. That store is the copy of
 * record, versioned with the books. A recording's name is a hash of the engine,
 * its voice and settings, and the exact text, so a recording in the store is
 * never made again: a rerun after an edit redoes only the chapters whose words
 * moved, and a run interrupted halfway resumes where it stopped.
 *
 * Readers are served from Supabase Storage, bucket `audio` (public; made by
 * migration 20260911100000_audio_bucket.sql), as books/<slug>/<hash>.mp3. The
 * bucket is a sync target: after rendering, the script lists it and uploads
 * only what it lacks. velite reads the manifests from the store at build time
 * into the book as `audio`, with urls into the bucket, and the reader shows a
 * player only for a chapter and mode that has a recording. No manifest, no
 * player: a book never needs audio to work.
 *
 * build/deploy.mjs runs `--all` before the site is built (TTS=0 opts out):
 * a book that has no recordings yet is spoken there, in minutes; the library's
 * bulk was spoken once, locally, and travels as LFS. A clone without the LFS
 * blobs (a deploy box) holds pointers; the script fetches exactly the objects
 * the bucket lacks with `git lfs pull --include`, so a deploy with nothing new
 * moves nothing and costs no LFS bandwidth. Uploading needs SUPABASE_URL (or
 * VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY; the local stack's key is
 * built in.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { parseCompanionBody } from './companion-io.mjs'
/* the words a chapter is read with and the name its recording gets: one module,
   shared with the reader's in-browser engine, so both say and hash the same */
import { ENGINE as DEFAULTS, INTRO_KEY, bookChapters, chapterSpeech, hashInput } from '../src/lib/speech.js'

const ROOT = process.cwd()   /* the site: its .env and its audio store */
const HERE = path.dirname(fileURLToPath(import.meta.url))
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env */ }

const args = process.argv.slice(2)
const flag = (k) => args.includes(k)
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d }
const ALL = flag('--all'), DRY = flag('--dry'), LOCAL = flag('--local'), SHOW = flag('--show'), PULL = flag('--pull')
/* the store: the repository's own copy of every recording */
const STORE = path.join(ROOT, 'audio/books')
const BOOK = val('--book', null), CHAPTER = val('--chapter', null)
const ONLY = flag('--summaries-only') ? 'summary' : flag('--text-only') ? 'full' : null
/* How many engines, sized to the machine this runs on — a laptop, the
   devcontainer, the deploy box — from what was measured (build/tts/BENCH.md):
   an engine gains almost nothing from a second thread and loses from many, so
   the fast shape is one single-threaded engine per core; one engine holds about
   0.9 GB once warm; and going past the core count is a cliff, not a plateau
   (18 engines on 12 cores ran fifty times slower than 12). So: one engine per
   core the runtime reports, capped by memory at a gigabyte each after two of
   headroom, never fewer than one. --workers N overrides the count. */
function sizeEngines() {
  const cores = Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length)
  const byMemory = Math.max(1, Math.floor((os.totalmem() / 1073741824 - 2) / 1))
  const asked = Number(val('--workers', 0))
  const n = asked > 0 ? asked : Math.min(cores, byMemory)
  return { n, cores, byMemory, asked: asked > 0 }
}
const SIZE = sizeEngines()
const WORKERS = SIZE.n
const THREADS = Number(process.env.TTS_THREADS || 1)
const log = (m) => console.log('[tts] ' + m)

/* ---- the engine and its settings: what the hash is made of ---- */
const ENGINE = {
  name: DEFAULTS.name,
  voice: process.env.TTS_VOICE || DEFAULTS.voice,
  steps: Number(process.env.TTS_STEPS || DEFAULTS.steps),
  speed: Number(process.env.TTS_SPEED || DEFAULTS.speed),
  gap: Number(process.env.TTS_GAP || DEFAULTS.gap),
}
const BITRATE = process.env.TTS_BITRATE || '128k'
const WORKER = path.join(HERE, 'tts/worker.mjs')
const WORK = path.join(HERE, 'tts/.work')

/* ---- storage: the bucket readers are served from (build/tts/storage.mjs) ---- */
import { supabaseUrl, bucket, listAll } from './tts/storage.mjs'
const BUCKET = 'audio'
let storage = null
async function getStorage() {
  if (LOCAL) return null
  if (storage) return storage
  storage = await bucket(BUCKET)
  return storage
}

/* ---- the store: what the repository holds for a book ---- */
const storeDir = (slug) => path.join(STORE, slug)
const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1'
/* an LFS pointer stands in for a blob that was not fetched: small, and it says so */
function isPointer(file) {
  try { const st = fs.statSync(file); if (st.size > 1024) return false; return fs.readFileSync(file, 'utf8').startsWith(LFS_POINTER) } catch { return false }
}
/* the recordings the store holds: real blobs, or pointers to be fetched */
function storeHas(slug) {
  const d = storeDir(slug), out = new Map()
  if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.mp3')) out.set(f, isPointer(path.join(d, f)) ? 'pointer' : 'blob')
  return out
}
function readStoreManifest(slug) {
  const f = path.join(storeDir(slug), 'index.json')
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null } catch { return null }
}
/* fetch named LFS objects — only those — from the remote */
/* ---- the remote, and how to reach it ----
   A person's machine already has GitHub credentials (a login, a credential
   helper, an SSH key) and the plain remote works. A build box has none, so it
   takes a token from the environment — TTS_GITHUB_TOKEN, else GITHUB_TOKEN or
   GH_TOKEN (a fine-grained token with Contents: read and write on this repo) —
   and every call that reaches GitHub (the LFS fetch and push, the git push) goes
   to a one-off url carrying it. The token is never written into git config, and
   never printed: anything the script logs has it blanked. */
const TOKEN = (process.env.TTS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
const blank = (s) => (TOKEN ? String(s).split(TOKEN).join('***') : String(s))
function remote() {
  let url = 'origin'
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'origin' } catch { /* no origin: the name still works for a local remote */ }
  if (!TOKEN) return 'origin'
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url)
  return m ? `https://x-access-token:${TOKEN}@github.com/${m[1]}.git` : 'origin'
}
function lfsPull(slug, names) {
  if (!names.length) return
  const include = names.map((n) => 'audio/books/' + slug + '/' + n).join(',')
  try { execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' }) } catch { throw new Error('git-lfs is not installed here, and ' + names.length + ' recording(s) for ' + slug + ' are LFS pointers; install git-lfs on this machine') }
  log(`${slug}: fetching ${names.length} recording${names.length > 1 ? 's' : ''} from LFS`)
  const paths = names.map((n) => 'audio/books/' + slug + '/' + n)
  /* the objects: from this clone's own LFS cache when it has them, else fetched
     from the remote — only these, never the whole store */
  try { execFileSync('git', ['lfs', 'fetch', remote(), '--include', include, '--exclude', ''], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] }) } catch { /* no remote, or offline: the cache may still have them */ }
  /* then the files themselves, written through the smudge filter from the cache */
  execFileSync('git', ['checkout', '--', ...paths], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  for (const n of names) if (isPointer(path.join(storeDir(slug), n))) throw new Error(slug + '/' + n + ' is still a pointer after git lfs pull')
}

/* ---- the bucket: what readers are served from ---- */
async function listBucket(slug) {
  const st = await getStorage()
  return st ? listAll(st, 'books/' + slug) : new Set()
}
async function put(slug, name, buf, type) {
  const st = await getStorage()
  if (!st) return
  const { error } = await st.upload('books/' + slug + '/' + name, buf, { contentType: type, upsert: true, cacheControl: '31536000' })
  if (error) throw new Error('storage upload ' + name + ': ' + error.message)
}
/* The bucket can hold recordings the store lacks: a deploy speaks a new book
   straight into the bucket and its working tree is thrown away. So before a
   run speaks anything it brings those down — every recording the bucket's
   manifest names that the store has no file for — so the store stays the copy
   of record and nothing is ever rendered twice. Commit what arrives. */
async function pullBook(slug) {
  const st = await getStorage()
  if (!st) return 0
  const { data, error } = await st.download('books/' + slug + '/index.json')
  if (error || !data) return 0
  let m; try { m = JSON.parse(await data.text()) } catch { return 0 }
  const held = storeHas(slug)
  let n = 0
  for (const e of Object.values(m.chapters || {})) for (const r of Object.values(e)) {
    if (!r || !r.file || held.has(r.file)) continue
    const { data: blob, error: err } = await st.download('books/' + slug + '/' + r.file)
    if (err || !blob) { log(`${slug}/${r.file}: named in the bucket's manifest but not downloadable — ${err ? err.message : 'empty'}`); continue }
    fs.mkdirSync(storeDir(slug), { recursive: true })
    fs.writeFileSync(path.join(storeDir(slug), r.file), Buffer.from(await blob.arrayBuffer()))
    n++
  }
  if (n) log(`${slug}: ${n} recording${n > 1 ? 's' : ''} brought into the store from the bucket${process.env.TTS_COMMIT ? '' : ' — commit audio/books/' + slug}`)
  return n
}

/* The bucket can also hold recordings no manifest names: a chapter a reader's
   browser spoke and shared (src/lib/tts/audiobook.js uploads under the same
   name the script would give it). Before anything is spoken, every job whose
   recording is already in the bucket is brought into the store instead —
   adopted — and its seconds taken from the object's metadata (the browser
   writes engine, format and length there) or, failing that, from its size:
   both sides write constant 128 kbps mono. */
const adoptedSeconds = new Map()
async function adoptFromBucket(slug, names, held) {
  const st = await getStorage()
  if (!st) return 0
  const wanted = names.filter((n) => !held.has(n))
  if (!wanted.length) return 0
  const inBucket = await listBucket(slug)
  let n = 0
  for (const name of wanted) {
    if (!inBucket.has(name)) continue
    const { data: blob, error } = await st.download('books/' + slug + '/' + name)
    if (error || !blob) { log(`${slug}/${name}: in the bucket but not downloadable — ${error ? error.message : 'empty'}`); continue }
    const buf = Buffer.from(await blob.arrayBuffer())
    fs.mkdirSync(storeDir(slug), { recursive: true })
    fs.writeFileSync(path.join(storeDir(slug), name), buf)
    held.set(name, 'blob')
    let seconds = null
    try { const { data } = await st.info('books/' + slug + '/' + name); seconds = Number(data && data.metadata && data.metadata.seconds) || null } catch { /* no metadata */ }
    adoptedSeconds.set(name, seconds || Math.round((buf.length * 8) / 128000))
    n++
  }
  if (n) log(`${slug}: ${n} recording${n > 1 ? 's' : ''} adopted from the bucket (spoken in a reader's browser)${process.env.TTS_COMMIT ? '' : ' — commit audio/books/' + slug}`)
  return n
}

/* ---- the repository: commit what the run put in the store, and push ---- */
function git(args, opts = {}) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch (e) { throw new Error(blank((e.stderr || e.message || String(e)).toString().trim().split('\n').pop())) }
}
function commitStore(what) {
  const mode = String(process.env.TTS_COMMIT || '').trim().toLowerCase()
  if (!mode || mode === '0' || mode === 'false') return
  let changed
  try { changed = git(['status', '--porcelain', '--', 'audio/books']) } catch (e) { log('not a git checkout, nothing committed: ' + e.message); return }
  if (!changed) { log('the store is already committed'); return }
  const files = changed.split('\n').length
  const ident = ['-c', 'user.name=' + (process.env.TTS_COMMIT_NAME || 'platformkit tts'), '-c', 'user.email=' + (process.env.TTS_COMMIT_EMAIL || 'tts@platformkit.local')]
  try {
    try { git(['lfs', 'install', '--local'], { quiet: true }) } catch { /* hooks already there, or no lfs — the push below will say */ }
    git(['add', '--', 'audio/books'])
    git([...ident, 'commit', '--quiet', '-m', `Spoken books: ${what}\n\nMade by build/tts.mjs; the recordings are Git LFS objects under audio/books.`, '--', 'audio/books'])
    log(`committed ${files} file${files > 1 ? 's' : ''} under audio/books`)
  } catch (e) { log('commit failed: ' + (e.message || e)); return }
  if (mode === 'local') return
  const branch = process.env.TTS_COMMIT_BRANCH || 'main'
  try {
    const to = remote()
    git(['lfs', 'push', to, 'HEAD'])
    git(['push', to, 'HEAD:' + branch])
    log(`pushed to ${branch}${TOKEN ? ' with the token from the environment' : ''}`)
  } catch (e) { log(`push to ${branch} failed (${blank(e.message || e)}); the commit stays local and the recordings are in the bucket — the next run that can push will carry them`) }
}

/* bring the bucket up to the store for one book: every recording the manifest
   names that the bucket lacks goes up (fetched from LFS first when this clone
   holds only the pointer), then the manifest itself */
async function syncBook(slug, manifest) {
  const st = await getStorage()
  if (!st) return { uploaded: 0 }
  const named = new Set()
  for (const e of Object.values(manifest.chapters || {})) for (const r of Object.values(e)) if (r && r.file) named.add(r.file)
  const inBucket = await listBucket(slug)
  const missing = [...named].filter((n) => !inBucket.has(n))
  const held = storeHas(slug)
  lfsPull(slug, missing.filter((n) => held.get(n) === 'pointer'))
  for (const n of missing) {
    const f = path.join(storeDir(slug), n)
    if (!fs.existsSync(f)) throw new Error(slug + '/' + n + ' is in the manifest but not in the store')
    await put(slug, n, fs.readFileSync(f), 'audio/mpeg')
  }
  await put(slug, 'index.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 'application/json')
  return { uploaded: missing.length }
}

/* ---- the engines: a pool of workers, each with the model loaded once, started
   the first time a recording is needed (the weights fetched then, if absent) ---- */
class Pool {
  constructor(n) { this.n = n; this.workers = []; this.queue = []; this.idle = []; this.starting = null }
  start() {
    if (!this.starting) this.starting = (async () => {
      const { ready, setup } = await import('./tts/setup.mjs')
      if (!ready()) { log('fetching the weights'); await setup() }
      await Promise.all(Array.from({ length: this.n }, (_, i) => this.spawn(i)))
      log(`${this.n} engine${this.n > 1 ? 's' : ''} ready (${SIZE.asked ? 'as asked' : SIZE.cores + ' cores, memory allows ' + SIZE.byMemory}; ${THREADS} thread${THREADS > 1 ? 's' : ''} each)`)
    })()
    return this.starting
  }
  spawn(i) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [WORKER], { cwd: ROOT, env: { ...process.env, TTS_THREADS: String(THREADS), TTS_VOICE: ENGINE.voice, TTS_STEPS: String(ENGINE.steps), TTS_SPEED: String(ENGINE.speed), TTS_GAP: String(ENGINE.gap) }, stdio: ['pipe', 'pipe', 'pipe'] })
      const w = { p, busy: null, buf: '' }
      p.stderr.on('data', (d) => { const s = d.toString(); if (/error|Traceback/i.test(s)) process.stderr.write(s) })
      p.stdout.on('data', (d) => {
        w.buf += d.toString()
        let nl
        while ((nl = w.buf.indexOf('\n')) >= 0) {
          const line = w.buf.slice(0, nl); w.buf = w.buf.slice(nl + 1)
          if (!line.trim()) continue
          let msg; try { msg = JSON.parse(line) } catch { continue }
          if (msg.ready) { resolve(); this.idle.push(w); this.pump(); continue }
          const job = w.busy; w.busy = null
          if (job) (msg.ok ? job.resolve(msg) : job.reject(new Error(msg.error || 'engine failed')))
          this.idle.push(w); this.pump()
        }
      })
      p.on('exit', (code) => { if (w.busy) w.busy.reject(new Error('engine exited ' + code)); reject(new Error('engine exited ' + code)) })
      this.workers.push(w)
    })
  }
  async run(job) { await this.start(); return new Promise((resolve, reject) => { this.queue.push({ ...job, resolve, reject }); this.pump() }) }
  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop(), job = this.queue.shift()
      w.busy = job
      w.p.stdin.write(JSON.stringify({ id: job.id, text: job.text, out: job.out }) + '\n')
    }
  }
  stop() { for (const w of this.workers) { try { w.p.stdin.end(); w.p.kill() } catch { /* gone */ } } }
}

/* ---- encoding: the machine's ffmpeg, else the one npm ships (ffmpeg-static), so a
   deploy box with nothing installed can still encode ---- */
async function ffmpeg() {
  for (const c of [process.env.FFMPEG, 'ffmpeg']) { try { if (c) { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c } } catch { /* next */ } }
  try { const m = await import('ffmpeg-static'); const c = m.default || m; if (c && fs.existsSync(c)) return c } catch { /* not installed */ }
  return null
}
const FFMPEG = await ffmpeg()
function encode(wav, out) {
  if (!FFMPEG) throw new Error('no ffmpeg: install it, or npm i -D ffmpeg-static')
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-b:a', BITRATE, out])
}

/* ---- the work ---- */
const hashOf = (text) => createHash('sha1').update(hashInput(text, ENGINE)).digest('hex').slice(0, 16)
const stats = { spoken: 0, kept: 0, uploaded: 0, pulled: 0, chars: 0, seconds: 0, t0: Date.now() }

function chaptersOf(bookRaw) {
  const { content, data } = matter(bookRaw)
  /* the book's introduction (frontmatter) is its own page in the reader, ahead
     of chapter one and the same in either mode: one recording of its own */
  return { chapters: bookChapters(content), intro: data && data.introduction ? String(data.introduction).trim() : '' }
}

/* one recording: named by its text, kept when the store has it, else spoken,
   encoded into the store, and counted */
async function speakOne(pool, slug, held, text, label) {
  const hash = hashOf(text), name = hash + '.mp3'
  stats.chars += text.length
  if (held.has(name)) { stats.kept++; return { file: name, chars: text.length, cached: true, seconds: adoptedSeconds.get(name) } }
  if (DRY) { stats.spoken++; return { file: name, chars: text.length, planned: true } }
  const dir = path.join(WORK, slug); fs.mkdirSync(dir, { recursive: true })
  const wav = path.join(dir, hash + '.wav')
  const t = Date.now()
  const spoken = await pool.run({ id: hash, text, out: wav })
  const seconds = Math.round(spoken.seconds || 0)
  fs.mkdirSync(storeDir(slug), { recursive: true })
  encode(wav, path.join(storeDir(slug), name))
  fs.rmSync(wav, { force: true })
  held.set(name, 'blob')
  stats.spoken++; stats.seconds += seconds
  log(`${label}: ${text.length.toLocaleString()} chars → ${seconds}s of audio in ${Math.round((Date.now() - t) / 1000)}s`)
  return { file: name, chars: text.length, seconds }
}

async function doBook(pool, slug) {
  const bookFile = path.join(ROOT, 'content/books', slug + '.md')
  if (!fs.existsSync(bookFile)) { log(slug + ': no such book'); return }
  const bookText = fs.readFileSync(bookFile, 'utf8')
  const { chapters, intro } = chaptersOf(bookText)
  /* a book whose text is withheld is spoken as its introduction and its summaries, never its chapters' text */
  const withheld = matter(bookText).data.fullText === false
  const compFile = path.join(ROOT, 'content/companions', slug + '.md')
  const summaries = {}
  if (fs.existsSync(compFile)) for (const c of parseCompanionBody(matter(fs.readFileSync(compFile, 'utf8')).content).chapters) if (c.summaryMd) summaries[c.title] = c.summaryMd
  if (!DRY && !SHOW) stats.pulled += await pullBook(slug)
  const held = storeHas(slug)
  const manifest = readStoreManifest(slug) || { book: slug, chapters: {} }
  manifest.chapters = manifest.chapters || {}
  manifest.engine = ENGINE
  /* every recording the book needs, handed to the pool at once so every engine is busy */
  const jobs = []
  if (intro && (!CHAPTER || CHAPTER === INTRO_KEY) && ONLY !== 'summary') jobs.push({ title: INTRO_KEY, kind: 'full', text: chapterSpeech({ intro: true, md: intro }) })
  for (const c of chapters) {
    if (CHAPTER && c.title !== CHAPTER) continue
    if (ONLY !== 'summary' && !withheld) jobs.push({ title: c.title, kind: 'full', text: chapterSpeech(c) })
    if (ONLY !== 'full' && summaries[c.title]) jobs.push({ title: c.title, kind: 'summary', text: chapterSpeech(c, summaries[c.title]) })
  }
  /* --show: the words as they would be spoken, and nothing spoken */
  if (SHOW) { for (const j of jobs) console.log(`\n===== ${slug} · ${j.title} · ${j.kind} (${j.text.length} chars)\n${j.text}`); return }
  if (!DRY) stats.pulled += await adoptFromBucket(slug, jobs.filter((j) => j.text).map((j) => hashOf(j.text) + '.mp3'), held)
  /* What is already in the store goes up before anything is spoken, and every
     recording made here goes up the moment it is encoded, the manifest after it:
     a chapter takes minutes and a book an hour or more, longer than a deploy is
     allowed to run, so a run that is cut off keeps its progress in the bucket
     and the next one — the pull at its start — carries on from there rather
     than speaking the same chapters again. The store's manifest is written at
     the same moments, so a build after a cut-off run still describes what
     exists. Uploads are serialised behind one promise; a failed one is logged
     and retried by the final sync, which is what fails the run if it still cannot. */
  let uploaded = 0
  const writeManifest = () => { fs.mkdirSync(storeDir(slug), { recursive: true }); fs.writeFileSync(path.join(storeDir(slug), 'index.json'), JSON.stringify(manifest, null, 2) + '\n') }
  if (!DRY) { uploaded += (await syncBook(slug, manifest)).uploaded }
  let publishing = Promise.resolve()
  const publish = (file) => (publishing = publishing.then(async () => {
    writeManifest()
    if (LOCAL) return
    await put(slug, file, fs.readFileSync(path.join(storeDir(slug), file)), 'audio/mpeg')
    await put(slug, 'index.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 'application/json')
    uploaded++
  }).catch((e) => log(`${slug}/${file}: not uploaded yet — ${e.message}`)))
  await Promise.all(jobs.filter((j) => j.text).map(async (j) => {
    const r = await speakOne(pool, slug, held, j.text, `${slug} · ${j.title} · ${j.kind}`)
    const entry = manifest.chapters[j.title] || (manifest.chapters[j.title] = {})
    if (r.planned) return
    entry[j.kind] = { file: r.file, chars: r.chars, seconds: r.seconds ?? (entry[j.kind] && entry[j.kind].file === r.file ? entry[j.kind].seconds : null) }
    if (!r.cached && !DRY) await publish(r.file)
  }))
  await publishing
  for (const t of Object.keys(manifest.chapters)) if (t !== INTRO_KEY && !chapters.some((c) => c.title === t)) delete manifest.chapters[t]
  if (!intro) delete manifest.chapters[INTRO_KEY]
  manifest.generated = new Date().toISOString().slice(0, 10)
  if (!DRY) {
    writeManifest()
    /* the final sync: the pruned manifest, and any recording an upload above
       missed; a recording the manifest no longer names is left in the store as cache */
    uploaded += (await syncBook(slug, manifest)).uploaded
    stats.uploaded += uploaded
  }
  log(`${slug}: ${intro ? 'an introduction · ' : ''}${chapters.length} chapters · ${Object.keys(summaries).length} summaries${uploaded ? ' · ' + uploaded + ' uploaded' : ''}`)
}

async function main() {
  const slugs = ALL ? fs.readdirSync(path.join(ROOT, 'content/books')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : BOOK ? [BOOK] : []
  if (!slugs.length) { console.error('usage: node build/tts.mjs --book <slug> [--chapter <title>] | --all   [--dry] [--local] [--workers N] [--summaries-only|--text-only]'); process.exit(1) }
  log(`engine ${ENGINE.name} (voice ${ENGINE.voice}, ${ENGINE.steps} steps, speed ${ENGINE.speed}) · store audio/books${LOCAL ? ' only' : ' → ' + supabaseUrl() + ' bucket ' + BUCKET}${DRY ? ' · dry run' : ''}`)
  if (PULL) {
    let n = 0
    for (const s of slugs) n += await pullBook(s)
    log(n ? `${n} recording${n > 1 ? 's' : ''} pulled${process.env.TTS_COMMIT ? '' : ' — commit audio/books'}` : 'the store already holds everything the bucket names')
    if (n) commitStore(`${n} recording${n > 1 ? 's' : ''} pulled from the bucket`)
    return
  }
  const pool = DRY ? null : new Pool(WORKERS)
  try {
    /* every book at once: their recordings share the one queue, so the engines
       stay busy across books instead of idling while a book's longest chapter
       finishes; each book still writes its own manifest the moment it is done */
    if (DRY || SHOW) for (const s of slugs) await doBook(pool, s)
    else await Promise.all(slugs.map((s) => doBook(pool, s)))
  } catch (e) { log('stopped: ' + e.message); process.exitCode = 1 }
  finally {
    if (pool) pool.stop()
    const mins = Math.round((Date.now() - stats.t0) / 60000)
    log(`${DRY ? 'would speak' : 'spoke'} ${stats.spoken} recordings (${stats.kept} already in the store) · ${stats.uploaded} uploaded · ${stats.pulled} pulled · ${stats.chars.toLocaleString()} characters${stats.seconds ? ' · ' + Math.round(stats.seconds / 60) + ' min of audio' : ''} · ${mins} min`)
  }
  /* what changed the store goes into the repository, when asked (TTS_COMMIT) */
  if (!DRY && !SHOW && (stats.spoken || stats.pulled)) {
    const bits = []
    if (stats.spoken) bits.push(`${stats.spoken} spoken`)
    if (stats.pulled) bits.push(`${stats.pulled} pulled from the bucket`)
    commitStore(bits.join(', ') + ' for ' + slugs.join(', '))
  }
  /* the app learns of a recording from the manifest velite read at ITS last
     build, so a run that spoke anything rebuilds the content — the dev server
     picks the new .velite up at once; the deploy builds again right after anyway */
  if (!DRY && !SHOW && stats.spoken && !flag('--no-rebuild')) {
    log('rebuilding the content so the app sees the new recordings')
    const { build } = await import('velite')
    await build({ clean: false })
  }
}
main().catch((e) => { console.error('[tts] ' + (e.message || e)); process.exit(1) })
