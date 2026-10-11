/*
 * A SAVE KEEPS WHAT THE FILE SAID ABOUT ITSELF — and changes nothing else.
 *
 * The admin round-trips front matter through a parser, and comments are not data, so the first save
 * on a self-documenting file used to strip every line of reasoning in it. That is fifteen files in
 * this repository alone — the comment policy, the traits, the spaces, the bots, every book's print
 * block — and the loss was silent and permanent outside git.
 *
 * The risk in fixing it is the opposite fault: a second serialiser with its own formatting habits,
 * rewriting every file the first time anybody touches it. So the two halves are pinned together
 * here — what must survive a save, and what must not move because of one.
 */
import assert from 'node:assert/strict'
import matter from 'gray-matter'
import { keepComments, same } from './models/yaml-keep.mjs'
import { frontmatter } from './models/util.mjs'

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL ' + name + '\n    ' + String(e.message || e).split('\n').slice(0, 4).join('\n    ')) } }
/* an async check needs its own runner: handed to the sync one above, a rejected promise is never
   caught and the check passes by never having been made */
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL ' + name + '\n    ' + String(e.message || e).split('\n').slice(0, 4).join('\n    ')) } }

const FILE = `---
# THE SITE'S COMMENT POLICY. Every record inherits what is here.
allow: off              # off · everyone · members · hosts
approval: none          # whether what is said waits for a person
votes: false            # opt-in everywhere

# Words that HOLD a comment for a moderator to look at.
flagged: []
depth: 3
nested:
  # how far in
  inner: 1
  other: two
---

the body
`
const data = (over = {}) => ({ allow: 'off', approval: 'none', votes: false, flagged: [], depth: 3, nested: { inner: 1, other: 'two' }, ...over })
const fm = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]

console.log('\nA SAVE KEEPS THE FILE\'S OWN WORDS\n')

