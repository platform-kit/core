/*
 * THE ENRICHMENT PIPELINE ITSELF — the seven stages, and nothing about how it was started.
 *
 * It was one file, and the file was a CLI to its bones: it read `process.argv` at module scope,
 * called `process.exit(1)` when no book was named, and pulled the site's briefs in by a filesystem
 * path. Importing it from an Edge Function would have ended the invocation before the first stage.
 * So the shape is print.mjs's: a script over a module that knows nothing about where it runs.
 *
 * NOTHING HERE TOUCHES A DISK, AN ARGV OR A CONSOLE. The three things that differ between a machine
 * and a worker are handed in:
 *
 *   briefs   the six stage prompts (the site's module on a machine; compiled in beside the
 *            functions in the cloud) — the enrichment's voice, which is never the kit's
 *   llm      the model layer: MODEL, THINKING_LEVEL, complete, ready, missingKey, spentUsd. A run
 *            in the cloud has its own provider and its own spend accounting, and a job whose calls
 *            are not counted against its budget is a job with no budget, so the run's layer wins
 *   log      one line of progress. The script prints it; a run records it as a step
 *
 * and per book, `enrich(slug, { store, cache })` — the content, and where a stage's result is kept
 * between calls. Neither is known to the stages: they are handed a book and a blob. Both are
 * REQUIRED: a default of "the current directory" is how a module quietly becomes a machine's again.
 */
import matter from 'gray-matter'
import { z } from 'zod'
import { parseCompanion, serialiseCompanion, bookChapterTitles, chapterHash, LEVELS } from '../companion-io.mjs'
import { asStore } from '../store/index.mjs'

const BOOKS = 'content/books', COMPANIONS = 'content/companions'   /* the store's paths: relative to the site, never a disk's */
const DUMP = { lineWidth: -1 }
export const P = { understand: 'u1', introduce: 'i1', extract: 'x2', write: 'w1', audit: 'a1', lines: 'b1' }   /* prompt versions, one per stage */
const SOURCE_CAP = 6000        /* words of source per call: the model's attention, not a rule about content */
const UNDERSTAND_CAP = 120000  /* words of text the map is read from; a longer book is read to here */
const MAX_ROUNDS = 3           /* a draft and two fixes: the loop ends when nothing is missing and nothing is wrong */

/*
 * A RUN THAT HAS TO COME BACK. An Edge Function has minutes; a book has more stages than that, and
 * a stage killed halfway is a model call paid for and thrown away. So a caller with a clock hands
 * in a `deadline` and the pipeline stops BEFORE a call it has not got time for, throwing this.
 *
 * It is not an error: every stage that finished is in the cache, saved as it went, so the next
 * invocation picks up exactly where this one left off and pays for nothing twice. The script hands
 * in no deadline and never sees it.
 */
export class Paused extends Error {}

