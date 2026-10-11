/* The strings merge: the site's words over the theme's defaults, by key, nothing of the theme lost
   and nothing of the site's overwritten. Run from a site's root; in npm test. */
import fs from 'node:fs'
import os from 'node:os'
import { parseGroups, mergeGroups, mergeUi, readScopes } from './strings-io.mjs'
import { loadSite } from './site.mjs'
import { loadTheme } from './theme.mjs'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }

/* the grammar */
const g = parseGroups(`---\nscope: x\n---\n\n## hero\n\n### title Named\nlabel: Hello\nnote: one\n\n### cta\nlabel: Go\n\n## foot\n\n### line\ntext: bye\n`)
ok('groups, keys and fields parse', g.hero.cta.label === 'Go' && g.foot.line.text === 'bye')
ok('a named key keeps its name as a field', g.hero.title.name === 'Named' && g.hero.title.label === 'Hello')

/* the merge */
const base = { hero: { title: { label: 'Default title', note: 'kept' }, cta: { label: 'Default go' } }, foot: { line: { text: 'default bye' } } }
const over = { hero: { title: { label: 'Site title' } }, extra: { k: { v: '1' } } }
const m = mergeGroups(base, over)
ok('a field the site writes wins', m.hero.title.label === 'Site title')
ok('a field the site leaves out is the theme\'s', m.hero.title.note === 'kept')
ok('a key the site does not mention is there whole', m.hero.cta.label === 'Default go')
ok('a group the site does not mention is there whole', m.foot.line.text === 'default bye')
ok('a group only the site has is there', m.extra.k.v === '1')
ok('the merge never writes to its inputs', base.hero.title.label === 'Default title' && !('extra' in base))
ok('a missing side is fine', mergeGroups(undefined, over).extra.k.v === '1' && mergeGroups(base, undefined).foot.line.text === 'default bye')

/* the theme's defaults and this site's files */
const c = await loadSite(); const theme = await loadTheme(c)
const T = readScopes(theme.strings), S = readScopes(c.root + '/content/app/ui')
ok(`the theme ships default strings (${Object.keys(T).length} scopes)`, Object.keys(T).length > 0)
const merged = mergeUi(Object.values(S), theme.strings)
const byScope = Object.fromEntries(merged.map((e) => [e.scope, e]))
ok('every theme scope is in the merged collection', Object.keys(T).every((s) => byScope[s]))
ok('every site scope is in the merged collection', Object.keys(S).every((s) => byScope[s]))
let lost = []
for (const [scope, t] of Object.entries(T)) for (const [gk, keys] of Object.entries(t.groups)) for (const [k, fields] of Object.entries(keys)) for (const f of Object.keys(fields)) if (!(byScope[scope].groups[gk] && byScope[scope].groups[gk][k] && f in byScope[scope].groups[gk][k])) lost.push(`${scope}.${gk}.${k}.${f}`)
ok(`no field of the theme's defaults is lost in the merge${lost.length ? ' — ' + lost.slice(0, 5).join(' ') : ''}`, lost.length === 0)
let overwritten = []
for (const [scope, s] of Object.entries(S)) for (const [gk, keys] of Object.entries(s.groups)) for (const [k, fields] of Object.entries(keys)) for (const [f, v] of Object.entries(fields)) if (byScope[scope].groups[gk][k][f] !== v) overwritten.push(`${scope}.${gk}.${k}.${f}`)
ok(`no word of the site's is overwritten by a default${overwritten.length ? ' — ' + overwritten.slice(0, 5).join(' ') : ''}`, overwritten.length === 0)
const spacesRail = byScope.spaces.groups.rail.main
ok('the Spaces rail names Social Comments and Social Messages separately',
  spacesRail['social-comments'] === 'Social Comments' && spacesRail['social-dms'] === 'Social Messages')
ok('the Spaces rail names the Support Chat and Support Tickets destinations consistently',
  spacesRail.support === 'Support Chat'
    && spacesRail.tickets === 'Support Tickets'
    && spacesRail['my-tickets'] === 'Support Tickets')
