/*
 * A CHANNEL CAN BE ENCRYPTED — the declaration, and the one place it is resolved.
 *
 * `encrypted` is a field on a channel and on the space above it, and `encryptedOf` is the only
 * reading of the two. Everything that asks — the build, the push step, the admin, the Matrix
 * surface — asks here, so none of them can come to a different answer about the same room.
 *
 * The check that matters is the one in the middle: a channel saying `encrypted: false` inside a
 * space saying `true` must come out FALSE. Said with truthiness rather than `typeof`, that channel
 * and a channel that said nothing at all are the same value, and a site loses the ability to let
 * one room out of a sealed space.
 *
 * Run from a site's root; in npm test.
 */
import { encryptedOf, sealedRooms, parseChannel, parseSpace, serialiseChannel, serialiseSpace } from './spaces-io.mjs'
import { kitConfig } from './velite.mjs'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }

/* ---- the resolution ---- */

ok('a channel that says it is encrypted is', encryptedOf({ encrypted: true }, {}) === true)
ok('a channel that says it is not, is not', encryptedOf({ encrypted: false }, {}) === false)
ok('a channel that says nothing takes its space\'s answer', encryptedOf({}, { encrypted: true }) === true)
ok('…and is open under an open space', encryptedOf({}, { encrypted: false }) === false)
ok('a channel overrides the space that holds it', encryptedOf({ encrypted: false }, { encrypted: true }) === false,
  'said with truthiness instead of typeof, this is the check that fails')
ok('…and the other way too', encryptedOf({ encrypted: true }, { encrypted: false }) === true)
ok('nothing at all is open', encryptedOf() === false && encryptedOf({}, {}) === false)
ok('the answer is always a boolean, never undefined', [encryptedOf(), encryptedOf({}, {}), encryptedOf({ encrypted: true })].every((v) => typeof v === 'boolean'))
/* a file may carry anything; velite coerces, but the resolution must not invent an answer from a
   value it was never given — only `true` and `false` are answers */
ok('a channel with a non-boolean value falls through to its space', encryptedOf({ encrypted: 'yes' }, { encrypted: true }) === true && encryptedOf({ encrypted: 'yes' }, {}) === false)

/* ---- the declaration ---- */

const cfg = await kitConfig()
/* a collection's schema is a zod object wrapped in however many ZodEffects its transforms added, so
   walk down to the object rather than assuming the shape is on the outside */
const objectIn = (s, depth = 0) => {
  if (!s || depth > 8) return null
  if (s._def && s._def.typeName === 'ZodObject') return s
  if (s._def && s._def.schema) return objectIn(s._def.schema, depth + 1)
  if (s._def && s._def.innerType) return objectIn(s._def.innerType, depth + 1)
  return null
}
const field = (name, key) => {
  const c = cfg.collections && cfg.collections[name]
  const o = c && objectIn(c.schema)
  if (!o) return undefined
  const shape = typeof o._def.shape === 'function' ? o._def.shape() : o.shape
  return shape ? shape[key] : undefined
}

ok('the spaces collection declares `encrypted`', !!field('spaces', 'encrypted'))
ok('the channels collection declares `encrypted`', !!field('channels', 'encrypted'))

/* what each side defaults to is the whole of how a space seals its rooms: a SPACE answers false
   when it is silent, so a site that has never heard of this is unencrypted; a CHANNEL answers
   nothing when it is silent, so that encryptedOf can fall through to the space. A default on the
   channel would make every channel say "false" out loud and no space could ever seal anything. */
const sp = field('spaces', 'encrypted'), ch = field('channels', 'encrypted')
const parses = (f, v) => { try { return { ok: true, v: f.parse(v) } } catch { return { ok: false } } }
ok('a space that says nothing is not encrypted', sp && parses(sp, undefined).v === false)
ok('a CHANNEL that says nothing says nothing — it does not default to false',
  ch && parses(ch, undefined).v === undefined,
  'a default here would stop a space sealing the rooms under it')
ok('both take a real boolean', sp && parses(sp, true).v === true && ch && parses(ch, true).v === true)

/* ---- the grammar, both ways ---- */

/*
 * THE SCHEMA IS NOT THE GRAMMAR. velite's schema is what the BROWSER's copy of a channel is built
 * from; `parseChannel` is what the BUILD reads and what the admin writes back. Declaring the field
 * in the first and not the second is how the field existed, validated, and never once reached the
 * compile — which is exactly what happened: the velite schema had `encrypted` while parseChannel
 * whitelisted the fields it carried and that was not one of them, so every channel compiled open.
 */
const chan = (fm) => parseChannel(`---\nname: Lounge\n${fm}---\n\nhello\n`).data
ok('the channel grammar carries a seal', chan('encrypted: true\n').encrypted === true)
ok('…and an explicit refusal of one', chan('encrypted: false\n').encrypted === false)
ok('…and says nothing where the file said nothing', chan('').encrypted === undefined,
  'undefined, not false — false would stop a space sealing the rooms under it')
