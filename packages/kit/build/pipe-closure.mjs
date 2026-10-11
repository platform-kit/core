/*
 * WHAT THE ADMIN'S PIPE CARRIES — the one definition, used by the assembler (which copies these
 * files into the `admin` Edge Function) and by content-kinds.test.mjs (which holds them to the
 * rule that follows from being there).
 *
 * The rule: a file in this closure runs inside an Edge Function, where there is NO FILESYSTEM. It
 * must read and write content through the store. A build script outside the closure may use fs
 * freely — in cloud mode the deploy exports every row to a file before the build, so a build always
 * has a checkout. That distinction is the whole of it, and guessing at it from the outside gives
 * false alarms; a guard that cries wolf is a guard people learn to ignore.
 */
import fs from 'node:fs'
import path from 'node:path'

export const PIPE_ROOTS = [
  'build/admin-pipe.mjs', 'build/store/rows.mjs', 'build/store/git.mjs', 'build/models/index.mjs',
  'src/lib/markdown.js',        /* the document renderer, for the content API in cloud mode */
  'src/lib/forms/api-shape.js', /* the Forms API's shape of a form, for the forms in cloud mode */
  'src/lib/entry.js',           /* the ONE adapter from a row to the shape velite gives: print-render
                                   sets a book from rows and must see the same book the build does */
  'build/enrich-cache.mjs',     /* and where a stage's result is kept between calls: the pipeline takes
                                   one rather than importing one, so it has to be named here itself */
  'build/enrich/pipeline.mjs',  /* the enrichment's seven stages, for the worker that runs them where
                                   there is no machine: it reads its content through the same store
                                   everything else in here does, which is what put it in reach */
]
/* MACHINE-BOUND, and reached only by a path the function never takes: the print renderer and the
   pusher, both imported behind a name no bundler can resolve.

   A LITERAL dynamic import IS resolved, and the runtime refuses to boot without the file. So
   build/fonts.mjs is NOT skipped although nothing in the function ever calls it: catalog.mjs reaches
   it as `import('./fonts.mjs')` inside its CLI guard, and the edge runtime reads every specifier it
   can see whether or not the branch runs. Leaving it out cost a whole afternoon — the runtime died
   at boot and surfaced as thirteen failures in the print suite reading `name resolution failed`,
   which looks exactly like a stack that is not up. `closureResolves()` below is now the guard, and
   the rule it holds is: a literal specifier inside the closure names a file inside the closure. */
export const PIPE_SKIP = /^build\/(print\.mjs|print\/(epub|pages|pdf\.min|raster|typeset)\.mjs|git-push\.mjs)$/

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const rel = (base, f) => path.relative(base, f).split(path.sep).join('/')

/* every file reachable from the roots by a relative import, as { relative path → absolute } */
export function closure(base, roots = PIPE_ROOTS, skip = PIPE_SKIP) {
  const seen = new Map()
  const queue = [...roots]
  while (queue.length) {
    const r = queue.shift()
    if (seen.has(r) || skip.test(r)) continue
    const abs = path.join(base, r)
    if (!fs.existsSync(abs)) continue
    const src = fs.readFileSync(abs, 'utf8')
    seen.set(r, abs)
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2]
      if (spec && spec.startsWith('.')) queue.push(rel(base, path.resolve(path.dirname(abs), spec)))
    }
  }
  return seen
}

/* WHAT THE RUNTIME WILL LOOK FOR. The edge runtime resolves every literal specifier it can see —
   `import x from './y.js'` and `import('./y.js')` alike, a guarded branch included — so a file the
   closure leaves out while something in it still names one by a literal is a runtime that does not
   boot. Returns the offenders as `from → missing`. */
export function closureResolves(base, roots = PIPE_ROOTS, skip = PIPE_SKIP) {
  const inside = closure(base, roots, skip)
  const bad = []
  for (const [r, abs] of inside) {
    for (const m of fs.readFileSync(abs, 'utf8').matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2]
      if (!spec || !spec.startsWith('.')) continue
      const target = rel(base, path.resolve(path.dirname(abs), spec))
      if (!inside.has(target) && fs.existsSync(path.join(base, target))) bad.push(`${r} → ${target}`)
    }
  }
  return bad
}
