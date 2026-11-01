#!/usr/bin/env node
/*
 * THE MECHANICAL HALF OF CONVERTING A COMPONENT TO TYPESCRIPT (openspec: typescript-throughout) — ts-migrate.mjs for a
 * .vue file, read through vue-tsc, which checks the template against the script as well as the script itself.
 *
 *   in the script        the same rules as ts-migrate: an implicit any made explicit (`: any`), an object that grows
 *                        read as any, and a reactive value made with no type — `ref(null)`, `ref([])`, `reactive({})`,
 *                        whose type is then the empty one it began with — given `<any>`
 *   in the template      an error on something the script declares is settled where it is declared; anything else is
 *                        kept visible, `<!-- @vue-expect-error TS<code>, from the conversion -->` before its element
 *   anywhere             `@ts-expect-error TS<code>, from the conversion: …` on the script's line
 *
 *   node build/vue-migrate.mjs --project theme/tsconfig.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const args = process.argv.slice(2)
const project = path.resolve(args[args.indexOf('--project') + 1])
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const VUE_TSC = path.join(ROOT, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')

const check = () => {
  const r = spawnSync(process.execPath, [VUE_TSC, '--project', project, '--noEmit', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  const out = []
  for (const line of (r.stdout + r.stderr).split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line)
    if (m) out.push({ file: path.resolve(ROOT, m[1]), line: Number(m[2]) - 1, col: Number(m[3]) - 1, code: Number(m[4]), msg: m[5] })
  }
  return out
}
const up = (n, test) => { while (n && !test(n)) n = n.parent; return n }
const nodeAt = (sf, pos) => { let found = sf; const visit = (n) => { if (pos >= n.getStart(sf) && pos < n.getEnd()) { found = n; ts.forEachChild(n, visit) } }; ts.forEachChild(sf, visit); return found }
const offsetOf = (text, line, col) => { let o = 0; for (let i = 0; i < line; i++) o = text.indexOf('\n', o) + 1; return o + col }
/* the script blocks of a component: [start, end) of their content */
const scripts = (text) => [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => ({ start: m.index + m[0].indexOf('>') + 1, end: m.index + m[0].length - '</script>'.length }))
const templateRange = (text) => { const a = text.indexOf('<template'); const b = text.lastIndexOf('</template>'); return a >= 0 && b > a ? [a, b] : null }
const IMPLICIT_ANY = new Set([7005, 7006, 7008, 7018, 7019, 7031, 7034])
const ACCESS = new Set([2339, 7053, 2551, 2571, 18046, 18047, 18048, 2531, 2532, 2533])
const REACTIVE = new Set(['ref', 'shallowRef', 'reactive', 'shallowReactive', 'computed', 'inject'])

