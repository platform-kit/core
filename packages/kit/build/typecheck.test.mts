/*
 * THE TYPECHECK, AND THAT IT CAN FAIL (openspec: typescript-throughout). `npm run typecheck` runs `tsc` over the engine and
 * `vue-tsc` over the theme. A check that passes is only worth something if it would have failed, and both once passed while
 * reading nothing: `npx` runs from the workspace package's root, so a project path written from another folder named the
 * engine's config twice. So each config is also handed a file with a type error of its own, in a folder of this test's,
 * and must refuse it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

const KIT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = path.resolve(KIT, '..', '..')
const bin = (name: string): string => path.join(ROOT, 'node_modules', name === 'tsc' ? 'typescript/bin/tsc' : 'vue-tsc/bin/vue-tsc.js')
const run = (name: string, project: string) => spawnSync(process.execPath, [bin(name), '--project', project, '--noEmit'], { cwd: ROOT, encoding: 'utf8' })
const said = (r: { stdout: string, stderr: string }): string => (r.stdout + r.stderr).trim().split('\n').slice(0, 12).join('\n')

/* a folder of this test's, with a config that extends the kit's and reads one file. Inside the workspace's node_modules cache,
   so the types the config names resolve from it, and no dev server watches it */
function planted(extendsFrom: string, file: string, text: string): string {
  const cache = path.join(ROOT, 'node_modules', '.cache', 'platformkit')
  fs.mkdirSync(cache, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cache, 'typecheck-'))
  fs.writeFileSync(path.join(dir, file), text)
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: extendsFrom, include: [file], exclude: [] }))
  return dir
}

test('the engine typechecks', () => {
  const r = run('tsc', path.join(KIT, 'tsconfig.json'))
  assert.equal(r.status, 0, said(r))
})

test('the theme typechecks', () => {
  const r = run('vue-tsc', path.join(KIT, 'theme', 'tsconfig.json'))
  assert.equal(r.status, 0, said(r))
})

test('the engine\'s config refuses a type error', () => {
  const dir = planted(path.join(KIT, 'tsconfig.json'), 'wrong.mts', 'export const n: number = "not a number"\n')
  try {
    const r = run('tsc', path.join(dir, 'tsconfig.json'))
    assert.notEqual(r.status, 0, 'a string assigned to a number passed')
    assert.match(r.stdout + r.stderr, /TS2322/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the theme\'s config refuses a type error in a component', () => {
  const dir = planted(path.join(KIT, 'theme', 'tsconfig.json'), 'Wrong.vue', '<script setup lang="ts">\nconst n: number = "not a number"\n</script>\n<template><p>{{ n }}</p></template>\n')
  try {
    const r = run('vue-tsc', path.join(dir, 'tsconfig.json'))
    assert.notEqual(r.status, 0, 'a string assigned to a number passed in a component')
    assert.match(r.stdout + r.stderr, /TS2322/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* A passing check does not prove a file runs: an expect-error comment can hold a syntax TypeScript reports and Node refuses */
test('Node can strip every converted module', () => {
  const refused: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.m?ts$/.test(e.name) && !/\.d\.m?ts$/.test(e.name)) {
        try { stripTypeScriptTypes(fs.readFileSync(p, 'utf8')) } catch (err) { refused.push(`${path.relative(KIT, p)}: ${(err as Error).message.split('\n')[0]}`) }
      }
    }
  }
  for (const dir of ['build', 'src', 'vite', 'theme/src']) walk(path.join(KIT, dir))
  assert.deepEqual(refused, [])
})
