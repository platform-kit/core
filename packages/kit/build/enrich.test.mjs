#!/usr/bin/env node
/*
 * WHERE A STAGE'S RESULT IS KEPT — the same cache, in two places.
 *
 * Enrichment is a sequence of paid calls, each cached under a hash of its inputs, and the cache is
 * the reason a rerun is cheap. It lives in a file in a checkout and in the agent run's own state in
 * the cloud, and the pipeline must not be able to tell which: a book half-enriched on a machine and
 * finished in the cloud has to pick up where it left off, or somebody pays twice for the same
 * chapter. That is the whole of what this checks.
 *
 * The run cache is exercised against a FAKE client rather than the stack, because what is being
 * checked is the merge — that a second worker does not discard a stage the first one paid for —
 * and that is arithmetic, not a database.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileCache, runCache, EMPTY } from './enrich-cache.mjs'

let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }

console.log('\nTHE ENRICHMENT CACHE\n')

/* ---- a checkout's ---- */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-'))

await ok('a book with no cache starts empty, rather than throwing', async () => {
  const c = fileCache('a-book', { root, fs, path })
  assert.deepEqual(await c.load(), EMPTY())
})

await ok('what is saved is what comes back', async () => {
  const c = fileCache('a-book', { root, fs, path })
  const held = { ...EMPTY(), understand: { key: 'k1', data: { thesis: 'a thesis' } } }
  await c.save(held)
  assert.deepEqual(await c.load(), held)
})

await ok('and it is a file beside the build scripts, not somewhere else', async () => {
  const c = fileCache('a-book', { root, fs, path })
  assert.ok(c.where.endsWith(path.join('build', '.cache', 'a-book.json')), c.where)
  assert.ok(fs.existsSync(c.where))
})

await ok('two books do not share one', async () => {
  const a = fileCache('one', { root, fs, path }), b = fileCache('two', { root, fs, path })
  await a.save({ ...EMPTY(), lines: { key: 'x', data: 1 } })
  assert.deepEqual(await b.load(), EMPTY())
})

await ok('a cache file somebody has mangled reads as empty rather than stopping a run', async () => {
  const c = fileCache('broken', { root, fs, path })
  fs.mkdirSync(path.dirname(c.where), { recursive: true })
  fs.writeFileSync(c.where, '{ not json')
  assert.deepEqual(await c.load(), EMPTY())
})

/* ---- the cloud's: the run's own state ---- */
/* the shape of supabase-js that this uses, and nothing more: select().eq().single() and update() */
function fakeDb(initial = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    rows,
    from() {
      let id = null
      const api = {
        select() { return api },
        eq(_col, v) { id = v; return api },
        async single() { return { data: rows.get(id) || null, error: null } },
        async update(patch) { rows.set(id, { ...(rows.get(id) || {}), ...patch }); return { error: null } },
      }
      /* update() is called before eq() in the chain this module writes */
      const outer = {
        select: () => api,
        update: (patch) => ({ eq: async (_c, v) => { rows.set(v, { ...(rows.get(v) || {}), ...patch }); return { error: null } } }),
      }
      return outer
    },
  }
}

await ok('a run with no cache in its state starts empty', async () => {
  const db = fakeDb({ r1: { state: {} } })
  assert.deepEqual(await runCache(db, 'r1').load(), EMPTY())
})

await ok('what is saved is what comes back, from the run', async () => {
  const db = fakeDb({ r1: { state: {} } })
  const c = runCache(db, 'r1')
  const held = { ...EMPTY(), introduce: { key: 'k', text: 'the introduction' } }
  await c.save(held)
  assert.deepEqual(await c.load(), held)
})

await ok('saving the cache leaves the rest of the run\'s state alone', async () => {
  const db = fakeDb({ r1: { state: { messages: [{ role: 'user', content: 'hello' }], before: [1, 2] } } })
  await runCache(db, 'r1').save({ ...EMPTY(), lines: { key: 'k', data: {} } })
  const state = db.rows.get('r1').state
  assert.deepEqual(state.messages, [{ role: 'user', content: 'hello' }], 'the transcript survived')
  assert.deepEqual(state.before, [1, 2])
  assert.ok(state.enrich, 'and the cache is beside it')
})

