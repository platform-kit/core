/*
 * ONE PERSON, ONE FACE — the rule that a designed face follows its person to every surface.
 *
 * A face is drawn from three things: the seed, the style, and the OPTIONS somebody chose part by
 * part. Every read that hands a person to a surface must carry all three, and every caller that
 * draws a person must pass the record rather than a name. Both halves were broken at once, which
 * is why this check reads the SQL and the components rather than trusting either.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const KIT = new URL('../', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }

console.log('\nONE PERSON, ONE FACE\n')

/* 1 · every person-shaped read carries the options */
{
  const dir = join(KIT, 'supabase', 'schemas')
  const missing = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const t = readFileSync(join(dir, f), 'utf8')
    /* a read that hands out a STYLE is handing out a drawn face, and must hand out its parts too.
       The window is the object being built around it, either side: a few reads name the parts
       before the style and a few after, and both are the same answer. */
    for (const m of t.matchAll(/'avatar_style'/g)) {
      const around = t.slice(Math.max(0, m.index - 1200), m.index + 1200)
      if (!/'avatar_options'/.test(around)) {
        missing.push(f + ' near line ' + (t.slice(0, m.index).split('\n').length))
      }
    }
  }
  ok('every read that hands out a drawn face hands out the parts it was drawn with',
    missing.length === 0, missing.join(' | '))
}

/* 2 · and the seed resolves the same way wherever it is read */
{
  const t = readFileSync(join(KIT, 'src', 'lib', 'avatar.js'), 'utf8')
  ok('seedOf reads the resolved seed as well as the chosen one', /person\.avatar_seed \|\| person\.seed/.test(t),
    'my_profile calls it `seed`; reading only avatar_seed there falls through to the id and draws a different face')
}

/* 3 · nothing draws a person from their NAME */
{
  const theme = join(KIT, 'theme', 'src')
  const walk = (d, out = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f, out)
      else if (e.name.endsWith('.vue')) out.push(f)
    }
    return out
  }
  const bad = []
  for (const f of walk(theme)) {
    const t = readFileSync(f, 'utf8')
    for (const m of t.matchAll(/<SpaceAvatar\b[^>]*>/g)) {
      const tag = m[0]
      /* a caller that names a person MUST pass the record; one with only a label (a guest, "You")
         passes a name on purpose and is drawn from it, which is honest */
      const named = /:name="my/.test(tag)
      if (named && !/:person=/.test(tag)) bad.push(f.split('/src/')[1] + ': ' + tag.replace(/\s+/g, ' ').slice(0, 70))
    }
  }
  ok('nothing draws the reader\'s own face out of their display name', bad.length === 0,
    bad.join(' | ') + ' — a face made from "Member Person" changes the day they rename themselves, and is not the face they designed')
}

console.log(fail ? `\nfaces: ${pass} passed, ${fail} FAILED\n` : `\nfaces: all ${pass} checks passed\n`)
process.exit(fail ? 1 : 0)
