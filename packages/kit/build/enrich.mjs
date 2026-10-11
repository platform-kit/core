#!/usr/bin/env node
/*
 * The enrichment pipeline: a book in, its introduction and companion out.
 *
 *   node build/enrich.mjs --book the-golden-key            plan: what would run
 *   node build/enrich.mjs --book the-golden-key --write    run it and write the files
 *   node build/enrich.mjs --all --write --review           every book, and a page to read
 *   --chapter <title>   only these chapters (repeatable) — the way to sample a change
 *   --stage introduce   stop after the introduction (the admin's Introductions button)
 *   --force             redo stages whose inputs have not changed
 *   --write-model <id>  a different model for the stages that write prose
 *   --max-spend <usd>   the most a single book may cost in one run (default 1.00); a book that
 *                       reaches it stops where it is, keeps what it has, and says so
 *   --model / --thinking  see build/llm.mjs
 *
 * Seven stages, each a narrow task with a stored result, each verified before
 * the next: understand (the map of the book) → introduce → extract (every idea
 * in a chapter, anchored to the text) → write (against that contract) → audit
 * (a second reader lists what is missing, wrong or off the brief; the writer
 * fixes it; capped) → book lines → assemble. Every stage's output is cached in
 * build/.cache/<slug>.json under a hash of its inputs and prompt version, so a
 * rerun redoes only what changed and a dropped connection loses one stage of
 * one chapter. Nothing here depends on a book's formatting or length: chapters
 * travel together in a call up to a source-size limit, and that is the only
 * number. Prompts are the site's: platformkit.config.js enrichment.briefs names the module (the site's
 * build/briefs.mjs over build/voice.mjs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as llm from './llm.mjs'
import { costLine } from './llm.mjs'
import { pipeline } from './enrich/pipeline.mjs'
import { loadSite } from './site.mjs'
import { fileCache } from './enrich-cache.mjs'
import { asStore } from './store/index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.cwd()   /* the site */
/* the voice: the site's briefs (platformkit.config.js enrichment.briefs — a module exporting the six stage prompts, written over its own voice.mjs) */
const SITE = await loadSite(ROOT)
const BRIEFS = SITE.enrichment && SITE.enrichment.briefs
if (!BRIEFS) { console.error('platformkit.config.js: enrichment.briefs names no module — the enrichment has no voice to write in'); process.exit(1) }
const briefs = await import(pathToFileURL(path.resolve(ROOT, BRIEFS)).href)
const BOOKS = 'content/books'   /* for --all; the pipeline has its own paths */
const CACHE = path.join(ROOT, 'build/.cache'), REVIEW = path.join(ROOT, 'build/enrich-review.html')   /* the site's, gitignored beside its own build scripts */

const argv = process.argv.slice(2)
const flag = (k) => argv.includes(k)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const many = (k) => argv.flatMap((a, i) => (a === k && argv[i + 1] ? [argv[i + 1]] : []))
const ALL = flag('--all'), WRITE_OUT = flag('--write'), FORCE = flag('--force'), REVIEW_ON = flag('--review')
const STAGE = opt('--stage', 'all'), WRITE_MODEL = opt('--write-model', '')
const MAX_SPEND = Number(opt('--max-spend', '1'))   /* dollars per book per run, at list price */
const wantedBooks = many('--book'), wantedChapters = many('--chapter')
if (!ALL && !wantedBooks.length) { console.log('name a book with --book <slug>, or --all'); process.exit(1) }
const slugs = ALL ? await asStore(ROOT).list(BOOKS) : wantedBooks

/*
 * THE PIPELINE, BUILT FROM THE FLAGS. Everything above this line is the command: what was typed,
 * where the site is, which briefs it writes in. Everything below the stages is in ./enrich/pipeline.mjs,
 * which knows none of it — see the note at the top of that file for why the two are apart.
 */
const { enrich } = pipeline({ briefs, llm, log: (...a) => console.log(...a),
  force: FORCE, writeModel: WRITE_MODEL, maxSpend: MAX_SPEND, stage: STAGE, chapters: wantedChapters, write: WRITE_OUT, review: REVIEW_ON })