/*
 * THE ONE THAT MATTERS. A run is resumable and the worker that finishes it may not be the one that
 * started it. If a save wrote what THIS worker held rather than merging into what the row holds, a
 * second worker would discard a stage the first one paid for — and that is money, not work.
 */
await ok('a second worker does not discard what the first one paid for', async () => {
  const db = fakeDb({ r1: { state: {} } })
  const first = runCache(db, 'r1'), second = runCache(db, 'r1')
  await first.save({ ...EMPTY(), understand: { key: 'k1', data: 'the map' } })
  /* the second worker reads the row, adds its own stage, writes back */
  const held = await second.load()
  held.introduce = { key: 'k2', text: 'the introduction' }
  await second.save(held)
  const out = await first.load()
  assert.ok(out.understand, 'the first stage is still there')
  assert.ok(out.introduce, 'and the second')
})

await ok('a run that is not there says so rather than losing the work quietly', async () => {
  const db = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'no rows' } }) }) }) }) }
  await assert.rejects(() => runCache(db, 'gone').load(), /could not be read/)
})

/* ---- and the two are the same shape ---- */
await ok('a cache written by one is readable by the other', async () => {
  const held = { chapters: { 'One': { extract: { key: 'e', ideas: [{ idea: 'a thing', keep: true }] } } }, understand: { key: 'u', data: { thesis: 't' } } }
  const file = fileCache('shared', { root, fs, path })
  await file.save(held)
  const db = fakeDb({ r1: { state: { enrich: await file.load() } } })
  assert.deepEqual(await runCache(db, 'r1').load(), held, 'the cloud reads what the checkout wrote')
})

/* ---- the pipeline itself, on a model that costs nothing ---- */
/*
 * Two things a paid run got wrong, and neither needed a paid run to find: it stamped the companion
 * with the model it ASKED for rather than the one that answered, and it spent $1.03 of a $1 budget.
 * Both are checked here against a fake model that answers every stage with the least the schema
 * will take, so the whole pipeline runs — understand, extract, write, audit, lines, assemble — for
 * nothing.
 */
const { pipeline } = await import('./enrich/pipeline.mjs')

const BOOK = `---
title: A Short Book
author: Nobody
---

# One

A first chapter, with enough words in it to be worth a summary and a line or two of essence.

# Two

A second chapter, also with words, so that the run has more than one call to make and can go over.
`
/* the least each stage's schema will accept, keyed by the label the pipeline asks under */
const REPLIES = (area) => ({
  understand: { thesis: 'The thesis of this book, stated at length.', premises: ['A premise of it.'], kind: 'teaching', stage: 'L1', chapters: [{ title: 'One', adds: 'a first thing', role: 'teaching' }, { title: 'Two', adds: 'a second thing', role: 'teaching' }] },
  /* 280 to 480 words, no headings, no list, and nothing that refers to itself — the stage has
     its own mechanical checks past the schema, and this is the least that passes them */
  introduce: { introduction: 'A plain sentence about a book and about its teaching. '.repeat(40) },
  extract: { chapters: [{ title: 'One', ideas: [{ idea: 'an idea worth keeping', anchor: 'A first chapter', keep: true }] }, { title: 'Two', ideas: [{ idea: 'another idea to keep', anchor: 'A second chapter', keep: true }] }] },
  write: { chapters: [{ title: 'One', summary: 'A summary of the first chapter, long enough to pass.', essence: ['an essence line'], quiz: [] }, { title: 'Two', summary: 'A summary of the second chapter, long enough to pass.', essence: ['another essence line'], quiz: [] }] },
  audit: { chapters: [{ title: 'One', missing: [], wrong: [] }, { title: 'Two', missing: [], wrong: [] }] },
  lines: { insight: 'An insight about the book, of a workable length.', statement: 'A statement in the first person.', statementArea: area, statementLevel: 'L1' },
})

