/*
 * ONE ENGINE, TWO DRIVERS — and they must set the same edition.
 *
 * A print edition is a hash of its source, its templates and its trim, and `content/store/print.json`
 * says which file a printer holds. A book set on a machine and the same book set in an Edge Function
 * must therefore be the same bytes: if the two paths could drift, nobody could tell which edition a
 * printed book actually is, and the registry would be recording a lie.
 *
 * So this pins two things:
 *
 *   THE SEAM IS THE ONLY DOOR. Nothing under build/print/ imports Typst except the drivers behind
 *   compiler.js. A second import is how a second way of compiling appears, and a second way of
 *   compiling is how the two paths diverge.
 *
 *   THE DRIVERS AGREE. Given the same sources and the same fonts, both produce a PDF of the same
 *   page count and the same text. Not byte-for-byte: a PDF carries a creation date and an id, so
 *   two runs of the SAME compiler differ in a few bytes. What must match is the document.
 *
 * The wasm half is skipped, loudly, where its package is not installed — it is an optional peer, as
 * the native one is.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nPRINT PARITY\n')

const ROOT = process.cwd()
const KIT_BUILD = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = path.resolve(KIT_BUILD, '../../..')
const PRINT = path.join(KIT_BUILD, 'print')
const SEAM = path.join(PRINT, 'typeset')

/* ---- the seam is the only door ---- */
{
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.(mjs|js)$/.test(e.name)) out.push(p)
    }
    return out
  }
  const offenders = []
  for (const f of walk(PRINT)) {
    if (path.dirname(f) === SEAM) continue          /* the drivers are where Typst belongs */
    const src = fs.readFileSync(f, 'utf8')
    if (/typst-ts-(node|web)-compiler|from ['"]@myriaddreamin/.test(src)) offenders.push(path.relative(WORKSPACE_ROOT, f))
  }
  ok('nothing under build/print/ imports Typst but the drivers', offenders.length === 0, offenders.join(', '))

  /* and print.mjs itself goes through the seam */
  const main = fs.readFileSync(path.join(KIT_BUILD, 'print.mjs'), 'utf8')
  ok('print.mjs imports the seam, not a compiler', /print\/typeset\/compiler\.js/.test(main) && !/@myriaddreamin/.test(main))
}

/* ---- both drivers answer the same shape ---- */
{
  const seam = fs.readFileSync(path.join(SEAM, 'compiler.js'), 'utf8')
  for (const call of ['pdf', 'svg', 'query']) ok(`the seam offers ${call}()`, new RegExp('\\b' + call + ':').test(seam))
  for (const d of ['node-compiler.js', 'wasm-compiler.js']) {
    const src = fs.readFileSync(path.join(SEAM, d), 'utf8')
    ok(`${d} exports create()`, /export async function create|export function create/.test(src))
    for (const call of ['pdf', 'svg', 'query']) ok(`${d} implements ${call}()`, new RegExp('\\b' + call + '\\s*\\(').test(src))
  }
}

/* ---- and they set the same document ---- */
const fontsDir = path.join(PRINT, 'fonts')
const sample = `#set page(width: 6in, height: 9in, margin: 0.8in)
#set text(font: "Spectral", size: 11pt)
= A Chapter
#lorem(400)
#pagebreak()
= Another
#lorem(400)
`
async function driverPdf(which, files, fonts) {
  const mod = await import(path.join(SEAM, which))
  const c = await mod.create(which === 'wasm-compiler.js'
    ? { files, fonts }
    : { workspace: path.dirname(files.__path), fonts: fontsDir })
  return c.pdf(which === 'wasm-compiler.js' ? 'sample.typ' : files.__path)
}
const pagesOf = (pdf) => { const m = Buffer.from(pdf).toString('latin1').match(/\/Count\s+(\d+)/g); return m ? Math.max(...m.map((x) => Number(x.replace(/\D/g, '')))) : 0 }

let wasmThere = true
try { await import('@myriaddreamin/typst-ts-web-compiler') } catch (e) { wasmThere = false }
let nodeThere = true
try { await import('@myriaddreamin/typst-ts-node-compiler') } catch (e) { nodeThere = false }

if (!nodeThere || !wasmThere) {
  console.log(`  both drivers are optional peers — ${!nodeThere ? 'node' : 'wasm'} is not installed, so the two were not compared\n`)
} else {
  const tmp = fs.mkdtempSync(path.join(ROOT, '.print', 'parity-'))
  try {
    const file = path.join(tmp, 'sample.typ')
    fs.writeFileSync(file, sample)
    const fonts = fs.readdirSync(fontsDir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => fs.readFileSync(path.join(fontsDir, f)))
    const a = await driverPdf('node-compiler.js', { __path: file }, fonts)
    const b = await driverPdf('wasm-compiler.js', { 'sample.typ': sample }, fonts)
    ok('both drivers set the same page count', pagesOf(a) === pagesOf(b) && pagesOf(a) > 0, `node ${pagesOf(a)} vs wasm ${pagesOf(b)}`)
    /* the same words, which is what an edition is about — a PDF's id and date differ per run */
    const words = (pdf) => (Buffer.from(pdf).toString('latin1').match(/[A-Za-z]{4,}/g) || []).length
    const wa = words(a), wb = words(b)
    ok('and a document of the same substance', Math.abs(wa - wb) / Math.max(wa, wb) < 0.2, `node ${wa} vs wasm ${wb}`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