ok('the space grammar carries a seal', parseSpace('---\nname: Guild\nencrypted: true\n---\n').data.encrypted === true)
ok('…and is open by default', parseSpace('---\nname: Guild\n---\n').data.encrypted === false)

/* and the writer must not quietly drop it: the admin round-trips a record through these two, so a
   field the serialiser forgets is a seal somebody set and the next save took off */
const back = (fm) => parseChannel(serialiseChannel(chan(fm))).data.encrypted
ok('a sealed room survives being written back', back('encrypted: true\n') === true)
ok('an unsealed one survives too', back('encrypted: false\n') === false)
ok('and a room that inherits keeps inheriting', back('') === undefined,
  'written as `encrypted: false` here, the room would be frozen at today\'s answer')
ok('a sealed space survives being written back', parseSpace(serialiseSpace({ name: 'Guild', encrypted: true })).data.encrypted === true)
ok('a space that said nothing grows no line', !/encrypted/.test(serialiseSpace({ name: 'Guild' })))

/* ---- every sealed room, which is what the bots ask ---- */

/*
 * ONE ANSWER FOR THE BUILD AND THE ADMIN. A bot cannot be put in a sealed room — it would have to
 * read the room to answer in it, and nothing on this side can. The build refuses a schedule that
 * points into one and the admin does not offer one; both ask `sealedRooms`, so they cannot come
 * to different conclusions about the same room.
 */
const guild = {
  slug: 'guild', data: { name: 'The Guild', encrypted: true },
  channels: [
    { slug: 'lounge', data: { name: 'Lounge' } },                      /* inherits: sealed */
    { slug: 'open-house', data: { name: 'Open house', encrypted: false } },
  ],
}
const town = {
  slug: 'town', data: { name: 'Town' },
  channels: [
    { slug: 'square', data: { name: 'Square' } },                      /* inherits: open */
    { slug: 'vault', data: { name: 'Vault', encrypted: true } },
  ],
}
const sealed = sealedRooms([guild, town])
ok('a room sealed by its space is in the set', sealed.has('guild/lounge'))
ok('a room let out of a sealed space is not', !sealed.has('guild/open-house'))
ok('a room sealed on its own is in it', sealed.has('town/vault'))
ok('an open room in an open space is not', !sealed.has('town/square'))
ok('and the set is exactly those two', sealed.size === 2, [...sealed].join(' '))
ok('a site with no spaces seals nothing, and so refuses nothing', sealedRooms([]).size === 0 && sealedRooms().size === 0)
/* the shape readSpaces hands over is `{ slug, data, channels: [{ slug, data }] }`; a caller that
   passed channels already flattened should still get an answer rather than a throw */
ok('a channel handed over flat is read too', sealedRooms([{ slug: 'x', data: {}, channels: [{ slug: 'c', encrypted: true }] }]).has('x/c'))

/* ---- and none of it is announced by a toast ---- */

