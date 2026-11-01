#!/usr/bin/env node
/*
 * THE JAVASCRIPT A SITE GETS (openspec: typescript-throughout). The kit's source is TypeScript, and in the workspace Node runs
 * it as it is. Node never strips types inside node_modules, so before the kit is packed (`prepack`) or installed from a
 * source checkout (build/source-install.mjs), this compiles it with tsconfig.build.json into .tsbuild/ and copies back only
 * what came from TypeScript, beside its source: x.mts gives x.mjs and x.d.mts, x.ts gives x.js and x.d.ts, with their
 * imports rewritten to the emitted names. JavaScript not yet converted is left exactly as it is.
 *
 * Where TypeScript itself is not installed (a source install from GitHub installs no dev dependencies), each file's types
 * are stripped by Node's own `module.stripTypeScriptTypes` instead, and its imports rewritten the same way: the same
 * JavaScript, without the declaration files, which the npm package carries.
 *
 * What it copied is listed in .compiled.json, and `--clean` removes exactly that, so the workspace is never left holding
 * a compiled copy that would go stale beside its source.
 *
 *   node build/compile.mjs           compile and copy beside the sources
 *   node build/compile.mjs --clean   remove what the last compile copied
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isMain } from './is-main.mjs'

const KIT = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(KIT, '.tsbuild')
const LIST = path.join(KIT, '.compiled.json')
const ROOTS = ['bin', 'build', 'src', 'vite']
/* the theme's TypeScript, which tsc cannot build beside its components: stripped file by file, since a site's Node
   reads theme.js and its schemas at build time and Node strips nothing inside node_modules (Vite reads the .ts) */
const THEME = 'theme/src'
/* Deno's own TypeScript, run by deno test and copied into the functions as it is */
const DENO = (rel) => /\.test\.ts$/.test(rel) || rel === 'build/hyperswitch-browser.steps.ts'

export function clean() {
  const was = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, 'utf8')) : []
  for (const rel of was) fs.rmSync(path.join(KIT, rel), { force: true })
  fs.rmSync(LIST, { force: true })
  fs.rmSync(OUT, { recursive: true, force: true })
  return was.length
}

/* every TypeScript source the package carries, as paths under the kit */
function sources() {
  const out = []
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(KIT, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'fixtures') walk(r); continue }
      if (/\.d\.m?ts$/.test(e.name) || !/\.m?ts$/.test(e.name) || DENO(r)) continue
      out.push(r)
    }
  }
  for (const r of ROOTS) if (fs.existsSync(path.join(KIT, r))) walk(r)
  return out
}

/* the emitted name of a relative import: ./x.mts → ./x.mjs, ./x.ts → ./x.js — what tsc's rewriteRelativeImportExtensions does */
const renamed = (code) => code.replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+)\.(m?)ts(['"])/g, (_, a, p, m, q) => `${a}${p}.${m}js${q}`)

/* no TypeScript installed: Node's own stripping, file by file */
function strip(ts) {
  const copied = []
  for (const rel of ts) {
    const to = rel.replace(/\.(m?)ts$/, '.$1js')
    if (fs.existsSync(path.join(KIT, to))) throw new Error(`compile: ${to} already exists beside ${rel} — a source and its output cannot share a name`)
    fs.writeFileSync(path.join(KIT, to), renamed(stripTypeScriptTypes(fs.readFileSync(path.join(KIT, rel), 'utf8'), { mode: 'strip' })))
    copied.push(to)
  }
  return copied
}

/* every TypeScript file of the theme, as paths under the kit */
function themeSources() {
  const out = []
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(KIT, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name
      if (e.isDirectory()) { walk(r); continue }
      if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(r)
    }
  }
  if (fs.existsSync(path.join(KIT, THEME))) walk(THEME)
  return out
}

export function compile() {
  clean()
  const theme = strip(themeSources())
  const ts = sources()
  if (!ts.length) { fs.writeFileSync(LIST, JSON.stringify(theme, null, 2) + '\n'); return theme }
  let tsc
  try { tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc') } catch {
    const copied = [...theme, ...strip(ts)]
    fs.writeFileSync(LIST, JSON.stringify(copied, null, 2) + '\n')
    return copied
  }
  const r = spawnSync(process.execPath, [tsc, '--project', path.join(KIT, 'tsconfig.build.json')], { cwd: KIT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('compile: tsc refused the kit\n' + (r.stdout + r.stderr).trim().split('\n').slice(0, 20).join('\n'))
  const copied = [...theme]
  for (const rel of ts) {
    const base = rel.replace(/\.(m?)ts$/, '')
    const m = rel.endsWith('.mts') ? 'm' : ''
    for (const ext of [`.${m}js`, `.d.${m}ts`]) {
      const from = path.join(OUT, base + ext)
      if (!fs.existsSync(from)) throw new Error(`compile: tsc emitted no ${base + ext} for ${rel}`)
      if (fs.existsSync(path.join(KIT, base + ext))) throw new Error(`compile: ${base + ext} already exists beside ${rel} — a source and its output cannot share a name`)
      fs.copyFileSync(from, path.join(KIT, base + ext))
      copied.push(base + ext)
    }
  }
  fs.writeFileSync(LIST, JSON.stringify(copied, null, 2) + '\n')
  fs.rmSync(OUT, { recursive: true, force: true })
  return copied
}

if (isMain(import.meta.url)) {
  if (process.argv.includes('--clean')) console.log(`compile: removed ${clean()} compiled file(s)`)
  else { const c = compile(); console.log(`compile: ${c.filter((f) => !/\.d\.m?ts$/.test(f)).length} TypeScript source(s) compiled beside themselves`) }
}