function round(n) {
  const errs = check()
  const byFile = new Map()
  for (const e of errs) if (e.file.endsWith('.vue')) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e) }
  let edits = 0
  for (const [file, list] of byFile) {
    const text = fs.readFileSync(file, 'utf8')
    const blocks = scripts(text)
    const parsed = blocks.map((b) => ({ ...b, sf: ts.createSourceFile(file + '.ts', text.slice(b.start, b.end), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }))
    const add = []
    const once = new Set()
    const put = (at, s, del = 0) => { const k = at + ':' + s; if (!once.has(k)) { once.add(k); add.push({ at, s, del }) } }
    /* a name the script declares, where: a top-level `const name = …` in the setup block */
    const declOf = (name) => {
      for (const b of parsed) {
        let hit = null
        const visit = (x) => { if (hit) return; if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === name) hit = x; else ts.forEachChild(x, visit) }
        visit(b.sf)
        if (hit) return { b, d: hit }
      }
      return null
    }
    /* settle a declaration: a reactive value made with no type gets <any>; anything else says : any */
    const settle = ({ b, d }) => {
      const init = d.initializer
      if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && REACTIVE.has(init.expression.text) && !init.typeArguments) { put(b.start + init.expression.getEnd(), '<any>'); return true }
      if (!d.type && init && !ts.isCallExpression(init)) { put(b.start + d.name.getEnd(), ': any'); return true }
      return false
    }
    const tpl = templateRange(text)
    const marked = new Set()
    for (const e of list) {
      const at = offsetOf(text, e.line, e.col)
      const b = parsed.find((x) => at >= x.start && at < x.end)
      if (b) {
        const local = at - b.start
        const sf = b.sf
        const nd = nodeAt(sf, local)
        if (e.code === 2578) {
          const ls = text.lastIndexOf('\n', at - 1) + 1, le = text.indexOf('\n', at) + 1
          if (/^\s*\/\/ @ts-expect-error/.test(text.slice(ls, le))) put(ls, '', le - ls)
          continue
        }
        if (IMPLICIT_ANY.has(e.code)) {
          const param = up(nd, ts.isParameter)
          if (param && !param.type) { put(b.start + (param.questionToken || param.name).getEnd(), param.dotDotDotToken ? ': any[]' : ': any'); continue }
          const decl = up(nd, ts.isVariableDeclaration)
          const loop = decl && decl.parent && decl.parent.parent && (ts.isForOfStatement(decl.parent.parent) || ts.isForInStatement(decl.parent.parent)) ? decl.parent.parent : null
          if (loop) { if (!ts.isParenthesizedExpression(loop.expression)) { put(b.start + loop.expression.getStart(sf), '('); put(b.start + loop.expression.getEnd(), ' as any)') } continue }
          if (decl && !decl.type) { if (!settle({ b, d: decl })) put(b.start + decl.name.getEnd(), ': any'); continue }
        }
        if (e.code === 2339 || e.code === 2525 || e.code === 2459) {
          const pat = up(nd, (x) => ts.isObjectBindingPattern(x) || ts.isArrayBindingPattern(x))
          const owner = pat && up(pat, (x) => ts.isParameter(x) || ts.isVariableDeclaration(x))
          if (owner && !owner.type && owner.name === pat) { put(b.start + owner.name.getEnd(), ': any'); continue }
        }
        if (ACCESS.has(e.code)) {
          const access = up(nd, (x) => ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x))
          if (access && !ts.isParenthesizedExpression(access.expression)) {
            let obj = access.expression
            /* x.value.y: the reactive value x was made without a type */
            if (ts.isPropertyAccessExpression(obj) && obj.name.text === 'value' && ts.isIdentifier(obj.expression)) { const d = declOf(obj.expression.text); if (d && settle(d)) continue }
            if (ts.isIdentifier(obj)) { const d = declOf(obj.text); if (d && settle(d)) continue }
            const stmt = up(obj, ts.isExpressionStatement)
            const opens = !!stmt && stmt.getStart(sf) === obj.getStart(sf) && /^\s*$/.test(sf.text.slice(sf.text.lastIndexOf('\n', obj.getStart(sf) - 1) + 1, obj.getStart(sf)))
            if (obj.kind !== ts.SyntaxKind.SuperKeyword) { put(b.start + obj.getStart(sf), opens ? ';(' : '('); put(b.start + obj.getEnd(), ' as any)'); continue }
          }
        }
        if (n < 2) continue
        const ls = text.lastIndexOf('\n', at - 1) + 1
        if (marked.has(ls)) continue
        /* never inside a template literal: the marker would become its text */
        const tok = nodeAt(sf, ls - b.start)
        if (tok.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || ts.isTemplateExpression(tok) || tok.kind === ts.SyntaxKind.TemplateHead || tok.kind === ts.SyntaxKind.TemplateMiddle || tok.kind === ts.SyntaxKind.TemplateTail) continue
        marked.add(ls)
        put(ls, `${/^[ \t]*/.exec(text.slice(ls))[0]}// @ts-expect-error TS${e.code}, from the conversion: ${e.msg.replace(/\s+/g, ' ').replace(/\*\//g, '* /').slice(0, 140)}\n`)
        continue
      }
      if (tpl && at > tpl[0] && at < tpl[1]) {
        if (e.code === 2578) {
          /* the marker the error points into, inline or on its own line */
          const ls = text.lastIndexOf('\n', at - 1) + 1, le = text.indexOf('\n', at) + 1
          const from = text.lastIndexOf('<!-- @vue-expect-error', at + 1)
          /* the comment alone: a marker sits inline before its node, and the node is never touched */
          if (from >= ls) { const to = text.indexOf('-->', from) + 3; const rest = text.slice(ls, from) + text.slice(to, le); put(from, '', to - from + (/^\s*$/.test(rest) ? le - to : 0)) }
          continue
        }
        /* the name the expression begins with, settled where the script declares it */
        let s = at; while (s > 0 && /[\w$.?]/.test(text[s - 1])) s--
        let root = /^[A-Za-z_$][\w$]*/.exec(text.slice(s))?.[0]
        /* a v-for's alias: what it iterates is what was declared without a type */
        if (root) {
          const fors = [...text.slice(tpl[0], at).matchAll(/v-for="\(?([^")]*?)\)?\s+(?:in|of)\s+([A-Za-z_$][\w$]*)/g)]
          for (let i = fors.length - 1; i >= 0; i--) if (fors[i][1].split(',').map((x) => x.trim()).includes(root)) { root = fors[i][2]; break }
        }
        if (root && ACCESS.has(e.code)) { const d = declOf(root); if (d && settle(d)) continue }
        /* a parameter of an arrow written in the template: (x) => … takes its annotation where it stands */
        if (e.code === 7006 || e.code === 7031) {
          const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(at))?.[0]
          if (word) {
            const after = text.slice(at + word.length)
            if (/^\s*[,)]/.test(after) && /^[^=]*=>/.test(after.slice(0, 200))) { put(at + word.length, ': any'); continue }
            if (/^\s*=>/.test(after) && !/\(\s*$/.test(text.slice(Math.max(0, at - 3), at))) { put(at, '('); put(at + word.length, ': any)'); continue }
          }
        }
        if (n < 2) continue
        /* the marker covers the node right after it, so it goes immediately before the one the error is in: the
           interpolation it sits in, or the tag whose attributes hold it — inline, never at the start of the line */
        const mOpen = text.lastIndexOf('{{', at), mClose = text.lastIndexOf('}}', at)
        let where = -1
        if (mOpen > mClose && mOpen > tpl[0]) where = mOpen
        else {
          for (let p = at; ;) {
            p = text.lastIndexOf('<', p - 1)
            if (p <= tpl[0]) break
            if (!/^<[A-Za-z]/.test(text.slice(p, p + 2))) continue
            /* the tag whose opening the error is inside: no > between it and the error that closes it */
            const closeAt = text.indexOf('>', p)
            if (closeAt >= at) { where = p; break }
            break
          }
        }
        if (where < 0 || marked.has(where)) continue
        marked.add(where)
        put(where, `<!-- @vue-expect-error TS${e.code}, from the conversion: ${e.msg.replace(/\s+/g, ' ').replace(/--/g, '—').slice(0, 140)} -->`)
      }
    }
    if (!add.length) continue
    let out = text
    for (const x of add.sort((p, q) => q.at - p.at)) out = out.slice(0, x.at) + x.s + out.slice(x.at + x.del)
    fs.writeFileSync(file, out)
    edits += add.length
  }
  return { errs: errs.length, vue: [...byFile.values()].reduce((a, l) => a + l.length, 0), edits }
}

let last = null
for (let n = 0; n < 14; n++) {
  const r = round(n)
  console.log(`round ${n + 1}: ${r.errs} error(s), ${r.vue} in components, ${r.edits} edit(s)`)
  if (!r.errs) break
  if (!r.edits && last === r.errs && n >= 3) { console.log(`✖ ${r.errs} error(s) left to fix by hand`); process.exitCode = 1; break }
  last = r.errs
}
