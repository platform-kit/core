#!/usr/bin/env node
/*
 * THE MECHANICAL HALF OF CONVERTING A FILE TO TYPESCRIPT (openspec: typescript-throughout).
 *
 * The approach Airbnb's ts-migrate takes, on TypeScript's own compiler API: rename the file, then make the strict check
 * pass without changing what the code does —
 *
 *   an implicit any becomes an explicit one     a parameter, a destructured parameter, a rest, a variable, a member:
 *                                               `: any` written where TypeScript could not infer, so the strictness of
 *                                               the files already typed is kept and every place still to type is a
 *                                               search for ": any" away
 *   an object that grows a property             `x.y` where TypeScript's type of x has no y (an object built up after
 *                                               `{}`, a record read by a key): the declaration says `: any`, or the
 *                                               read says `(x as any)`
 *   a module with no types                      declared once in build/types/untyped-modules.d.ts
 *   anything else                               `// @ts-expect-error TS<code>, from the conversion: <message>` on the
 *                                               line — an error TypeScript found in code that was JavaScript, kept
 *                                               visible rather than fixed by a guess; the check fails the day it is
 *                                               fixed, which is when the comment comes out
 *
 * It repeats until the check is clean for the files it converted. Imports are never touched: every import already names
 * the emitted .mjs (.js), which TypeScript reads as the source and build/workspace-ts.mjs resolves in the workspace.
 *
 *   node build/ts-migrate.mjs --project tsconfig.json <file.mjs|file.js>...   rename and annotate
 *   node build/ts-migrate.mjs --project tsconfig.json --annotate <file.mts>... annotate files already renamed
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const args = process.argv.slice(2)
const project = path.resolve(args[args.indexOf('--project') + 1])
const only = args.includes('--annotate')
const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--project').map((f) => path.resolve(f))
const SHIMS = path.join(path.dirname(new URL(import.meta.url).pathname), 'types', 'untyped-modules.d.ts')

/* 1. the rename: .mjs → .mts, .js → .ts, in git so the history follows */
const files = inputs.map((f) => {
  if (only) return f
  const to = f.replace(/\.mjs$/, '.mts').replace(/\.js$/, '.ts')
  if (to === f) throw new Error(`not a JavaScript file: ${f}`)
  try { execFileSync('git', ['mv', f, to], { stdio: 'ignore' }) } catch { fs.renameSync(f, to) }
  return to
})
const mine = new Set(files)