/*
 * NOTHING A SEALED ROOM SAYS IS A TOAST, and this is a check rather than a note because it is the
 * easy thing to get wrong later: a toast is one line of code and a line in a surface is five.
 *
 * A toast is for something that just happened and is over — saved, sent, copied. Every one of
 * these is a STANDING FACT about a room: still true when the person looks again, and a person who
 * missed the toast has no way to ask for it a second time. "Search could not look in two rooms"
 * shown for four seconds and then gone is worse than not saying it at all, because they were
 * looking at the results rather than at the corner of the screen.
 *
 * It reads the ARGUMENTS of each toast call rather than the file, because a page the size of
 * SpacesPage.vue raises toasts for a dozen unrelated things and will always both toast and read
 * these words. What is refused is one of these words going INTO a toast.
 */
{
  const { readFileSync: rf, readdirSync: rd, statSync: stat } = await import('node:fs')
  const { join, relative } = await import('node:path')
  const WORKSPACE = new URL('../../..', import.meta.url).pathname
  const SITE = process.cwd()
  const dirs = [
    join(WORKSPACE, 'packages/movable-types/src'),
    join(WORKSPACE, 'packages/kit/src'),
    join(SITE, 'src'),
  ].filter((d) => { try { return stat(d).isDirectory() } catch { return false } })
  const files = []
  const walk = (d) => {
    for (const e of rd(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (/\.(vue|js|ts)$/.test(e.name)) files.push(f)
    }
  }
  for (const d of dirs) walk(d)

  /* what counts as reading the encryption words, wherever a surface binds them */
  /* `.value` is how a script reaches a computed and a template does not, so both spellings count:
     written without it the check read `EN.room` only, missed `EN.value.room`, and passed a toast
     handed exactly this word — which is how it was found out, by breaking it on purpose */
  const WORD = /us\(['"]spaces['"]\)\s*\.\s*encryption\b|\bEN\.(value\.)?(room|setup|refused)\b|\bencryption\.(value\.)?(room|setup|refused)\b/
  /* every toast call's own arguments, by counting parentheses from the opening one */
  const callsIn = (text) => {
    const out = []
    const re = /\btoast\s*\(/g
    let m
    while ((m = re.exec(text))) {
      let i = m.index + m[0].length, depth = 1
      while (i < text.length && depth > 0) {
        const c = text[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        i++
        if (i - m.index > 2000) break   /* a runaway, not a call */
      }
      out.push(text.slice(m.index, i))
    }
    return out
  }

  const bad = []
  let readers = 0, calls = 0
  for (const f of files) {
    const t = rf(f, 'utf8')
    if (WORD.test(t)) readers++
    for (const c of callsIn(t)) {
      calls++
      if (WORD.test(c)) bad.push(relative(WORKSPACE, f) + ': ' + c.replace(/\s+/g, ' ').slice(0, 90))
    }
  }
  ok('no encryption word is handed to a toast', bad.length === 0,
    bad.join(' | ') + ' — each of these is a standing fact about a room, so it belongs in the surface the person is looking at and must still be there when they look again')

  /* and the check has to be ABLE to fail: an empty answer from patterns that no longer match
     anything is a check passing by accident, which is worse than no check */
  ok('…and both halves of the check still match the code (' + readers + ' surfaces, ' + calls + ' toasts)',
    readers > 0 && calls > 0, 'one of the two patterns has gone stale')
}

/* ---- ONE PLACE KNOWS HOW TO SEAL ---- */

/*
 * The guarantee an encrypted room makes is only as good as the number of places that could break
 * it, so there is exactly one: `src/lib/spaces/crypto.js`. Everything else — the surface, the
 * state, the search, the admin — asks it. This check reads the files rather than trusting the
 * reading of them, because a second place that learned to seal would not fail any other test:
 * it would work, and it would be wrong in a way nobody could see from the outside.
 */
{
  const { readFileSync: rf, readdirSync: rd, statSync: st } = await import('node:fs')
  const { join, relative } = await import('node:path')
  const ROOT = new URL('../../..', import.meta.url).pathname

  const walk = (dir, out = []) => {
    let entries = []
    try { entries = rd(dir) } catch { return out }
    for (const e of entries) {
      if (e === 'node_modules' || e === 'dist' || e === '.velite' || e.startsWith('.')) continue
      const f = join(dir, e)
      if (st(f).isDirectory()) walk(f, out)
      else if (/\.(vue|js|mjs|ts)$/.test(e)) out.push(f)
    }
    return out
  }
  const files = [
    ...walk(join(ROOT, 'packages/kit/src')),
    ...walk(join(ROOT, 'packages/movable-types/src')),
  ]
  const THE_ONE = join(ROOT, 'packages/kit/src/lib/spaces/crypto.js')
  ok('there is a module whose job this is', files.includes(THE_ONE))

  /* the library itself */
  const LIB = /matrix-sdk-crypto-wasm|OlmMachine/
  const libIn = files.filter((f) => f !== THE_ONE && LIB.test(rf(f, 'utf8')))
  ok('nothing but that module reaches the crypto library', libIn.length === 0,
    libIn.map((f) => relative(ROOT, f)).join(', '))
  ok('…and that module does reach it (so the check is not passing by accident)', LIB.test(rf(THE_ONE, 'utf8')))

  /* and the tables only it may write: a device, its one-time keys, its queue, the backup */
  const TABLES = /space_devices|space_one_time_keys|space_to_device|space_key_backups|space_claim_key|space_send_to_device/
  const tableIn = files.filter((f) => f !== THE_ONE && TABLES.test(rf(f, 'utf8')))
  ok('nothing but that module touches a key table or a key door', tableIn.length === 0,
    tableIn.map((f) => relative(ROOT, f)).join(', '))

  /* api.js is the one caller, and it holds a cipher without ever making one */
  const API = rf(join(ROOT, 'packages/kit/src/lib/spaces/api.js'), 'utf8')
  ok('api.js reaches the sealing through that module and no other way', /import\('\.\/crypto\.js'\)/.test(API))
  ok('…and it is imported on demand, so an open room is what loads the wasm', !/^import .* from '\.\/crypto\.js'/m.test(API))
  ok('…and api.js both seals and opens through it', /m\.seal\(/.test(API) && /m\.open\(/.test(API))
  ok('…and never sends the words when the sealing fails', /row\.cipher = await m\.seal\(/.test(API) && /row\.body = null/.test(API))
}

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
