/*
 * THE MEMBER CARD'S PANELS (openspec: kit-extension-model, "A site registers what a member's card says about
 * somebody"): which of the kit's three a site's modules allow, and a site's own off, panels and order on top.
 * The database half (who may read them, the card and the admin agreeing) is member-panels-db.test.mjs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatesOf, arrange } from '../src/lib/member-panels.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const kit = [{ key: 'working' }, { key: 'read' }, { key: 'bought' }]
const keys = (l) => l.map((p) => p.key).join(',')

/* the gates, by modules */
ok('every module on and no instrument of the site\'s own: Read and Bought', keys(arrange(kit, gatesOf({ modules: {} }))) === 'read,bought')
ok('…with an instrument of its own: Working first', keys(arrange(kit, gatesOf({ modules: {}, instrument: { module: './x.js' } }))) === 'working,read,bought')
ok('the instrument module off: no Working, whatever the site names', !gatesOf({ modules: { instrument: false }, instrument: { module: './x.js' } }).working)
ok('the store off: no Bought', keys(arrange(kit, gatesOf({ modules: { store: false } }))) === 'read')
ok('no library at all: no Read', !gatesOf({ modules: { books: false, articles: false } }).read)
ok('articles alone are a library', gatesOf({ modules: { books: false } }).read)

/* the site's own on top */
const all = { working: true, read: true, bought: true }
ok('a site turns a kit panel off', keys(arrange(kit, all, { off: ['bought'] })) === 'working,read')
ok('a site adds its own after the kit\'s', keys(arrange(kit, all, { panels: [{ key: 'notes' }] })) === 'working,read,bought,notes')
ok('a site sets the order, and what it does not name keeps its place after', keys(arrange(kit, all, { panels: [{ key: 'notes' }], order: ['notes', 'read'] })) === 'notes,read,working,bought')
ok('every kit panel off and none of its own: nothing', arrange(kit, all, { off: ['working', 'read', 'bought'] }).length === 0)

/* the words: every panel's, in the theme, both forms and the empty sentence; and no site's name anywhere in them */
const words = fs.readFileSync(path.join(HERE, '..', 'theme', 'src', 'content', 'ui', 'spaces.md'), 'utf8')
for (const k of ['working', 'read', 'bought']) for (const s of ['-title', '-title-own', '-none', '-none-own']) ok(`the theme words ${k}${s}`, new RegExp(`^${k}${s}: .+$`, 'm').test(words))
const panelsDir = path.join(HERE, '..', 'theme', 'src', 'components', 'spaces', 'panels')
const src = fs.readdirSync(panelsDir).map((f) => fs.readFileSync(path.join(panelsDir, f), 'utf8')).join('\n')
ok('no site is named in the kit\'s panels', !/dharma/i.test(src))
ok('Working names levels from the site\'s instrument, never by a key of its own', /from '#site\/instrument'/.test(src) && /LEVELS\[lv\]\.name/.test(src))

console.log(fail ? `member-panels: ${fail} failed, ${pass} passed` : `member-panels: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
