/*
 * A TEAM IS A FILE, and what the compile refuses.
 *
 * The grammar is small, so what is worth pinning is the refusals: a team nobody can name, two teams
 * with one slug, a fill whose key means nothing, a fill naming a tier the site does not sell — and
 * a booking type pointing at a team that is gone or unpublished, which is the one that would
 * otherwise show a reader an empty calendar and say nothing.
 *
 * The fill is compiled by the SAME function a space's is, so this checks that they agree rather
 * than re-checking the fill grammar, which build/spaces.test.mjs already pins.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTeam, serialiseTeam } from './teams-io.mjs'
import { compileTeams } from './teams.mjs'
import { gitStore } from './store/index.mjs'

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }

console.log('\nTEAMS\n')

/* --- the grammar --- */
const t = parseTeam('the-practice', '---\nname: The practice\nposition: 2\nfill:\n  role: provider\n---\n\nEverybody who gives sessions.\n')
ok('a file is a team', t.slug === 'the-practice' && t.name === 'The practice' && t.position === 2)
ok('its body is the line beside its name', t.about === 'Everybody who gives sessions.')
ok('and its fill is read as written', JSON.stringify(t.fill) === '{"role":"provider"}')
ok('published unless it says otherwise', t.published === true && parseTeam('x', '---\nname: X\npublished: false\n---\n').published === false)
ok('no fill is invitation only', JSON.stringify(parseTeam('x', '---\nname: X\n---\n').fill) === '{}')
/* A FILE NEVER NAMES A PERSON. There is no key for it, and adding one would be the mistake this
   whole shape exists to prevent. */
ok('there is no way to name a member in a file', !('members' in t) && !('people' in t))
const round = parseTeam('the-practice', serialiseTeam(t))
ok('written back, it reads the same', round.name === t.name && round.position === t.position && JSON.stringify(round.fill) === JSON.stringify(t.fill) && round.about === t.about)

/* --- the refusals --- */
const dir = mkdtempSync(join(tmpdir(), 'teams-'))
const write = (slug, body) => { mkdirSync(join(dir, 'content/teams'), { recursive: true }); writeFileSync(join(dir, 'content/teams', slug + '.md'), body) }
const catalog = (sessions = [], tiers = []) => {
  mkdirSync(join(dir, 'supabase/functions/_shared'), { recursive: true })
  writeFileSync(join(dir, 'supabase/functions/_shared/catalog.json'), JSON.stringify({ sessions, offers: Object.fromEntries(tiers.map((t) => [t, { sku: t, key: t, kind: 'membership', tier: t }])) }))
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }
const refuses = async (why) => { try { await quiet(() => compileTeams({ store: gitStore(dir), write: false })); return false } catch (e) { return /fault/.test(e.message) } }

catalog()
write('a-team', '---\nname: A team\n---\n')
ok('a good team compiles', (await quiet(() => compileTeams({ store: gitStore(dir), write: false }))).length === 1)

write('no-name', '---\npublished: true\n---\n')
ok('a team with no name is refused', await refuses())
rmSync(join(dir, 'content/teams/no-name.md'))

write('bad-fill', '---\nname: Bad\nfill:\n  favourite: blue\n---\n')
ok('a fill key that means nothing is refused', await refuses())
rmSync(join(dir, 'content/teams/bad-fill.md'))

catalog([], ['tier-2'])
write('wrong-tier', '---\nname: Wrong\nfill:\n  tier: tier-nine\n---\n')
ok('a fill naming a tier the site does not sell is refused', await refuses())
rmSync(join(dir, 'content/teams/wrong-tier.md'))

/* THE ONE THAT WOULD OTHERWISE BE AN EMPTY CALENDAR */
catalog([{ slug: 'a-call', team: 'gone' }], [])
ok('a booking type naming a team that is not here is refused', await refuses())
write('gone', '---\nname: Gone\npublished: false\n---\n')
ok('and one naming a team that is unpublished is refused too', await refuses())
write('gone', '---\nname: Here\n---\n')
ok('and passes once the team is published', (await quiet(() => compileTeams({ store: gitStore(dir), write: false }))).length === 2)

rmSync(dir, { recursive: true, force: true })
console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)