/* the cache is a FILE here and the agent run's own state in the cloud (build/enrich-cache.mjs).
   The stages read the loaded blob either way and never know which; only SAVING differs, which is
   why every stage that saves mid-way is handed a `save` rather than reaching for the disk. */
const cacheFor = (slug) => fileCache(slug, { root: ROOT, fs, path })

/* ---- the review page ---- */
const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
function reviewPage(reports) {
  return `<!doctype html><meta charset="utf-8"><title>Enrichment review</title>
<style>body{font:16px/1.5 Georgia,serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1a1408;background:#fbfaf3}h1{font-size:28px;margin:48px 0 8px}h1 small{font:13px monospace;color:#777;margin-left:10px}h2{font-size:20px;margin:36px 0 8px;border-top:1px solid #e6e2d6;padding-top:18px}.meta{background:#f1eee2;padding:12px 16px;border-radius:8px}.ess{padding-left:18px}.quiz li{margin:10px 0}.quiz ul{list-style:none;padding-left:14px}.right{color:#0a7d4b;font-weight:600}.why{color:#666;font-size:14px}.bad{color:#b00}mark{background:#ffe9a8}</style>
<p>Generated ${new Date().toISOString()} with ${esc(llm.MODEL)} · read before trusting it; edit in the admin under Companions.</p>` + reports.map((r) => `
<section><h1>${esc(r.title)} <small>${esc(r.author)} · ${esc(r.slug)}</small></h1>
${r.data ? `<div class="meta"><p><b>Insight</b> ${esc(r.data.insight)}</p><p><b>Statement</b> ${esc(r.data.statement)} <code>${esc(r.data.statementArea)} ${esc(r.data.statementLevel)}</code></p></div>` : ''}
${r.failed.length ? `<p class="bad">Failed: ${esc(r.failed.join(', '))}</p>` : ''}
${(r.ordered || []).map((c) => `<article><h2>${esc(c.title)}</h2>${r.notes && r.notes[c.title] ? `<p class="bad">${esc(r.notes[c.title])}</p>` : ''}<div>${esc(c.summaryMd).replace(/==([^=]+)==\{[a-z]+\}/g, '<mark>$1</mark>').replace(/\n\n/g, '</p><p>')}</div><ul class="ess">${c.essence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><ol class="quiz">${c.quiz.map((q) => `<li><p>${esc(q.q)}</p><ul>${q.options.map((o, j) => `<li class="${j === q.answer ? 'right' : ''}">${esc(o)}</li>`).join('')}</ul>${q.why ? `<p class="why">${esc(q.why)}</p>` : ''}</li>`).join('')}</ol></article>`).join('')}
</section>`).join('')
}

/* ---- main ---- */
const reports = []
for (const slug of slugs) {
  /* what THIS book cost is the run's own arithmetic: the pipeline keeps its own guard, and the
     script has always printed the figure per book rather than only the total */
  const before = llm.spentUsd()
  try { reports.push(await enrich(slug, { store: ROOT, cache: cacheFor(slug) })) }
  catch (e) { console.log(`\n${slug}: ${e.message}`); reports.push({ slug, title: slug, author: '', failed: [e.message] }) }
  const spent = llm.spentUsd() - before
  console.log(`  this book: ≈ ${spent.toFixed(3)} at list price${spent >= MAX_SPEND ? ' — stopped by the spend guard' : ''}`)
}
if (REVIEW_ON) { fs.writeFileSync(REVIEW, reviewPage(reports)); console.log(`\nreview page: build/enrich-review.html`) }
console.log(`\n${costLine()}`)
const failed = reports.flatMap((r) => r.failed.map((f) => r.slug + ': ' + f))
if (failed.length) { console.log('\nfailed:\n  ' + failed.join('\n  ')); process.exitCode = 1 }
if (!WRITE_OUT) console.log('\n(nothing written — add --write)')