const spacesDesk = byScope.spaces.groups.desk.main
ok('the Spaces desk uses Support Chat as its title and source label',
  spacesDesk['title-support'] === 'Support Chat' && spacesDesk['source-support'] === 'Support Chat')
const spacesTickets = byScope.spaces.groups.tickets.main
ok('the ticket page and tab use Support Tickets',
  spacesTickets.title === 'Support Tickets' && spacesTickets.tab === 'Support Tickets')
ok('Social visibility badges stay concise while composer notes explain the audience',
  spacesDesk['public-reply'] === 'Public reply'
    && spacesDesk['public-reply-note'] === 'Anyone on the post can see this reply.'
    && spacesDesk['private-dm'] === 'Private DM'
    && spacesDesk['private-dm-note'] === 'Only the recipient can see this message.')
ok('Social author profile fallback has authored copy',
  spacesDesk['profile-unavailable'] === 'Provider profile details are unavailable.')
ok('the merged entries carry no file path into the bundle', merged.every((e) => e.file === undefined))

/* A field name may carry a dot. The words for what a room hears are keyed on the event itself
   (hook-purchase.paid), and before this the grammar simply did not see those lines — every label in
   that menu was blank, which is the failure a missing key always is: silent. */
{
  const g = parseGroups('---\nscope: x\n---\n\n## notify\n\n### main\n\nhook-purchase.paid: A purchase\nplain: A word\n')
  ok('a field name may carry a dot', g.notify.main['hook-purchase.paid'] === 'A purchase')
  ok('and an ordinary one still reads', g.notify.main.plain === 'A word')
  ok('a line of prose is still not a field', !Object.keys(parseGroups('---\nscope: x\n---\n\n## g\n\n### k\n\nA sentence, and then some.\n').g.k).length)
}


/* ---------------------------------------------------------------------------------------------
 * THE ROLE'S WORD. The theme ships no English name for the person who delivers what the site
 * sells — its strings say {provider} and one record says what that is — so two things have to
 * hold: the merge must put the site's word in, and no placeholder may survive into what a reader
 * sees. A surviving {a-provider} on a page is the exact failure this replaces.
 */
{
  const theme = {
    people: { scope: 'people', groups: { role: { provider: { name: 'Provider', plural: 'Providers', a: 'a provider', your: 'your provider', work: 'Sessions', session: 'session' } } } },
    lib: { scope: 'lib', groups: { c: { main: { head: 'Work with {a-provider}.', tab: '{work}', many: '{providers} here', mine: 'Message {your-provider}', one: 'a {session}' } } } },
  }
  const dir = fs.mkdtempSync(os.tmpdir() + '/roles-')
  for (const [scope, e] of Object.entries(theme)) {
    const lines = ['---', 'scope: ' + scope, '---', '']
    for (const [g, keys] of Object.entries(e.groups)) {
      lines.push('## ' + g, '')
      for (const [k, fields] of Object.entries(keys)) {
        lines.push('### ' + k, '')
        for (const [fk, fv] of Object.entries(fields)) lines.push(fk + ': ' + fv)
        lines.push('')
      }
    }
    fs.writeFileSync(dir + '/' + scope + '.md', lines.join('\n'))
  }
  const site = [{ scope: 'people', groups: { role: { provider: { name: 'Coach', plural: 'Coaches', a: 'a coach', your: 'your coach', work: 'Coaching', session: 'session' } } } }]
  const merged = Object.fromEntries(mergeUi(site, dir).map((e) => [e.scope, e.groups]))
  const C = merged.lib.c.main
  ok('the site\'s word reaches a theme sentence', C.head === 'Work with a coach.', C.head)
  ok('the plural too', C.many === 'Coaches here', C.many)
  ok('the possessive too', C.mine === 'Message your coach', C.mine)
  ok('what the work is called', C.tab === 'Coaching', C.tab)
  ok('and one occasion of it', C.one === 'a session', C.one)
  const every = JSON.stringify(merged)
  ok('no placeholder survives the merge', !/\{(provider|providers|a-provider|your-provider|work|session)\}/.test(every))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