const IMPLICIT_ANY = new Set([7005, 7006, 7008, 7018, 7019, 7031, 7034])
const config = () => {
  const parsed = ts.getParsedCommandLineOfConfigFile(project, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')) } })
  return parsed
}
const nodeAt = (sf, pos) => {
  let found = sf
  const visit = (n) => { if (pos >= n.getStart(sf) && pos < n.getEnd()) { found = n; ts.forEachChild(n, visit) } }
  ts.forEachChild(sf, visit)
  return found
}
const up = (n, test) => { while (n && !test(n)) n = n.parent; return n }

function pass(round) {
  const cfg = config()
  const program = ts.createProgram({ rootNames: cfg.fileNames, options: cfg.options })
  const edits = new Map()   /* file → [{ at, text }] */
  const add = (file, at, text, del = 0) => { if (!edits.has(file)) edits.set(file, []); const e = edits.get(file); if (!e.some((x) => x.at === at && x.text === text)) e.push({ at, text, del }) }
  const untyped = new Set()
  let left = 0
  const marked = new Map()   /* file → Set of lines given a @ts-expect-error this round */
  for (const sf of program.getSourceFiles()) {
    if (!mine.has(path.resolve(sf.fileName))) continue
    const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]
    for (const d of diags) {
      if (d.start == null) continue
      left++
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
      const n = nodeAt(sf, d.start)
      const file = sf.fileName
      /* a marker whose error is gone (a fix elsewhere settled it): the marker goes */
      if (d.code === 2578) {
        const line = sf.getLineAndCharacterOfPosition(d.start).line
        const a = sf.getPositionOfLineAndCharacter(line, 0), b = line + 1 < sf.getLineStarts().length ? sf.getPositionOfLineAndCharacter(line + 1, 0) : sf.text.length
        if (/^\s*\/\/ @ts-expect-error/.test(sf.text.slice(a, b))) { add(file, a, '', b - a); continue }
      }
      if (IMPLICIT_ANY.has(d.code)) {
        const param = up(n, ts.isParameter)
        if (param && !param.type) {
          /* `t => …` has no parentheses for the annotation to sit in */
          const bare = ts.isArrowFunction(param.parent) && param.parent.parameters.length === 1 && sf.text[param.getStart(sf) - 1] !== '(' && !sf.text.slice(param.parent.getStart(sf), param.getStart(sf)).includes('(')
          if (bare) { add(file, param.getStart(sf), '('); add(file, param.getEnd(), ': any)'); continue }
          add(file, (param.questionToken || param.name).getEnd(), param.dotDotDotToken ? ': any[]' : ': any'); continue
        }
        const decl = up(n, ts.isVariableDeclaration)
        /* a loop's variable takes no annotation: its iterable is read as any instead */
        const loop = decl && decl.parent && decl.parent.parent && (ts.isForOfStatement(decl.parent.parent) || ts.isForInStatement(decl.parent.parent)) ? decl.parent.parent : null
        if (loop) { if (!ts.isParenthesizedExpression(loop.expression)) { add(file, loop.expression.getStart(sf), '('); add(file, loop.expression.getEnd(), ' as any)') } continue }
        if (decl && !decl.type) { add(file, decl.name.getEnd(), ': any'); continue }
        const member = up(n, (x) => ts.isPropertyDeclaration(x) || ts.isPropertySignature(x))
        if (member && !member.type) { add(file, member.name.getEnd(), ': any'); continue }
      }
      /* a declaration file cannot name the inferred type: the export says what it is — any, until somebody writes it */
      if (d.code === 2742) {
        const v = up(n, ts.isVariableDeclaration)
        if (v && !v.type) { add(file, v.name.getEnd(), ': any'); continue }
        const fn = up(n, (x) => ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x))
        if (fn && !fn.type) { const close = fn.parameters.end; add(file, sf.text.indexOf(')', close) + 1, ': any'); continue }
      }
      if (d.code === 7016) {   /* a module with no types */
        const spec = /module '([^']+)'/.exec(msg)?.[1]
        if (spec) { untyped.add(spec); continue }
      }
      /* a destructured parameter or variable whose default or source is {}: the pattern says any */
      if (d.code === 2339 || d.code === 2525 || d.code === 2459) {
        const pat = up(n, (x) => ts.isObjectBindingPattern(x) || ts.isArrayBindingPattern(x))
        const owner = pat && up(pat, (x) => ts.isParameter(x) || ts.isVariableDeclaration(x))
        if (owner && !owner.type && owner.name === up(pat, (x) => x.parent === owner)) { add(file, owner.name.getEnd(), ': any'); continue }
      }
      /* a property the type does not have, or an index it does not take: the object, read as any */
      if (d.code === 2339 || d.code === 7053 || d.code === 2551 || d.code === 2571 || d.code === 18046 || d.code === 18047 || d.code === 18048 || d.code === 2531 || d.code === 2532 || d.code === 2533) {
        const access = up(n, (x) => ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x))
        if (access && !ts.isParenthesizedExpression(access.expression)) {
          const obj = access.expression
          /* an object begun as {} or [] and built up: its declaration says any */
          if (ts.isIdentifier(obj)) {
            const sym = program.getTypeChecker().getSymbolAtLocation(obj)
            const dec = sym?.valueDeclaration
            const inLoop = dec && dec.parent?.parent && (ts.isForOfStatement(dec.parent.parent) || ts.isForInStatement(dec.parent.parent))
            if (dec && ts.isVariableDeclaration(dec) && !dec.type && !inLoop && dec.getSourceFile() === sf && ts.isIdentifier(dec.name)) { add(file, dec.name.getEnd(), ': any'); continue }
            if (dec && ts.isParameter(dec) && !dec.type && dec.getSourceFile() === sf) { add(file, (dec.questionToken || dec.name).getEnd(), ': any'); continue }
          }
          /* a ( that would open a line would be read as a call on the line before: it opens with ; */
          const stmt = up(obj, ts.isExpressionStatement)
          const opensLine = !!stmt && stmt.getStart(sf) === obj.getStart(sf) && /^\s*$/.test(sf.text.slice(sf.text.lastIndexOf('\n', obj.getStart(sf) - 1) + 1, obj.getStart(sf)))
          if (obj.kind !== ts.SyntaxKind.SuperKeyword) { add(file, obj.getStart(sf), opensLine ? ';(' : '('); add(file, obj.getEnd(), ' as any)'); continue }
        }
      }
      /* everything else: kept visible on its line, where TypeScript's comment can reach it */
      if (round < 2) continue   /* the annotations above settle most of it; mark only what two rounds leave */
      const line = sf.getLineAndCharacterOfPosition(d.start).line
      if (!marked.has(file)) marked.set(file, new Set())
      if (marked.get(file).has(line)) continue
      const lineStart = sf.getPositionOfLineAndCharacter(line, 0)
      /* never inside a template or a string spanning lines: the comment would become part of it */
      const tok = nodeAt(sf, lineStart)
      if (ts.isTemplateLiteral?.(tok) || tok.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || tok.kind === ts.SyntaxKind.TemplateHead || tok.kind === ts.SyntaxKind.TemplateMiddle || tok.kind === ts.SyntaxKind.TemplateTail || ts.isTemplateExpression(tok)) continue
      marked.get(file).add(line)
      const indent = /^[ \t]*/.exec(sf.text.slice(lineStart))[0]
      add(file, lineStart, `${indent}// @ts-expect-error TS${d.code}, from the conversion: ${msg.replace(/\s+/g, ' ').slice(0, 140)}\n`)
    }
  }
  if (untyped.size) {
    const had = fs.existsSync(SHIMS) ? fs.readFileSync(SHIMS, 'utf8') : `/*\n * THE MODULES THE KIT IMPORTS THAT CARRY NO TYPES, declared as any until one is written (openspec: typescript-throughout).\n * build/ts-migrate.mjs adds a line when a converted file imports one.\n */\n`
    const known = new Set([...had.matchAll(/declare module '([^']+)'/g)].map((m) => m[1]))
    const more = [...untyped].filter((s) => !known.has(s)).sort()
    if (more.length) { fs.mkdirSync(path.dirname(SHIMS), { recursive: true }); fs.writeFileSync(SHIMS, had + more.map((s) => `declare module '${s}'\n`).join('')) }
  }
  let n = 0
  for (const [file, list] of edits) {
    let text = fs.readFileSync(file, 'utf8')
    for (const e of list.sort((a, b) => b.at - a.at)) { text = text.slice(0, e.at) + e.text + text.slice(e.at + (e.del || 0)); n++ }
    fs.writeFileSync(file, text)
  }
  return { left, n, untyped: untyped.size }
}

let last = null
for (let round = 0; round < 12; round++) {
  const r = pass(round)
  console.log(`round ${round + 1}: ${r.left} error(s) in the converted files, ${r.n} edit(s)${r.untyped ? `, ${r.untyped} untyped module(s)` : ''}`)
  if (!r.left) break
  if (!r.n && !r.untyped && last === r.left && round >= 3) { console.log(`✖ ${r.left} error(s) the conversion could not settle — fix them by hand`); process.exitCode = 1; break }
  last = r.left
}