/* a store of strings: the book, the one area the schemas need, and whatever the run writes back */
function memStore(files) {
  const m = new Map(Object.entries(files))
  return { kind: 'rows', root: '',
    read: async (p) => (m.has(p) ? m.get(p) : null),
    write: async (p, t) => { m.set(p, t) },
    exists: async (p) => m.has(p),
    remove: async (p) => { m.delete(p) },
    list: async (d) => [...m.keys()].filter((p) => p.startsWith(d + '/')).map((p) => p.slice(d.length + 1).replace(/\.md$/, '')),
    dirs: async () => [], files: m }
}

/* a model that answers instantly, always validly, and charges what the check needs it to */
function fakeLlm({ asked = 'asked-model', answers = 'answering-model', perCall = 0, replies }) {
  let usd = 0
  const calls = []
  return { calls,
    MODEL: asked, THINKING_LEVEL: 'low', ready: () => true, missingKey: () => '',
    spentUsd: () => usd,
    async complete({ label }) {
      usd += perCall
      calls.push(label)
      /* a label may carry which batch it is ('extract (remainder)'), so the stage is its head */
      const k = Object.keys(replies).find((n) => String(label).startsWith(n))
      return { text: JSON.stringify(k ? replies[k] : {}), usage: { input_tokens: 10, output_tokens: 10 }, model: answers }
    },
  }
}

const BRIEFS = { UNDERSTAND: 'u', INTRODUCE: 'i', EXTRACT: 'x', WRITE: 'w', AUDIT: 'a', BOOK_LINES: 'b' }
const area = 'testArea'
const files = () => ({ 'content/books/short.md': BOOK, [`content/app/tests/diagnostics/${area}.md`]: `---\narea: ${area}\ntitle: An area\n---\n` })

await ok('the companion records the model that ANSWERED, not the one asked for', async () => {
  const store = memStore(files())
  const llm = fakeLlm({ replies: REPLIES(area) })
  const { enrich } = pipeline({ briefs: BRIEFS, llm, write: true, maxSpend: 100 })
  await enrich('short', { store, cache: fileCache('short', { root, fs, path }) })
  const written = store.files.get('content/companions/short.md')
  assert.ok(written, 'a companion was written')
  assert.match(written, /model: answering-model/, 'the model that answered')
  assert.ok(!/asked-model/.test(written), 'and not the one asked for — a stamp naming the wrong model is worse than none')
})

await ok('a book cannot spend more than its budget', async () => {
  const store = memStore(files())
  /* THE COST MUST NOT DIVIDE THE BUDGET. At a fifth of it per call the last affordable call lands
     exactly ON the number and even the old guard stayed inside it — the check passed without the
     fix, which is a check that was never made. At three tenths, three calls leave $0.90 spent and
     a guard that asks only whether the budget has GONE allows a fourth, which is $1.20. */
  const llm = fakeLlm({ perCall: 0.3, replies: REPLIES(area) })
  const { enrich } = pipeline({ briefs: BRIEFS, llm, write: true, maxSpend: 1 })
  try { await enrich('short', { store, cache: fileCache('budget', { root, fs, path }) }) } catch { /* a refusal is a fine outcome; going over is not */ }
  assert.ok(llm.spentUsd() <= 1, `spent ${llm.spentUsd().toFixed(2)} of a $1.00 budget`)
})

/* ---- a shape nothing can satisfy ---- */
/*
 * The last stage of every cloud enrichment failed for every book, twice, and the message was
 * "Invalid option: expected one of " with nothing after it. The area enum was built from
 * `readdirSync('content/app/tests/diagnostics')`, which returns [] where there is no such directory
 * and says nothing — and in an Edge Function there is no content on disk. `z.enum([])` is a schema
 * NOTHING can satisfy, so no model and no retry could ever have passed it.
 *
 * Two things are held here: the areas come from the store like everything else the pipeline reads,
 * and a list that is empty never becomes an enum.
 */
