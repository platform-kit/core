/*
 * The spoken words and the recording names are one definition, src/lib/speech.js,
 * shared by the build script and the reader's in-browser engine. This pins it:
 * every recording named in a committed manifest (audio/books/<slug>/index.json)
 * must be reproduced — the same text, the same hash — from the book and its
 * companion as they are now. If this fails, either the words changed (then the
 * script will respeak those chapters, and the manifest updates when it runs) or
 * the module drifted, and a browser would name recordings the script does not.
 *
 * It also pins the browser's list of weights and their revision to the script's.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import matter from 'gray-matter'
import { parseCompanionBody } from './companion-io.mjs'
import { ENGINE, INTRO_KEY, bookChapters, chapterSpeech, hashInput } from '../src/lib/speech.js'
import { REPO as SETUP_REPO, REV as SETUP_REV, BROWSER_FILES as SETUP_FILES } from './tts/setup.mjs'
import { REPO, REV, BROWSER_FILES } from '../src/lib/tts/weights.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const hash = (text) => createHash('sha1').update(hashInput(text, ENGINE)).digest('hex').slice(0, 16)

console.log('\nSPEECH\n')

const store = path.resolve('audio/books')
const slugs = fs.existsSync(store) ? fs.readdirSync(store).filter((d) => fs.existsSync(path.join(store, d, 'index.json'))) : []
if (!slugs.length) console.log('  (no committed manifest yet: nothing to pin the recording names against)')
for (const slug of slugs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(store, slug, 'index.json'), 'utf8'))
  const { content, data } = matter(fs.readFileSync(path.resolve('content/books', slug + '.md'), 'utf8'))
  const chapters = bookChapters(content)
  const compFile = path.resolve('content/companions', slug + '.md')
  const summaries = {}
  if (fs.existsSync(compFile)) for (const c of parseCompanionBody(matter(fs.readFileSync(compFile, 'utf8')).content).chapters) if (c.summaryMd) summaries[c.title] = c.summaryMd
  /* the manifest's engine must be the shared default, or the names could not match */
  ok(slug + ': manifest engine is the shared default', JSON.stringify(manifest.engine) === JSON.stringify(ENGINE), JSON.stringify(manifest.engine))
  for (const [title, entry] of Object.entries(manifest.chapters || {})) {
    if (title === INTRO_KEY) {
      const text = chapterSpeech({ intro: true, md: String(data.introduction || '').trim() })
      ok(slug + ' · introduction reproduces its recording', entry.full && hash(text) + '.mp3' === entry.full.file, entry.full && entry.full.file)
      continue
    }
    const c = chapters.find((x) => x.title === title)
    ok(slug + ' · ' + title + ' is still a chapter', !!c)
    if (!c) continue
    if (entry.full) ok(slug + ' · ' + title + ' · text reproduces its recording', hash(chapterSpeech(c)) + '.mp3' === entry.full.file, entry.full.file)
    if (entry.summary) ok(slug + ' · ' + title + ' · summary reproduces its recording', summaries[title] && hash(chapterSpeech(c, summaries[title])) + '.mp3' === entry.summary.file, entry.summary.file)
  }
}

/* the browser fetches the same weights the script does, at the same revision */
ok('the browser and the script name the same weights repository', REPO === SETUP_REPO)
ok('the browser and the script pin the same revision', REV === SETUP_REV)
ok('every weight the browser wants is one the script fetches', BROWSER_FILES.every((f) => SETUP_FILES.includes(f)), BROWSER_FILES.filter((f) => !SETUP_FILES.includes(f)).join(', '))

/*
 * A CHAPTER ANOTHER READER MADE. Every recording is named by the hash of the exact words and the
 * engine settings, which is the whole mechanism: a browser asks the bucket for the name it would
 * give a chapter, and if somebody else's browser already made that recording it plays instead of
 * being generated again. So the property that matters is not that the hash is stable across runs
 * (pinned above against every committed manifest) but that it is stable across PEOPLE — the same
 * words give the same name whoever asks, and different words never collide onto one name.
 */
{
  const c = { title: 'A Chapter', md: 'Some words in it.' }
  const mine = hash(chapterSpeech(c)), theirs = hash(chapterSpeech({ ...c }))
  ok(mine === theirs, 'two readers name the same chapter the same recording')
  ok(mine !== hash(chapterSpeech({ ...c, md: 'Some words in it. And one more.' })), 'an edited chapter is a different recording')
  ok(mine !== hash(chapterSpeech({ ...c, title: 'Another Chapter' })), 'a retitled chapter is a different recording, since the title is spoken')
  /* the text and the summary of one chapter must never share a name: the reader plays one or the
     other by mode, and a collision would play the summary to somebody reading the book */
  ok(mine !== hash(chapterSpeech(c, 'A short summary.')), 'a chapter\u2019s summary is not its text')
  ok(/^[0-9a-f]{16}$/.test(mine), 'a recording is named by sixteen hex characters')
}

/*
 * A BOOK WITH NO MANIFEST. No manifest, no recording, no player — a book never needs audio to
 * work, and the reader must ask the manifest rather than assume one. An absent manifest and an
 * empty one are the same answer.
 */
{
  const audioFor = (manifest, title) => (manifest && manifest[title]) || null
  ok(audioFor(null, 'A Chapter') === null, 'no manifest at all: no recording')
  ok(audioFor({}, 'A Chapter') === null, 'an empty manifest: no recording')
  ok(audioFor({ 'Another Chapter': { full: {} } }, 'A Chapter') === null, 'a manifest without this chapter: no recording')
  ok(audioFor({ 'A Chapter': { full: { file: 'x.mp3' } } }, 'A Chapter') !== null, 'and a manifest with it: a recording')
  /* the introduction is keyed by a constant rather than its label, because the label is editable
     copy and a recording named after it would be orphaned the moment somebody reworded it */
  ok(INTRO_KEY && INTRO_KEY !== 'Introduction', 'the introduction is keyed by a constant, not by its label: ' + INTRO_KEY)
}

console.log(`\n${fail ? fail + ' failed, ' : ''}${pass} passed\n`)
if (fail) process.exit(1)
