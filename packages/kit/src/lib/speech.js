/*
 * The words a book is read aloud with, and the name a recording gets — the one
 * definition shared by the build script (build/tts.mjs, on the machine) and the
 * reader (src/lib/tts/, in the browser). Pure: no imports, no environment, no
 * side effects, so both can load it and both produce byte-identical text for a
 * chapter and the same hash for it. A recording made in the browser therefore
 * has the same name the script would give it, and a chapter the script later
 * records replaces the browser's copy under the same key.
 *
 * Nothing in here may read a setting or a file: the engine's defaults are
 * constants, and the script layers its environment overrides on top of them.
 */

/* the engine and its settings: what a recording's name is made of */
export const ENGINE = Object.freeze({ name: 'supertonic-3', voice: 'M5', steps: 8, speed: 1.0, gap: 0.45 })

/* the key of the introduction's recording: the page's label is editable copy,
   so the key is fixed and never a word a reader sees */
export const INTRO_KEY = '__intro__'

/* ---- numbers, the way they are said ---- */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
export function numberWords(n) {
  n = Math.floor(Math.abs(n))
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + numberWords(n % 100) : '')
  if (n < 1000000) return numberWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? (n % 1000 < 100 ? ' and ' : ' ') + numberWords(n % 1000) : '')
  return String(n)
}
/* a four-digit year reads in pairs: 1926 is nineteen twenty-six, 2003 two thousand and three */
export function yearWords(n) {
  const hi = Math.floor(n / 100), lo = n % 100
  if (hi % 10 === 0) return numberWords(n)
  return numberWords(hi) + ' ' + (lo === 0 ? 'hundred' : lo < 10 ? 'oh-' + ONES[lo] : numberWords(lo))
}
const ROMAN = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 }
export function romanValue(s) {
  if (!/^[MDCLXVI]+$/.test(s)) return null
  let n = 0
  for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]], w = ROMAN[s[i + 1]] || 0; n += v < w ? -v : v }
  return n
}
/* a chapter title the way it is said: a Roman numeral is its number */
export function spokenTitle(title) {
  const t = String(title || '').trim()
  const n = romanValue(t)
  return n ? numberWords(n).replace(/^./, (c) => c.toUpperCase()) : t
}

/* ---- markdown, the way it is read ----
   Markdown and HTML become plain speech, and the things a voice stumbles on are
   said the way a reader would say them: a heading is its own sentence with a
   pause after it; words set in capitals for emphasis are read as words, not
   spelled or shouted; a double hyphen is the pause it stands for; a year is
   "nineteen twenty-six" and any other whole number its words. The engine then
   does its own light normalising (quotes, dashes, brackets) and cuts at sentence
   ends. */
export function speakable(md) {
  let s = String(md || '')
    .replace(/==(?=\S)([\s\S]*?\S)==(?:\{[a-z]+\})?/g, '$1')
    /* a heading is its own sentence, with a pause after it */
    .replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, (_, h) => '\n\n' + h.replace(/[.!?:;,]+$/, '') + '.\n\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\\$/gm, '')
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“').replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')
    /* a dash in prose — double hyphen, em or en dash — is a pause, not a hyphenated
       word; where it follows other punctuation, that punctuation is the pause */
    .replace(/\s*(?:--+|—|–)\s*/g, ', ')
    .replace(/([;:,.!?])\s*,\s*/g, '$1 ')
    /* words set in capitals are read as words ("I" and letter-dot initials are single letters, untouched) */
    .replace(/\b[A-Z][A-Z’'-]+\b/g, (w) => w.toLowerCase())
    /* a scripture-style reference: chapter colon verse becomes "chapter, verse" */
    .replace(/\b(\d+):(\d+)\b/g, '$1, $2')
    /* whole numbers in words; years in pairs; digits with commas first */
    .replace(/\b\d{1,3}(,\d{3})+\b/g, (m) => numberWords(Number(m.replace(/,/g, ''))))
    .replace(/\b(1[5-9]\d\d|20\d\d)\b/g, (m) => yearWords(Number(m)))
    .replace(/\b\d+\b/g, (m) => (m.length > 6 ? m : numberWords(Number(m))))
    .replace(/[ \t]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  /* a sentence that a lowercased run left uncapitalised reads the same; the only
     thing the engine minds is a capital where a sentence starts, so restore it */
  s = s.replace(/(^|[.!?]\s+|\n\n)([a-z])/g, (_, a, c) => a + c.toUpperCase())
  return s
}

/* ---- a book's pages, and the words each is read with ---- */
/* the chapters of a book body: split at its `# ` headings, the same split the
   reader makes and the script makes, so the two never disagree on what a
   chapter is */
export function bookChapters(body) {
  return String(body || '').split(/^(?=# )/m).filter((s) => s.trim()).map((part) => {
    const m = /^# (.*)$/m.exec(part)
    return { title: m ? m[1].trim() : 'Untitled', md: part.replace(/^# .*$/m, '').trim() }
  })
}
/* what a page is read with: the introduction as itself; a chapter as its
   spoken title, a pause, then its text — or its summary when one is given.
   Empty when there is nothing to say. */
export function chapterSpeech(chapter, summaryMd) {
  if (!chapter) return ''
  if (chapter.intro) return speakable(chapter.md)
  const body = summaryMd != null ? summaryMd : chapter.md
  if (!String(body || '').trim()) return ''
  return speakable(spokenTitle(chapter.title) + '.\n\n' + body)
}

/* the bytes a recording's name is the hash of: the engine, its voice and
   settings, and the exact words. Each side hashes this itself (sha1, 16 hex):
   node with createHash, the browser with crypto.subtle. */
export function hashInput(text, engine = ENGINE) {
  return [engine.name, engine.voice, engine.steps, engine.speed, engine.gap, text].join('\n')
}
