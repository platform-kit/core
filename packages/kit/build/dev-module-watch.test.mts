/*
 * An edit to a module reaches the running dev site (openspec: modules-as-packages): a function or its shared code is
 * assembled again, a schema change applied where nothing is lost and held back where something would be, an edit made
 * in the assembled tree put back with the name of the file to edit, and a module's component hot-reloaded by Vite from
 * its own folder.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, handle, startDevWatch, type WatchRoots } from './dev-watch.mjs'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-watch-'))
const MOD = path.join(tmp, 'modules', 'things'), SITE = path.join(tmp, 'site', 'supabase')
for (const d of ['functions/thing-fn', 'schema', 'ui', 'integrations/spaces']) fs.mkdirSync(path.join(MOD, d), { recursive: true })
fs.mkdirSync(path.join(SITE, 'functions'), { recursive: true })
const roots: WatchRoots = { moduleDirs: [MOD], kitSupabase: null, siteSupabase: SITE }
const fakes = () => {
  const calls: string[] = [], lines: string[] = []
  return { calls, lines, act: { assemble: () => { calls.push('assemble'); return true }, migrate: () => { calls.push('migrate'); return { ok: true } }, sourceOf: (rel: string) => `packages/kit/modules/things/${rel}`, log: (l: string) => lines.push(l) } }
}

test('each kind of file is told from where it sits', () => {
  const k = (p: string) => classify(p, roots)
  assert.equal(k(path.join(MOD, 'functions/thing-fn/index.ts')), 'function')
  assert.equal(k(path.join(MOD, 'functions/_shared/x.ts')), 'function')
  assert.equal(k(path.join(MOD, 'schema/60-things.sql')), 'schema')
  assert.equal(k(path.join(MOD, 'integrations/spaces/schema.sql')), 'schema')
  assert.equal(k(path.join(MOD, 'module.ts')), 'manifest')
  assert.equal(k(path.join(MOD, 'ui/ThingPage.vue')), 'browser')
  assert.equal(k(path.join(SITE, 'functions/thing-fn/index.ts')), 'generated')
  assert.equal(k(path.join(SITE, '.assembled.json')), null)
  assert.equal(k(path.join(tmp, 'elsewhere.ts')), null)
})

test('a function edited during dev is assembled again', () => {
  const f = fakes()
  assert.deepEqual(handle([{ file: path.join(MOD, 'functions/thing-fn/index.ts'), kind: 'function' }], roots, f.act), ['assemble'])
})

test('a schema change that loses nothing is applied to the dev database', () => {
  const f = fakes()
  assert.deepEqual(handle([{ file: path.join(MOD, 'schema/60-things.sql'), kind: 'schema' }], roots, f.act), ['assemble', 'migrate'])
})

test('a destructive schema edit during dev applies nothing and says what to run', () => {
  const f = fakes()
  f.act.migrate = () => ({ ok: false, output: 'DROP COLUMN public.things.colour — refused' })
  assert.deepEqual(handle([{ file: path.join(MOD, 'schema/60-things.sql'), kind: 'schema' }], roots, f.act), ['assemble', 'migrate-refused'])
  assert.match(f.lines.join('\n'), /left as it is[\s\S]*PLATFORMKIT_ALLOW_DESTRUCTIVE=1 platformkit migrate[\s\S]*DROP COLUMN/)
})

test('an edit made in the generated folder is put back, naming the file to edit', () => {
  const f = fakes()
  assert.deepEqual(handle([{ file: path.join(SITE, 'functions/thing-fn/index.ts'), kind: 'generated' }], roots, f.act), ['restore', 'assemble'])
  assert.match(f.lines[0], /supabase\/functions\/thing-fn\/index\.ts is assembled, not edited: it was put back — edit packages\/kit\/modules\/things\/functions\/thing-fn\/index\.ts instead/)
})

test('the watcher acts on a real edit, and ignores what its own assembly writes', async () => {
  const f = fakes()
  let writes = 0
  f.act.assemble = () => { f.calls.push('assemble'); writes++; fs.writeFileSync(path.join(SITE, 'functions/written-by-assembly.ts'), String(writes)); return true }
  const stop = startDevWatch(roots, f.act, { debounceMs: 50 })
  try {
    /* past the moment a starting watch spends on what happened before it */
    await new Promise((r) => setTimeout(r, 800))
    fs.writeFileSync(path.join(MOD, 'functions/thing-fn/index.ts'), 'export {}\n')
    await new Promise((r) => setTimeout(r, 1500))
    assert.deepEqual(f.calls, ['assemble'], 'one edit, one assembly — and the assembly\'s own write is not taken for an edit; got ' + JSON.stringify(f.calls))
  } finally { stop() }
})

test('a module\'s component edited during dev is hot-reloaded from its folder', async () => {
  const demo = path.resolve(KIT, '../../sites/demo')
  const component = path.join(KIT, 'modules/courses/ui/CourseIcon.vue')
  const before = fs.readFileSync(component, 'utf8')
  const prev = process.cwd()
  process.chdir(demo)
  process.env.PLATFORMKIT_CONTENT_DONE = '1'
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: path.join(demo, 'vite.config.ts'), root: demo, server: { middlewareMode: true, hmr: { port: 24000 + Math.floor(Math.random() * 1000) } }, appType: 'custom', logLevel: 'error' })
  const sent: any[] = []
  /* what the dev server tells the browser, on either of its channels */
  for (const ch of [(server as any).hot, (server as any).ws]) { const orig = ch.send.bind(ch); ch.send = (p: any) => { sent.push(p); return orig(p) } }
  try {
    await server.transformRequest('/@fs' + component)
    fs.writeFileSync(component, before.replace('<template>', '<template>\n  <!-- an edit -->'))
    server.watcher.emit('change', component)
    await new Promise((r) => setTimeout(r, 1500))
    const update = sent.find((p) => p && p.type === 'update' && (p.updates || []).some((u: any) => String(u.path || u.acceptedPath).includes('modules/courses/ui/CourseIcon.vue')))
    assert.ok(update, 'no hot update for the module component: ' + JSON.stringify(sent).slice(0, 400))
  } finally {
    fs.writeFileSync(component, before)
    await server.close()
    process.chdir(prev)
  }
})

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
