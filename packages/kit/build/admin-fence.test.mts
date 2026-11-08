/*
 * THE FENCE, pinned. A coach reaches the admin to edit one thing: their own page. They are not an
 * editor and must not become one by being let through the door, so the caller arrives with
 * `env.only = { col, field, value }` and the pipe answers for exactly one collection and exactly
 * the records whose field carries their name.
 *
 * It is a fence and not a filter, which is the whole point of testing it here: a surface that
 * merely showed somebody their own rows would leave every other row one hand-written request away.
 * So every verb is checked — the collections listing, list, read, write, create, rename, delete,
 * publish, publish-everything — and each one is asked twice: once for a record that is theirs and
 * once for a record that is not. `npm test` runs it.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { adminRequest } from './admin-pipe.mjs'
import { registry, describe as describeModel } from './models/index.mjs'
import { asStore } from './store/index.mjs'

let n = 0, bad = 0
const ta = async (name: string, fn: { (): Promise<void>; (): Promise<void>; (): Promise<void>; (): Promise<void>; (): Promise<void>; (): Promise<void>; (): Promise<void>; (): Promise<void>; (): any }) => { n++; try { await fn() } catch (e: any) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 3).join('\n    ')) } }

/* a site with two pages: one the coach owns, one the site's */
const root = mkdtempSync(path.join(tmpdir(), 'fence-'))
mkdirSync(path.join(root, 'content/pages'), { recursive: true })
const page = (title: string, route: string, owner?: string|undefined) => `---\ntitle: ${title}\nroute: ${route}\n${owner ? `owner: ${owner}\n` : ''}sections: []\n---\n`
writeFileSync(path.join(root, 'content/pages/mine.md'), page('Mine', '/p/ada', 'ada'))
writeFileSync(path.join(root, 'content/pages/theirs.md'), page('The landing', '/'))

const store = asStore(root)
const site = { root, modules: {}, admin: {} }
const base = { root, store, by: 'Ada', models: () => registry(root, { site, store }), describe: describeModel }
const open = base                                     /* an editor: no fence */
const fenced = { ...base, only: { col: 'pages', field: 'owner', value: 'ada' } }

const call = (env: { root: string; store: any; by: string; models: () => Promise<any>; describe: (model: any,root: any,store?: any) => Promise<{ key: any; label: any; dir: any; body: boolean; bodyLabel: any; nested: boolean; title: any; assets: boolean; single: any; builder: any; variants: any; editor: any; model: { key: any; name: any; singular: any; slug: any; deliver: any; order: any }|null; core: any; custom: boolean; fields: { kind?: any; fields?: any; of?: any; shown: any; unique?: boolean|undefined; rules?: any; choices: any; name: string; type: string; required: boolean; widget: any; options: any; grid: boolean; half: boolean; readonly: boolean; label: any; help: any }[]; count: number }>; only?: { col: string; field: string; value: string } }, method: string, seg: string, q = {}, body = null) => adminRequest(env, { method, seg, q, body })
/* the pipe answers a refusal rather than throwing it: the status is the answer */
const refused = async (p: Promise<any>) => { const r = await p.catch((e: { code: any }) => ({ status: e.code || 500 })); return r.status }

await ta('an editor sees every collection; a fenced caller sees the one', async () => {
  const all = await call(open, 'GET', 'collections')
  const one = await call(fenced, 'GET', 'collections')
  assert.ok(Object.keys(all.body.collections).length > 1)
  assert.deepEqual(Object.keys(one.body.collections), ['pages'])
})

await ta('the list is theirs alone', async () => {
  const all = await call(open, 'GET', 'list', { col: 'pages' })
  const mine = await call(fenced, 'GET', 'list', { col: 'pages' })
  assert.equal(all.body.items.length, 2)
  assert.deepEqual(mine.body.items.map((x: { name: any }) => x.name), ['mine'])
})

await ta('another collection is refused outright, not merely unlisted', async () => {
  assert.equal(await refused(call(fenced, 'GET', 'list', { col: 'articles' })), 403)
  assert.equal(await refused(call(fenced, 'GET', 'file', { col: 'articles', name: 'anything' })), 403)
})

await ta('they may read their own page and not somebody else\'s', async () => {
  const mine = await call(fenced, 'GET', 'file', { col: 'pages', name: 'mine' })
  assert.equal(mine.body.data.title, 'Mine')
  assert.equal(await refused(call(fenced, 'GET', 'file', { col: 'pages', name: 'theirs' })), 403)
})

await ta('they may save their own page', async () => {
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ col: string; name: string; data: { title: string; route: string; owner: string; sections: never[]; }; }' is not assignab
  const r = await call(fenced, 'POST', 'file', {}, { col: 'pages', name: 'mine', data: { title: 'Mine, edited', route: '/p/ada', owner: 'ada', sections: [] } })
  assert.ok(r.status === 200)
  const back = await call(fenced, 'GET', 'file', { col: 'pages', name: 'mine' })
  assert.equal(back.body.data.title, 'Mine, edited')
})

await ta('a save that would take somebody else\'s page is refused, whatever it claims', async () => {
  /* the record says it is theirs — the file says otherwise, and the file is what counts */
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ col: string; name: string; data: { title: string; route: string; owner: string; sections: never[]; }; }' is not assignab
  assert.equal(await refused(call(fenced, 'POST', 'file', {}, { col: 'pages', name: 'theirs', data: { title: 'Taken', route: '/', owner: 'ada', sections: [] } })), 403)
  /* and a save that signs their own page over to somebody else is refused too */
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ col: string; name: string; data: { title: string; route: string; owner: string; sections: never[]; }; }' is not assignab
  assert.equal(await refused(call(fenced, 'POST', 'file', {}, { col: 'pages', name: 'mine', data: { title: 'Mine', route: '/p/ada', owner: 'bea', sections: [] } })), 403)
})

await ta('a page they create is theirs or it is not created', async () => {
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ col: string; name: string; create: boolean; data: { title: string; route: string; owner: string; sections: never[]; }; }
  assert.equal(await refused(call(fenced, 'POST', 'file', {}, { col: 'pages', name: 'new-one', create: true, data: { title: 'New', route: '/p/bea', owner: 'bea', sections: [] } })), 403)
})

await ta('renaming, deleting and publishing obey the same fence', async () => {
  assert.equal(await refused(call(fenced, 'DELETE', 'file', { col: 'pages', name: 'theirs' })), 403)
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ col: string; name: string; }' is not assignable to parameter of type 'null | undefined'.
  assert.equal(await refused(call(fenced, 'POST', 'publish', {}, { col: 'pages', name: 'theirs' })), 403)
  /* and "publish everything" is the site's act, never one person's */
  // @ts-expect-error TS2345, from the conversion: Argument of type '{}' is not assignable to parameter of type 'null | undefined'.
  assert.equal(await refused(call(fenced, 'POST', 'publish', {}, {})), 403)
})

rmSync(root, { recursive: true, force: true })
console.log(`${bad ? '✖' : '✔'} admin fence: ${n - bad}/${n} checks`)
if (bad) process.exit(1)
