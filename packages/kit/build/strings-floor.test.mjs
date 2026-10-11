/*
 * THE THEME'S WORDS ARE THE FLOOR. A string the compiled collection does not carry — a key the
 * theme gained since a site last built, a scope a site overrode and left a field out of — must
 * still come back as the theme's own word, because `undefined` on a label is a blank, and a blank
 * on a button whose label is the whole control is a control nobody can see or press.
 */
let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
console.log('\nTHE THEME\'S WORDS ARE THE FLOOR\n')

/* the merge, lifted exactly as strings.js defines it */
const under = (over, base) => {
  if (!base) return over || {}
  if (!over) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? under(v, base[k]) : v
  }
  return out
}
const theme = { avatar: { main: { design: 'Design a face', upload: 'Upload a picture' } } }
const site = { avatar: { main: { upload: 'Add a photo' } } }

const got = under(site, theme)
ok('the site wins where it has said anything', got.avatar.main.upload === 'Add a photo')
ok('and the theme fills what it has not', got.avatar.main.design === 'Design a face')
ok('a scope the site does not have at all is the theme\'s whole', under(undefined, theme).avatar.main.design === 'Design a face')
ok('a scope the theme does not have is the site\'s whole', under(site, undefined).avatar.main.upload === 'Add a photo')
ok('neither is an empty object rather than a throw', JSON.stringify(under(undefined, undefined)) === '{}')

/* and the real thing: strings.js must read a default layer at all */
const { readFileSync } = await import('node:fs')
const src = readFileSync(new URL('../src/lib/strings.js', import.meta.url), 'utf8')
ok('strings.js reads the theme\'s defaults', /from '#site\/strings-default'/.test(src))
ok('…and merges them UNDER the compiled collection', /under\(BY\[scope\]/.test(src),
  'the other way round would let a stale default beat what the site actually says')

console.log(fail ? `\nstrings floor: ${pass} passed, ${fail} FAILED\n` : `\nstrings floor: all ${pass} checks passed\n`)
process.exit(fail ? 1 : 0)