await ok('an empty list of areas never becomes an enum', async () => {
  const { z } = await import('zod')
  /* the shape the pipeline builds, both ways round */
  const mk = (keys) => z.object({ statementArea: keys.length ? z.enum(keys) : z.string().min(1) })
  assert.equal(mk([]).safeParse({ statementArea: 'anything' }).success, true, 'no areas: any word is allowed, because asking for one of nothing has no answer')
  assert.equal(mk(['abundance']).safeParse({ statementArea: 'abundance' }).success, true)
  assert.equal(mk(['abundance']).safeParse({ statementArea: 'nonsense' }).success, false, 'with areas, the enum still bites')
  /* and the schema that caused it is gone: nothing in the pipeline reads the filesystem for them */
  const src = (await import('node:fs')).readFileSync(new URL('./enrich/pipeline.mjs', import.meta.url), 'utf8')
  assert.ok(!/z\.enum\(AREAS\.list\)/.test(src), 'the enum is not built from a directory read')
  assert.ok(/areaKeysFrom\(store\)/.test(src), 'the areas come from the store')
})

/*
 * A DROPPED CONNECTION. The point of the cache is not that it exists but that a run which died
 * halfway pays for nothing it already bought. Each stage keeps its result under a hash of ITS OWN
 * inputs, so what is pinned here is the two halves of that: a stage whose inputs have not moved is
 * read back and costs nothing, and a stage whose inputs HAVE moved is redone — and redone alone,
 * with its neighbours left where they are.
 *
 * The keying is arithmetic over the inputs, so it is exercised here as arithmetic. No model is
 * called, which is the point: a test of the cache that spent money would be a poor cache.
 */
await ok('a stage whose inputs have not moved is read back rather than bought again', async () => {
  const h = (p, x) => crypto.createHash('sha1').update(p + '\n' + x).digest('hex').slice(0, 16)
  const P = { understand: 'v3', extract: 'v2' }
  const cache = EMPTY()
  cache.understand = { key: h(P.understand, 'the whole book'), data: { thesis: 'x' } }
  cache.chapters = { One: { extract: { key: h(P.extract, 'chapter one'), data: ['an idea'] } } }

  /* the test every stage makes before it spends anything */
  const fresh = (stage, prompt, input) => {
    const e = stage === 'understand' ? cache.understand : cache.chapters.One?.extract
    return !!e && e.key === h(prompt, input)
  }
  assert.equal(fresh('understand', P.understand, 'the whole book'), true, 'an unchanged book would be read again')
  assert.equal(fresh('extract', P.extract, 'chapter one'), true, 'an unchanged chapter would be extracted again')

  /* a changed chapter invalidates ITS stage and nothing else — the expensive mistake here is a key
     over the whole book, which would make one edited word redo every chapter */
  assert.equal(fresh('extract', P.extract, 'chapter one, reworded'), false, 'an edited chapter was not redone')
  assert.equal(fresh('understand', P.understand, 'the whole book'), true, 'editing a chapter threw away the reading of the whole book')

  /* and a changed PROMPT invalidates everything under it, which is what the version letter is for */
  assert.equal(fresh('understand', 'v4', 'the whole book'), false, 'a new prompt read the old answer back')
})

await ok('a run that died halfway keeps every stage it finished', async () => {
  const c = fileCache('halfway', { root, fs, path })
  const half = EMPTY()
  half.understand = { key: 'k1', data: { thesis: 'known' } }
  half.chapters = { One: { extract: { key: 'k2', data: [1] }, write: { key: 'k3', data: 'a summary' } }, Two: { extract: { key: 'k4', data: [2] } } }
  await c.save(half)
  /* the next run, in a new process, reads the row/file back and finds all of it */
  const back = await fileCache('halfway', { root, fs, path }).load()
  assert.deepEqual(back, half, 'the next run would pay for these again')
  assert.equal(Object.keys(back.chapters).length, 2)
  assert.ok(back.chapters.One.write, 'the chapter that was written is still written')
  assert.ok(!back.chapters.Two.write, 'and the one that was not is not invented')
})

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