export function pipeline({ briefs, llm, log = () => {}, force = false, writeModel = '', maxSpend = 1, stage = 'all', chapters: wantedChapters = [], write = false, review = false, deadline = 0 }) {
  const { UNDERSTAND, INTRODUCE, EXTRACT, WRITE, AUDIT, BOOK_LINES } = briefs
  const { MODEL, THINKING_LEVEL, complete, ready, missingKey, spentUsd } = llm
  let bookStart = 0
  /*
   * THE GUARD LEAVES ROOM FOR THE CALL IT IS ABOUT TO MAKE.
   *
   * Asked only whether the budget had already been passed, it refused the call AFTER the one that
   * went over — so a book with a dollar to spend spent $1.03, and a run's `budget_cents` was a
   * number the run could exceed. Which is the wrong shape for anything about money in this project.
   *
   * A call's cost is not known before it is made, so the budget keeps back the dearest call this
   * run has seen: the next one is refused once there is no longer room for one of those. That
   * bounds the overrun by a call that is smaller than one already paid for, and in practice keeps
   * the total under the number. The first call has nothing to go on and is never refused — a budget
   * that buys nothing at all is not a budget.
   */
  let dearest = 0
  const overBudget = () => spentUsd() - bookStart + dearest >= maxSpend

  /* ---- helpers ---- */
  const wordsOf = (t) => String(t || '').split(/\s+/).filter(Boolean).length
  const h = (...parts) => chapterHash(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n '), 'enrich')
  const norm = (t) => String(t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  function extractJson(text) { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('no JSON in the reply'); return JSON.parse(text.slice(a, b + 1)) }
  async function loadBook(slug, store) {
    const raw = await store.read(`${BOOKS}/${slug}.md`)
    if (raw == null) throw new Error(`no book called ${slug}`)
    const fm = matter(raw)
    const chapters = fm.content.split(/^(?=# )/m).filter((s) => s.trim()).map((part) => {
      const m = /^# (.*)$/m.exec(part), md = part.replace(/^# .*$/m, '').trim()
      return { title: m ? m[1].trim() : 'Untitled', md, words: wordsOf(md) }
    })
    return { slug, fm, title: fm.data.title || slug, author: fm.data.author || '', description: fm.data.description || '', introduction: String(fm.data.introduction || '').trim(), chapters, text: fm.content }
  }
  /* the area keys as the store has them — the same files areaDefinitions reads, by their own `area` */
  async function areaKeysFrom(store) {
    const dir = 'content/app/tests/diagnostics'
    const names = (await store.list(dir)).filter((n) => n !== 'results')
    const keys = []
    for (const n of names) {
      const d = matter((await store.read(`${dir}/${n}.md`)) || '').data
      if (d && d.area && !keys.includes(d.area)) keys.push(d.area)
    }
    return keys
  }

  async function areaDefinitions(store) {
    const dir = 'content/app/tests/diagnostics'
    const names = (await store.list(dir)).filter((n) => n !== 'results')
    const each = await Promise.all(names.map(async (n) => {
      const d = matter((await store.read(`${dir}/${n}.md`)) || '').data
      const levels = Object.entries(d.levels || {}).map(([k, v]) => `${k} ${v.name}: ${v.plain || ''}`).join('; ')
      const moves = (d.movements || []).map((m) => `${m.level} ${m.name} — ${m.def || ''}`).join('\n    ')
      return `- ${d.area} (${d.title}): ${levels}\n    ${moves}`
    }))
    return each.join('\n')
  }
  function batches(chapters) {
    const out = []; let cur = [], size = 0
    for (const c of chapters) { if (cur.length && size + c.words > SOURCE_CAP) { out.push(cur); cur = []; size = 0 } cur.push(c); size += c.words }
    if (cur.length) out.push(cur)
    return out
  }

  /*
   * WHICH MODEL ANSWERED, per stage, as against which one was asked for.
   *
   * `MODEL` is what the run asked for, or the first provider's own default when it asked for
   * nothing — and a provider layer may answer with another: a fallback is a different model, and
   * the seam says so (`model` comes back on every reply). Recording the asked-for name as the
   * companion's provenance produced a file stamped `gpt-4o-mini` that sixty-two calls of
   * claude-haiku had written. Provenance that names the wrong model is worse than none: the whole
   * point of the field is to be able to tell what wrote a paragraph a year from now.
   */
  const answeredBy = {}

  /*
   * THE SHAPE, AS SOMETHING THE MODEL MUST OBEY RATHER THAN BE ASKED FOR.
   *
   * Every stage here already declares its reply as a zod schema, and both providers can be made to
   * answer in a given JSON Schema — so the schema is handed down and the model is given no way to
   * reply in another shape. Before this it was a sentence in the prompt ("JSON only. Shape: …") and
   * a single retry, which is a coin toss on every call: fifty-three paid calls into an enrichment
   * the write stage twice returned an object with no `chapters` key and the run died with nothing
   * written. The retry stays as the belt to this pair of braces.
   *
   * Converted once per schema — a stage's schema is the same object on every call of a run, and
   * zod's own conversion is not free.
   */
  const shapes = new Map()
  const shapeOf = (label, sch) => {
    if (!sch) return null
    if (shapes.has(sch)) return shapes.get(sch)
    let out = null
    try {
      const parameters = z.toJSONSchema(sch, { io: 'input' })
      out = { name: String(label || 'reply').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60), description: 'The reply, in the shape this stage requires.', parameters }
    } catch { out = null }   /* a schema that will not convert is simply asked for in prose, as before */
    shapes.set(sch, out)
    return out
  }

  /* one call that must come back as JSON in a shape; a reply that does not is asked for again once */
  class Budget extends Error {}
  async function askJson({ system, user, schema, maxTokens, label, model, temperature, think }) {
    if (overBudget()) throw new Budget(`spend guard: this book has spent ${(spentUsd() - bookStart).toFixed(2)} of ${maxSpend.toFixed(2)} in this run, and the dearest call so far cost ${dearest.toFixed(2)} — no room for another (raise it with --max-spend)`)
    /* before the call, never after: the point is not to start one there is no time to finish */
    if (deadline && Date.now() >= deadline) throw new Paused('out of time for this invocation — every finished stage is cached; carry on')
    let last = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = spentUsd()
      const msg = await complete({ system, maxTokens, label, model, temperature, think, schema: shapeOf(label, schema), user: attempt ? user + '\n\nYour previous reply was not valid: ' + last + '\nReturn corrected JSON only.' : user })
      dearest = Math.max(dearest, spentUsd() - before)
      try { const r = schema.safeParse(extractJson(msg.text)); if (r.success) { if (msg.model) answeredBy[label] = msg.model; return { data: r.data, usage: msg.usage, model: msg.model } }
        last = r.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ') }
      catch (e) { last = e.message }
      log(`  ${label}: reply not valid (${last.slice(0, 100)})${attempt ? '' : ' — asking again'}`)
    }
    throw new Error('no valid reply for ' + label)
  }
  /* what wrote this, for the record: the model that answered the stage, else the one it was asked
     of — a stage read back from the cache was not answered in this run, and the cache does not keep
     the name, so the asked-for one is the most that can honestly be said */
  const wrote = (label) => answeredBy[label] || writeModel || MODEL
  const tok = (u) => `${u.input_tokens}→${u.output_tokens}`

  /* ---- the mechanical checks on a written chapter: null, or the reason to send it back ---- */
  function issues(d, source) {
    const opening = d.summary.split(/\n\s*\n/).slice(0, 2).join('\n')
    /* talk about the text itself, not a use of the same words in life ("the lesson a situation teaches" is fine) */
    const meta = /\bthis (chapter|part|section|teaching|lesson|passage|summary|verse|poem|text)\b|\bthe (chapter|teaching|lesson|passage|material|verse|poem|text) (says|describes|tells|opens|begins|explains|is about|here|above|below)\b|\bin what follows\b|\bhere we\b|\bwe now turn\b|\bthe idea here\b/i.exec(opening)
    if (meta) return `the summary refers to the text itself ("${meta[0]}") — speak about life, not about the material`
    const marks = (d.summary.match(/==/g) || []).length
    if (marks % 2) return 'a highlight mark is not closed: every ==text== needs both ends'
    if (/==\s|\s==\{/.test(d.summary)) return 'no spaces inside a highlight: ==text=={colour}'
    if (!/==[^=\n]+==\{(sun|ember|sky|leaf|ocean)\}/.test(d.summary)) return 'the summary has no highlight: mark its one to three best lines as ==text=={colour} with a colour from sun, ember, sky, leaf, ocean'
    const src = norm(source)
    for (const m of d.summary.matchAll(/==([^=\n]+)==\{/g)) { const w = norm(m[1]).split(' '); if (w.length >= 8 && src.includes(w.slice(0, 8).join(' '))) return `a highlight quotes the original ("${m[1].slice(0, 50)}…") — a highlight is one of your own sentences in today's words` }
    if (d.essence.length >= 4 && !/\n\s*\n/.test(d.summary.trim())) return 'the summary is one unbroken block — set it in paragraphs, one thought each'
    const leaning = d.essence.filter((e) => /^(this|that|it|these|those|the (method|rule|practice|technique|process|principle|above)|as (we|you) (saw|said)|in (this|that) case)\b/i.test(e.trim()))
    return leaning.length ? `these essence lines depend on context and must name their subject instead: ${leaning.map((e) => JSON.stringify(e.slice(0, 60))).join(', ')}` : null
  }

  /* ---- schemas ---- */
  const Map_ = z.object({ thesis: z.string().min(20), premises: z.array(z.string().min(10)).min(1), kind: z.string().min(3), stage: z.enum(LEVELS), stageWhy: z.string().optional().default(''),
    chapters: z.array(z.object({ title: z.string().min(1), adds: z.string().min(5), role: z.enum(['teaching', 'framing', 'fragment']) })).min(1) })
  const Intro = z.object({ introduction: z.string().min(600) })
  const Contracts = z.object({ chapters: z.array(z.object({ title: z.string().min(1), ideas: z.array(z.object({ idea: z.string().min(8), anchor: z.string().min(3), keep: z.boolean().optional().default(false) })) })).min(1) })
  const Drafts = z.object({ chapters: z.array(z.object({ title: z.string().min(1), summary: z.string().min(40), essence: z.array(z.string().min(8)).min(1).max(8),
    quiz: z.array(z.object({ q: z.string().min(8), options: z.array(z.string().min(1)).length(4), answer: z.number().int().min(0).max(3), why: z.string().optional().default('') })).max(5) })).min(1) })
  const Audits = z.object({ chapters: z.array(z.object({ title: z.string().min(1), missing: z.array(z.string()).default([]), wrong: z.array(z.string()).default([]) })).min(1) })
  /*
   * THE AREAS COME FROM THE STORE, NOT FROM A DIRECTORY — and an empty list is never an enum.
   *
   * `AREAS.list` is `readdirSync('content/app/tests/diagnostics')`, which returns [] when there is no
   * such directory and says nothing about it. In an Edge Function there is no content on disk, so
   * this schema was `z.enum([])` — a shape NOTHING can satisfy — and the last stage of every cloud
   * enrichment failed, twice, for every book, forever. It cost fifty pence to find because the
   * failure looked like a model that would not answer: "Invalid option: expected one of " with
   * nothing after it.
   *
   * So the areas are read the way the rest of the pipeline reads content, through the store, and
   * the schema is built per run. A site with no diagnostic at all has no areas to choose from, and
   * then the field is a plain string: asking for one of nothing is a question with no answer.
   */
  const linesSchema = (areaKeys) => z.object({
    insight: z.string().min(20).max(260),
    statement: z.string().min(12).max(220),
    statementArea: areaKeys.length ? z.enum(areaKeys) : z.string().min(1),
    statementLevel: z.enum(LEVELS),
  })

  /* ---- the stages ---- */
  async function understand(book, cache) {
    const key = h(P.understand, book.text.slice(0, 900000))
    if (cache.understand && cache.understand.key === key && !force) return cache.understand.data
    const words = book.text.split(/\s+/)
    const text = words.length > UNDERSTAND_CAP ? words.slice(0, UNDERSTAND_CAP).join(' ') + '\n\n[the book continues]' : book.text
    const t0 = Date.now()
    const r = await askJson({ system: UNDERSTAND, schema: Map_, maxTokens: 8000, label: 'understand', temperature: 0, think: 'low',
      user: `Book: ${book.title}${book.author ? ' by ' + book.author : ''}\n${book.description ? 'Description: ' + book.description + '\n' : ''}Chapters, in order: ${book.chapters.map((c) => JSON.stringify(c.title)).join(', ')}\n\n<book>\n${text}\n</book>\n\nReturn the JSON.` })
    const known = new Set(book.chapters.map((c) => c.title))
    r.data.chapters = r.data.chapters.filter((c) => known.has(c.title.trim())).map((c) => ({ ...c, title: c.title.trim() }))
    for (const c of book.chapters) if (!r.data.chapters.find((x) => x.title === c.title)) r.data.chapters.push({ title: c.title, adds: '', role: 'teaching' })
    log(`  understand  ${Math.round((Date.now() - t0) / 1000)}s  ${tok(r.usage)}  ${r.data.kind}; stage ${r.data.stage}\n    thesis: ${r.data.thesis}`)
    cache.understand = { key, data: r.data }
    return r.data
  }
  const adds = (map, title) => (map.chapters.find((c) => c.title === title) || {}).adds || ''
  const role = (map, title) => (map.chapters.find((c) => c.title === title) || {}).role || 'teaching'
  const mapText = (map) => `Thesis: ${map.thesis}\nPremises:\n${map.premises.map((p) => '- ' + p).join('\n')}\nKind of text: ${map.kind}\nStage on the path: ${map.stage} — ${map.stageWhy}\nWhat each chapter adds:\n${map.chapters.map((c) => `- ${c.title} (${c.role}): ${c.adds}`).join('\n')}`

  async function introduce(book, map, cache) {
    const key = h(P.introduce, mapText(map), book.text.slice(0, 900000))
    if (book.introduction && !force) return { text: book.introduction, fresh: false }
    if (cache.introduce && cache.introduce.key === key && !force) return { text: cache.introduce.text, fresh: true }
    const words = book.text.split(/\s+/)
    const text = words.length > UNDERSTAND_CAP ? words.slice(0, UNDERSTAND_CAP).join(' ') + '\n\n[the book continues]' : book.text
    const t0 = Date.now()
    let last = '', out = null
    for (let attempt = 0; attempt < 3 && !out; attempt++) {
      const r = await askJson({ system: INTRODUCE, schema: Intro, maxTokens: 6000, label: 'introduce', model: writeModel || undefined,
        user: `Book: ${book.title}${book.author ? ' by ' + book.author : ''}\n${book.description ? 'Description: ' + book.description + '\n' : ''}\n<map>\n${mapText(map)}\n</map>\n\n<book>\n${text}\n</book>\n` + (attempt ? `\nYour previous introduction was refused: ${last}. Return a corrected one.\n` : '') + '\nReturn the JSON.' })
      const w = wordsOf(r.data.introduction), meta = /\b(this|the) introduction\b|\bin what follows\b|\bbelow\b/i.exec(r.data.introduction)
      last = w < 240 ? `too short (${w} words; 280 to 480)` : w > 560 ? `too long (${w} words; 280 to 480)` : meta ? `refers to itself ("${meta[0]}")` : /^#|\n#|^\s*[-*] /m.test(r.data.introduction) ? 'no headings or lists' : ''
      if (!last) out = r; else log(`  introduce: refused (${last})${attempt < 2 ? ' — asking again' : ''}`)
    }
    if (!out) throw new Error('no acceptable introduction after three tries')
    log(`  introduce   ${Math.round((Date.now() - t0) / 1000)}s  ${tok(out.usage)}  ${wordsOf(out.data.introduction)} words via ${out.model}`)
    cache.introduce = { key, text: out.data.introduction.trim() }
    return { text: cache.introduce.text, fresh: true }
  }

  async function extract(book, chapters, cache, save) {
    const todo = chapters.filter((c) => { const e = cache.chapters[c.title]?.extract; return force || !e || e.key !== h(P.extract, c.md) })
    for (const group of batches(todo)) {
      const t0 = Date.now()
      let pending = group, note = ''
      for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
        const r = await askJson({ system: EXTRACT, schema: Contracts, maxTokens: 30000, label: 'extract', temperature: 0, think: 'low',
          user: `Book: ${book.title}${book.author ? ' by ' + book.author : ''}\n${note}\n` + pending.map((c) => `<chapter title=${JSON.stringify(c.title)} words="${c.words}">\n${c.md}\n</chapter>`).join('\n\n') + '\n\nReturn the JSON.' })
        const still = []
        for (const c of pending) {
          const got = r.data.chapters.find((x) => x.title.trim() === c.title)
          if (!got) { still.push(c); continue }
          const src = norm(c.md)
          const ideas = got.ideas.filter((i) => src.includes(norm(i.anchor)))
          const dropped = got.ideas.length - ideas.length
          /* a list where most anchors miss the text was not read carefully: once more */
          if (got.ideas.length && dropped > got.ideas.length / 2 && attempt === 0) { still.push(c); note = `Your previous list for ${JSON.stringify(c.title)} had ${dropped} of ${got.ideas.length} anchors that are not in the text; anchors are exact quotations.`; continue }
          cache.chapters[c.title] = { ...(cache.chapters[c.title] || {}), extract: { key: h(P.extract, c.md), ideas } }
          log(`    extract  ${c.title.slice(0, 44).padEnd(44)} ${String(c.words).padStart(6)} w → ${String(ideas.length).padStart(3)} ideas (${ideas.filter((i) => i.keep).length} to keep)${dropped ? ', ' + dropped + ' unanchored dropped' : ''}`)
        }
        if (attempt === 0) log(`  extract     ${Math.round((Date.now() - t0) / 1000)}s  ${tok(r.usage)}`)
        pending = still
      }
      for (const c of pending) log(`    extract  ${c.title}: no usable contract`)
      /* the remainder pass: the same reader, shown what it found, asked for what it passed over */
      const found = group.filter((c) => cache.chapters[c.title]?.extract?.key === h(P.extract, c.md) && cache.chapters[c.title].extract.ideas.length)
      if (found.length) {
        const t1 = Date.now()
        const r = await askJson({ system: EXTRACT, schema: Contracts, maxTokens: 30000, label: 'extract (remainder)', temperature: 0, think: 'low',
          user: `Book: ${book.title}${book.author ? ' by ' + book.author : ''}\n` + found.map((c) => `<chapter title=${JSON.stringify(c.title)} words="${c.words}">\n<already-listed>\n${contractText(cache.chapters[c.title].extract.ideas)}\n</already-listed>\n${c.md}\n</chapter>`).join('\n\n') + '\n\nReturn the JSON: only the ideas not yet listed.' })
        for (const c of found) {
          const got = r.data.chapters.find((x) => x.title.trim() === c.title); if (!got) continue
          const src = norm(c.md), have = new Set(cache.chapters[c.title].extract.ideas.map((i) => norm(i.idea)))
          const more = got.ideas.filter((i) => src.includes(norm(i.anchor)) && !have.has(norm(i.idea)))
          if (more.length) { cache.chapters[c.title].extract.ideas.push(...more); log(`    extract+ ${c.title.slice(0, 44).padEnd(44)} +${more.length} → ${cache.chapters[c.title].extract.ideas.length} ideas`) }
        }
        log(`  extract+    ${Math.round((Date.now() - t1) / 1000)}s  ${tok(r.usage)}`)
      }
      await save(cache)
    }
  }
  const contractText = (ideas) => ideas.map((i, n) => `${n + 1}. ${i.idea}${i.keep ? ' [keep]' : ''}`).join('\n')

  async function writeAndAudit(book, map, intro, chapters, cache, save) {
    const key = (c) => h(P.write, P.audit, writeModel || MODEL, THINKING_LEVEL, c.md, cache.chapters[c.title]?.extract?.ideas || [], intro, adds(map, c.title), role(map, c.title))
    const todo = chapters.filter((c) => cache.chapters[c.title]?.extract && (force || cache.chapters[c.title]?.final?.key !== key(c)))
    const bookCtx = `Book: ${book.title}${book.author ? ' by ' + book.author : ''}\n<map>\n${mapText(map)}\n</map>\n${intro ? '\n<introduction>\n' + intro + '\n</introduction>\n' : ''}`
    const block = (c, audit, previous) => {
      const idx = book.chapters.indexOf(c)
      const note = `${role(map, c.title)}; ${idx === 0 && intro ? 'the first chapter — the introduction has set the table, open on what this chapter adds' : idx === 0 ? 'the first chapter' : 'chapter ' + (idx + 1) + ' of ' + book.chapters.length}; it adds: ${adds(map, c.title)}`
      return `<chapter title=${JSON.stringify(c.title)} words="${c.words}" note=${JSON.stringify(note)}>\n<contract>\n${contractText(cache.chapters[c.title].extract.ideas)}\n</contract>\n<text>\n${c.md}\n</text>\n${audit ? '<previous-draft>\n' + JSON.stringify(previous, null, 1) + '\n</previous-draft>\n<audit-of-previous-draft>\n' + audit + '\nRevise the previous draft to fix exactly these findings. Keep every sentence that was right; do not start over, and do not drop anything the audit did not name.\n</audit-of-previous-draft>\n' : ''}</chapter>`
    }
    for (const group of batches(todo)) {
      /* per chapter: the latest draft, the best-audited draft so far, the feedback for the next write, and how the audit is trending */
      const state = new Map(group.map((c) => [c.title, { draft: null, best: null, bestScore: Infinity, feedback: '', history: [], rounds: 0, clean: false }]))
      let pending = group, round = 0
      while (pending.length && round < MAX_ROUNDS) {
        round++
        const t0 = Date.now()
        let r
        try { r = await askJson({ system: WRITE, schema: Drafts, maxTokens: 60000, label: 'write', model: writeModel || undefined,
          user: bookCtx + '\n' + pending.map((c) => block(c, state.get(c.title).feedback, state.get(c.title).draft)).join('\n\n') + '\n\nReturn the JSON.' }) }
        catch (e) {
          if (e instanceof Budget) { log('  ' + e.message); for (const c of pending) state.get(c.title).stopped = e.message; break }
          /*
           * OUT OF TIME. Unlike the budget, this is not a stopping point — the drafts in hand are
           * half-audited and writing them down as final would make the next invocation skip them.
           * So the group is abandoned and the whole call unwinds; what every EARLIER group finished
           * is already in the cache, saved as it went, and this group is written again next time.
           * One group's rounds is the cost of being cut off, and it is bounded.
           */
          if (e instanceof Paused) { log('  ' + e.message); throw e }
          throw e
        }
        log(`  write ${round}     ${Math.round((Date.now() - t0) / 1000)}s  ${tok(r.usage)} via ${r.model}`)
        /* the mechanical checks first; a draft that fails one goes straight back with the reason and is not audited */
        const toAudit = []
        for (const c of pending) {
          const st = state.get(c.title); st.rounds++
          const d = r.data.chapters.find((x) => x.title.trim() === c.title)
          if (!d) { st.feedback = 'The previous reply did not include this chapter; return it.'; continue }
          st.draft = d
          const bad = issues(d, c.md)
          if (bad) { st.feedback = 'The draft failed a check: ' + bad + '. Fix that and keep everything else that was right.'; log(`    check    ${c.title.slice(0, 44).padEnd(44)} ${bad.slice(0, 90)}`) } else toAudit.push(c)
        }
        /* the second reader, on every draft that passed the checks — including the last one */
        if (toAudit.length) {
          const t1 = Date.now()
          const a = await askJson({ system: AUDIT, schema: Audits, maxTokens: 20000, label: 'audit', temperature: 0, think: 'low',
            user: bookCtx + '\n' + toAudit.map((c) => `<chapter title=${JSON.stringify(c.title)}>\n<contract>\n${contractText(cache.chapters[c.title].extract.ideas)}\n</contract>\n<text>\n${c.md}\n</text>\n<draft>\n${JSON.stringify(state.get(c.title).draft, null, 1)}\n</draft>\n</chapter>`).join('\n\n') + '\n\nReturn the JSON.' })
          log(`  audit ${round}     ${Math.round((Date.now() - t1) / 1000)}s  ${tok(a.usage)}`)
          for (const c of toAudit) {
            const st = state.get(c.title)
            const v = a.data.chapters.find((x) => x.title.trim() === c.title) || { missing: [], wrong: [] }
            const score = v.missing.length + v.wrong.length
            st.history.push(score)
            if (score < st.bestScore) { st.bestScore = score; st.best = st.draft; st.residual = v }
            log(`    audit    ${c.title.slice(0, 44).padEnd(44)} ${score ? `${v.missing.length} missing · ${v.wrong.length} wrong` : 'complete and correct'}`)
            if (!score) { st.clean = true; st.feedback = ''; continue }
            st.feedback = [v.missing.length ? 'Missing from the summary (add each where it belongs):\n- ' + v.missing.join('\n- ') : '', v.wrong.length ? 'Wrong (fix each):\n- ' + v.wrong.join('\n- ') : ''].filter(Boolean).join('\n')
          }
        }
        pending = pending.filter((c) => state.get(c.title).feedback)
      }
      for (const c of group) {
        const st = state.get(c.title)
        const d = st.best || st.draft
        if (!d) { log(`    write    ${c.title}: no draft`); continue }
        const res = st.residual || { missing: [], wrong: [] }
        const note = st.clean ? '' : st.stopped ? `${st.stopped}; best draft kept with ${res.missing.length} missing, ${res.wrong.length} wrong` : `stopped after ${MAX_ROUNDS} rounds with ${res.missing.length} missing, ${res.wrong.length} wrong`
        if (st.feedback) log(`    write    ${c.title.slice(0, 44).padEnd(44)} ${note}`)
        cache.chapters[c.title] = { ...cache.chapters[c.title], final: { key: key(c), chapter: { title: c.title, summaryMd: d.summary.trim(), essence: d.essence, quiz: d.quiz.map((q) => ({ q: q.q, options: q.options, answer: q.answer, why: q.why || '' })) }, rounds: st.rounds, note, residual: res } }
        log(`    done     ${c.title.slice(0, 44).padEnd(44)} ${String(c.words).padStart(6)} w → ${String(wordsOf(d.summary)).padStart(4)} w · ${d.essence.length} essence · ${d.quiz.length} q · ${st.rounds} round${st.rounds === 1 ? '' : 's'}${st.clean ? ' · complete' : ''}`)
      }
      await save(cache)
    }
  }

  async function bookLines(book, map, ordered, existing, cache, store) {
    const key = h(P.lines, mapText(map), ordered.map((c) => c.summaryMd))
    const have = existing.insight && existing.statement && existing.statementArea && existing.statementLevel
    if (have && !force && (!cache.lines || cache.lines.key === key)) return { insight: existing.insight, statement: existing.statement, statementArea: existing.statementArea, statementLevel: existing.statementLevel }
    if (cache.lines && cache.lines.key === key && !force) return cache.lines.data
    const t0 = Date.now()
    /* the areas are read here rather than at the top: they come through the store, and a module that
       reads content as it loads is a module only a checkout can import */
    const areas = await areaDefinitions(store)
    const r = await askJson({ system: BOOK_LINES, schema: linesSchema(await areaKeysFrom(store)), maxTokens: 2000, label: 'lines', model: writeModel || undefined,
      user: `Book: ${book.title}${book.author ? ' by ' + book.author : ''}\n\n<map>\n${mapText(map)}\n</map>\n\nThe seven areas of life and their levels:\n${areas}\n\n<summaries>\n${ordered.map((c) => `## ${c.title}\n${c.summaryMd}\n\nEssence:\n${c.essence.map((e) => '- ' + e).join('\n')}`).join('\n\n')}\n</summaries>\n\nReturn the JSON.` })
    log(`  lines       ${Math.round((Date.now() - t0) / 1000)}s  ${tok(r.usage)}\n    insight: ${r.data.insight}\n    statement (${r.data.statementArea} ${r.data.statementLevel}): ${r.data.statement}`)
    cache.lines = { key, data: r.data }
    return r.data
  }

  /* ---- one book through the pipeline ---- */
  /*
   * ONE BOOK, ALL THE WAY THROUGH. `store` is where the content is — the files in a checkout, the
   * rows of public.content in cloud mode — and `cache` is where a stage's result is kept between
   * calls (a file beside the build scripts, or the agent run's own state). Neither is known to the
   * stages: they are handed a book and a blob.
   */
  async function enrich(slug, { store: where, cache: held }) {
      if (!where || !held) throw new Error('enrich: a store and a cache are both required — the pipeline knows neither a disk nor a run')
      const store = asStore(where)
    const book = await loadBook(slug, store), cache = await held.load()
    bookStart = spentUsd()
    const file = `${COMPANIONS}/${slug}.md`
    const had = await store.read(file)
    const existing = had == null ? { data: {}, chapters: [] } : parseCompanion(had)
    const chosen = wantedChapters.length ? book.chapters.filter((c) => wantedChapters.includes(c.title)) : book.chapters
    log(`\n${book.title} — ${book.chapters.length} chapters${chosen.length < book.chapters.length ? ', ' + chosen.length + ' chosen' : ''}${book.introduction ? '' : ', no introduction yet'}`)
    const report = { slug, title: book.title, author: book.author, failed: [] }
    if (!write && !review) { log('  (plan only — add --write)'); return report }
    if (!ready()) { log(`  no ${missingKey()} in the environment — nothing generated`); return report }

    const map = await understand(book, cache); await held.save(cache)
    const intro = await introduce(book, map, cache); await held.save(cache)
    if (intro.fresh && write) {
      const data = { ...book.fm.data, introduction: intro.text, introduced: { model: wrote('introduce'), prompt: P.introduce, date: new Date().toISOString().slice(0, 10), pipeline: 'enrich' } }
      await store.write(`${BOOKS}/${slug}.md`, matter.stringify('\n' + book.fm.content.replace(/^\n+/, ''), data, DUMP))
      log(`  wrote content/books/${slug}.md (introduction)`)
    }
    if (stage === 'introduce') return report

    await extract(book, chosen, cache, (c) => held.save(c))
    await writeAndAudit(book, map, intro.text, chosen, cache, (c) => held.save(c))

    const titles = bookChapterTitles(book.chapters.map((c) => '# ' + c.title + '\n' + c.md).join('\n'))
    const results = new Map(existing.chapters.map((c) => [c.title, c]))
    for (const c of chosen) { const f = cache.chapters[c.title]?.final; if (f) results.set(c.title, f.chapter); else if (!results.has(c.title)) report.failed.push(c.title) }
    const ordered = titles.map((t) => results.get(t)).filter(Boolean)
    const lines = await bookLines(book, map, ordered, existing.data, cache, store); await held.save(cache)
    const data = { book: slug, ...lines, generated: { model: wrote('write'), pipeline: 'enrich', prompts: P, date: new Date().toISOString().slice(0, 10), chapters: Object.fromEntries(titles.filter((t) => cache.chapters[t]?.final).map((t) => [t, cache.chapters[t].final.key])) } }
    report.data = data; report.ordered = ordered
    report.notes = Object.fromEntries(titles.filter((t) => cache.chapters[t]?.final?.note).map((t) => [t, cache.chapters[t].final.note]))
    if (write) { await store.write(file, serialiseCompanion({ data, chapters: ordered })); log(`  wrote ${file}`) }
    return report
  }

  return { enrich, P }
}
