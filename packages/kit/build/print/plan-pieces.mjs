/*
 * A BOOK IN RUNS, where one call cannot hold it.
 *
 * On a machine a book is one compile and this is never used. In an Edge Function it is not: the
 * measurements in openspec/changes/print-on-demand/design.md say a 424-page book is 3.8 seconds on
 * a cold worker and 472 MB, against 2000 ms of CPU and 256 MB. Warm it is 111 ms — the cost is
 * the first compile a worker does and the memory a long document holds — so the answer is to give
 * each call less book rather than to give the work a queue.
 *
 * THIS IS A LOOP AND NOT AN ARCHITECTURE. A run is a call; the runs are a for. There is no job
 * row, no lease and no resumable step, because a call that takes half a second does not need to
 * survive anything. A book that fits in one run IS one run, which is most of them.
 *
 * Pure: a list of chapters and a budget in, a list of runs out. No Typst, no files, no clock.
 */

/*
 * HOW MANY PAGES A RUN MAY HOLD. Measured with the wasm compiler on this machine, cold, one run
 * per process — the figures that matter are the cold ones, since a worker's first call is a real
 * request:
 *
 *      21pp  159ms  213MB        102pp  335ms  241MB
 *      51pp  207ms  222MB        179pp  504ms  242MB
 *
 * and, on the real templates, which carry highlights, the companion boxes and the marks gathered
 * at the back: 238pp 890ms 356MB, 424pp 3807ms 472MB — superlinear, which is the memory telling.
 *
 * 120 is chosen with room on both sides: about 450 ms of the 2000 available on the real templates,
 * and memory that stayed flat to 179 synthetic pages. It is deliberately not the largest number
 * that fitted: the budget that is exactly big enough is the one that stops fitting the first time
 * somebody writes a longer chapter.
 */
export const PAGES_PER_RUN = 120

/* a chapter's pages, where the book has been set once and we know; otherwise its words at the
   measured density of this trim (about 300 words to the page at 6x9, 11pt, the leading book.typ
   sets), which is only ever used to PLAN and never to number anything */
const WORDS_PER_PAGE = 300
export const pagesOf = (ch) => Math.max(1, ch && ch.pages ? ch.pages : Math.ceil(((ch && ch.words) || 0) / WORDS_PER_PAGE) || 1)

/*
 * THE RUNS. Chapters in their own order — a book is not reordered to pack it — each run taking
 * chapters until the next would take it past the budget, and a chapter longer than the budget
 * getting a run to itself rather than being split. Splitting a chapter is possible and is not
 * worth it: the only books it would help are ones nobody has, and a chapter broken across two
 * compiles is where a running head or a recto rule goes wrong without anybody seeing it.
 *
 * `from` is the page the run starts on, which is what book.typ needs to keep the folios and the
 * recto rules right. It is an ESTIMATE until the run has been set, and the caller re-plans from
 * the real counts — which is why nothing downstream may treat it as a page number.
 */
export function planRuns(chapters, { budget = PAGES_PER_RUN } = {}) {
  const list = Array.isArray(chapters) ? chapters : []
  const runs = []
  let run = null
  let page = 1
  for (const ch of list) {
    const n = pagesOf(ch)
    if (!run || (run.pages && run.pages + n > budget)) {
      run = { chapters: [], pages: 0, from: page }
      runs.push(run)
    }
    run.chapters.push(ch)
    run.pages += n
    page += n
  }
  return runs
}

/*
 * AND AGAIN, WITH WHAT ACTUALLY HAPPENED. A run's real page count is known only once it is set,
 * and a run that came out longer than planned moves every run after it. This takes the counts a
 * caller has so far and says where each run really starts, so only the runs whose offset changed
 * need setting again — which is the difference between re-compiling a book and re-compiling the
 * tail of one.
 */
export function reoffset(runs, counts) {
  let page = 1
  return runs.map((r, i) => {
    const from = page
    const pages = counts && counts[i] != null ? counts[i] : r.pages
    page += pages
    return { ...r, from, pages, moved: from !== r.from }
  })
}

/*
 * WHAT A PRINTER WILL BIND.
 *
 * A printer binds nothing under its minimum — a paperback's is higher than a hardcover's — and a
 * book has an even number of pages, because a leaf has two sides. Some printers count in fours.
 * So a short book gets blank leaves at the end, and an odd count gets one more.
 *
 * It is here, pure, because two places compute it: the build on a machine and print-render in a
 * function. Computing it twice is how a book comes out 26 pages one way and 32 the other and
 * nobody can say which is right — which is exactly what happened before this existed.
 *
 * The minimum and the step come from the printers themselves (`product().minPages`, `.pageStep`),
 * taken as the largest of whoever might make the book: a page count that suits one printer and not
 * another is a page count that fails at the moment of ordering.
 */
export const BIND_MIN = 24, BIND_STEP = 2

export function padFor(pages, { min = BIND_MIN, step = BIND_STEP } = {}) {
  const n = Math.max(0, Number(pages) || 0)
  const m = Math.max(1, Number(min) || BIND_MIN)
  const s = Math.max(1, Number(step) || BIND_STEP)
  const want = Math.max(n, m)
  return Math.ceil(want / s) * s - n
}

/*
 * THE MINIMUM AND THE STEP, from every printer that may make each printed format: the largest of each. ONE place for both
 * paths — the function computed this for itself, asked each printer for its product without saying which format, and
 * bound a 77-page book to 80 where the build bound it to 78.
 */
export function bindingFor(spec, formats, candidates, { trim, paper } = {}) {
  let min = BIND_MIN, step = BIND_STEP
  for (const format of formats) for (const p of candidates(spec, format)) {
    const pr = p.product({ chosen: { format, trim: trim ?? spec.trim ?? '6x9', paper: paper ?? spec.paper ?? 'cream', cloth: spec.cloth, foil: spec.foil }, options: (spec.providers || {})[p.id] || {} }) || {}
    min = Math.max(min, Number(pr.minPages) || BIND_MIN)
    step = Math.max(step, Number(pr.pageStep) || BIND_STEP)
  }
  return { min, step }
}

/* the count a printer will actually bind, which is what everything downstream should quote on */
export const boundPages = (pages, opts) => (Number(pages) || 0) + padFor(pages, opts)