/* ---- what must survive ---- */
t('a value changes and every comment stays', () => {
  const out = keepComments(FILE, data({ allow: 'everyone' }))
  assert.match(out, /^# THE SITE'S COMMENT POLICY/, 'the block comment at the top')
  assert.match(out, /allow: everyone\s+# off · everyone · members · hosts/, 'the end-of-line comment moved to the new value')
  assert.match(out, /# Words that HOLD a comment/, 'a comment between groups')
  assert.match(out, /# how far in/, 'a comment inside a nested block')
})

t('the key order is the file\'s, not the object\'s', () => {
  const out = keepComments(FILE, { depth: 3, allow: 'off', approval: 'none', votes: false, flagged: [], nested: { inner: 1, other: 'two' } })
  assert.deepEqual(out.split('\n').filter((l) => /^\w+:/.test(l)).map((l) => l.split(':')[0]),
    ['allow', 'approval', 'votes', 'flagged', 'depth', 'nested'])
})

t('a nested block is merged, not replaced, so its own comments live', () => {
  const out = keepComments(FILE, data({ nested: { inner: 9, other: 'two' } }))
  assert.match(out, /# how far in/)
  assert.match(out, /inner: 9/)
})

t('a key that goes takes its own comments with it', () => {
  const out = keepComments(FILE, (() => { const d = data(); delete d.flagged; return d })())
  assert.ok(!/flagged/.test(out), 'the key')
  assert.ok(!/# Words that HOLD/.test(out), 'and the lines that described it')
  assert.match(out, /# THE SITE'S COMMENT POLICY/, 'but nothing else')
})

t('a key that arrives is written, with no comment invented for it', () => {
  const out = keepComments(FILE, data({ collapse: 5 }))
  assert.match(out, /^collapse: 5$/m)
})

t('what it writes still parses back to what was asked for', () => {
  const want = data({ allow: 'everyone', nested: { inner: 9, other: 'two' } })
  assert.deepEqual(matter('---\n' + keepComments(FILE, want) + '\n---\n').data, want)
})

/* ---- what must NOT move ---- */
t('a save that changes nothing changes nothing', () => {
  assert.equal(keepComments(FILE, data()), fm(FILE))
})

t('a no-op keeps flow-map spacing exactly', () => {
  const src = '---\n# the list stays as it was authored\noptions: [{ value: linen, label: Linen }]\n---\nbody\n'
  assert.equal(keepComments(src, { options: [{ value: 'linen', label: 'Linen' }] }), fm(src))
})

t('a file with no comments takes the old path, byte for byte', () => {
  const plain = '---\na: 1\nb:\n  - x\n---\n\nbody\n'
  assert.equal(keepComments(plain, { a: 1, b: ['x'] }), null, 'nothing to keep, so it declines')
  assert.equal(frontmatter.serialise({ data: { a: 1, b: ['x'] }, content: 'body\n' }, { current: plain }),
    matter.stringify('\nbody\n', { a: 1, b: ['x'] }, { lineWidth: -1 }), 'and writes exactly as it always did')
})

t('a new record has nothing to keep and is written as before', () => {
  assert.equal(frontmatter.serialise({ data: { a: 1 }, content: 'b\n' }, {}),
    matter.stringify('\nb\n', { a: 1 }, { lineWidth: -1 }))
})

t('the whole file keeps its framing and its body', () => {
  const out = frontmatter.serialise({ data: data({ allow: 'everyone' }), content: 'the body\n' }, { current: FILE })
  assert.match(out, /^---\n/)
  assert.match(out, /\n---\n\nthe body\n$/)
  assert.equal(matter(out).data.allow, 'everyone')
})

/* ---- the awkward inputs ---- */
t('a document it cannot read is declined rather than mangled', () => {
  assert.equal(keepComments('---\n# c\na: [1, 2\n---\nbody', { a: [1, 2] }), null)
  assert.equal(keepComments('no front matter at all', { a: 1 }), null)
  assert.equal(keepComments('', { a: 1 }), null)
})

t('a date is not re-expanded into a timestamp', () => {
  const src = '---\n# when\ndate: 2026-09-28\nx: 1\n---\nbody\n'
  assert.match(keepComments(src, { date: '2026-09-28', x: 2 }), /date: 2026-09-28/)
})

t('a long line is never folded', () => {
  const long = 'https://example.com/' + 'a'.repeat(200)
  const src = '---\n# u\nurl: short\n---\nbody\n'
  assert.match(keepComments(src, { url: long }), new RegExp('url: ' + long.slice(0, 40)))
  assert.ok(!keepComments(src, { url: long }).includes('\n  '), 'not folded onto a second line')
})

t('a value whose type changes is replaced whole', () => {
  const src = '---\n# c\na: one\n---\nbody\n'
  assert.match(keepComments(src, { a: ['one', 'two'] }), /a:\n\s+- one\n\s+- two/)
})

t('same() is the guard that decides what to leave alone', () => {
  assert.ok(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }))
  assert.ok(!same({ a: 1 }, { a: 1, b: 2 }))
  assert.ok(!same([1, 2], [2, 1]))
  assert.ok(same(new Date('2026-09-28T00:00:00Z'), '2026-09-28'), 'a parsed date against the string the admin holds')
})

/* ---- the files this repository actually has ---- */
await ta('every content file that carries comments survives a no-op save unchanged', async () => {
  /* the real ones, not a fixture: a rule that holds on an example and not on the repository is
     not a rule. A save that changes nothing must be a diff of nothing, whatever the file. */
  const { readFileSync, existsSync } = await import('node:fs')
  const { execSync } = await import('node:child_process')
  const { registry } = await import('./models/index.mjs')
  const { loadSite } = await import('./site.mjs')
  /*
   * ONLY THE FILES THIS GRAMMAR ACTUALLY WRITES, and the list is derived from the registry rather
   * than typed here. A record with a grammar of its own is not in scope and must not be: the quiz
   * writer keeps a topic's `spec` block exactly as it was typed, hand-wrapped lines and all, and
   * the strings editor keeps the front matter verbatim — holding either to this rule would be
   * asserting something about a writer that is not this one.
   */
  const models = await registry(process.cwd(), { site: await loadSite(process.cwd()) })
  /* a SINGLE record owns one path and not a prefix: the tag vocabulary lives at content/tags.md,
     and reading its dir as a prefix hands it every file on the site */
  const owns = models.filter((m) => m.grammar === frontmatter && m.dir)
    .map((m) => (m.single ? { one: m.dir + '/' + m.single + '.md' } : { under: m.dir + '/' }))
  const files = execSync("git ls-files 'content/**/*.md' 'content/*.md'", { encoding: 'utf8' }).trim().split('\n')
  const mine = files.filter((f) => owns.some((o) => (o.one ? f === o.one : f.startsWith(o.under))))
  const withComments = mine.filter((f) => existsSync(f) && /^---\r?\n[\s\S]*?^\s*#/m.test(readFileSync(f, 'utf8')))
  assert.ok(withComments.length > 5, 'there are self-documenting files to protect: ' + withComments.length + ' of ' + mine.length)
  for (const f of withComments) {
    const text = readFileSync(f, 'utf8')
    const parsed = frontmatter.parse(text)
    const out = keepComments(text, parsed.data)
    if (out == null) continue   /* no front-matter comments after all (a # inside the body) */
    assert.equal(out, fm(text), f + ' changed on a save that changed nothing')
  }
  console.log('  (' + withComments.length + ' self-documenting files this grammar owns, each unchanged by a no-op save)')
})

/* ---- and the same in every shape the site ships in ---- */
await ta('a save keeps the comments wherever the content lives', async () => {
  /*
   * The grammar only ever sees TEXT, and where that text came from is the store's business: a file
   * in a checkout, a row of public.content where the content lives in rows. So the check is that a
   * real save through the real pipe keeps them with NO FILESYSTEM UNDER IT AT ALL — the store here
   * is a map, which is what a row looks like from the grammar's side. If the write path ever stops
   * handing the current text to the serialiser, this is what notices, in the shape that has no
   * file to fall back on.
   *
   * The static shape has no backend, no admin and no save, so there is nothing here to answer for.
   */
  const { write, byKey, registry } = await import('./models/index.mjs')
  const { loadSite } = await import('./site.mjs')
  const models = await registry(process.cwd(), { site: await loadSite(process.cwd()) })
  const model = byKey(models, 'tags')
  assert.ok(model && model.grammar === frontmatter, 'the tag vocabulary is written by this grammar')

  const PATH = 'content/tags.md'
  const rows = new Map([[PATH, `---
# WHAT THIS SITE WRITES ABOUT. The list a writer picks from.
free: false             # on, a writer may type one and it joins this list
tags:
  - meditation
---

what these are for
`]])
  const store = {
    kind: 'rows',
    read: async (p) => (rows.has(p) ? rows.get(p) : null),
    write: async (p, text) => { rows.set(p, text) },
    exists: async (p) => rows.has(p),
    remove: async (p) => { rows.delete(p) },
    list: async () => [...rows.keys()],
    dirs: async () => [],
  }
  await write(model, 'tags', { data: { free: false, tags: ['meditation', 'astrology'] }, content: 'what these are for\n' }, process.cwd(), { store })
  const out = rows.get(PATH)
  assert.match(out, /# WHAT THIS SITE WRITES ABOUT/, 'the block comment survived a save over rows')
  assert.match(out, /free: false\s+# on, a writer may type one/, 'and the end-of-line comment')
  assert.match(out, /- astrology/, 'and the save actually happened')
  assert.equal(matter(out).data.free, false)
})

console.log(`\n${n - bad} passed, ${bad} failed\n`)
process.exit(bad ? 1 : 0)
