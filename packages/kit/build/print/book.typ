// The printed book — the one template every hardcover is set with. A 6×9 casewrap:
// the site's own faces (Bitter for the text, Fraunces for display, Plex Mono for the
// small labels), running heads, chapter openers with room to breathe, the book's
// introduction ahead of chapter one, and after each chapter its companion — the
// summary in brief and the key insights — set apart on a tinted ground. A marked
// line (the site's wavy underline) is printed with a fine rule beneath it in the
// element's colour, and every marked line is listed at the back with its page.
// Bump VERSION when anything here changes: every edition is re-rendered from it.

#let VERSION = "7"

// the jacket's mark and ruled eyebrow, so the title page can place them as the front does
#import "cover.typ": mark as cover-mark, ruled, ornament

#let TRIMS = (
  "6x9": (width: 6in, height: 9in),
  "5x8": (width: 5in, height: 8in),
)

// the element colours, as the site paints its marks (BookReader.vue)
#let COLOURS = (
  sun: rgb("#c9931f"), ember: rgb("#d9433d"), sky: rgb("#2f7fb8"), leaf: rgb("#3a8f5c"), ocean: rgb("#2b6f8f"),
)
#let INK = rgb("#1b1a17")
#let INK2 = rgb("#4a4741")
#let INK3 = rgb("#7a766d")
#let WASH = rgb("#f4f1ea")
#let HAIR = rgb("#dcd7cc")

// a marked line: a highlight — one pale yellow for every mark, whatever its element, as a
// highlighter would leave it (opaque, so a black-and-white press gives a light wash) — with
// softly rounded ends, wrapping with the line; and a label so the back matter can find its page.
// The element's colour is kept for the dot beside the line in the list at the back.
#let HIGHLIGHT = rgb("#fbeeb6")
// the mark's metadata says its colour and the sheet it fell on (the build reads the pages back
// to choose what to photograph)
#let mark(colour, n, body) = {
  [#highlight(fill: HIGHLIGHT, radius: 2.5pt, extent: 1.2pt, top-edge: "ascender", bottom-edge: "descender", body)#context [#metadata((colour: colour, page: here().page()))#label("mark-" + str(n))]]
}
// where a chapter (or the note, the introduction, a part) opens: its title and its sheet, for the
// build to read back — beside the <chapter> mark the running head reads
#let at-sheet(kind, title) = context [#metadata((kind: kind, title: title, page: here().page()))<where>]

// a break to the next right-hand page. The page the content ended on is marked; a verso the
// break skips is the even page right after such a mark, and the running head and the number
// stay off it (a page break cannot be decided inside `context`, so the mark is how the header
// knows)
#let recto() = { [#metadata("end")<end>]; pagebreak(to: "odd", weak: true) }
#let blank-page(pg, ends, openers) = calc.even(pg) and ends.contains(pg - 1) and not ends.contains(pg) and openers.contains(pg + 1)

#let eyebrow(body) = text(font: "IBM Plex Mono", size: 7.5pt, tracking: 0.14em, fill: INK3, upper(body))

#let book(
  title: "", author: "", year: none, description: "", insight: "",
  trim: "6x9", introduction: none, note: false, chapters: (), parts: none, marks: 0, words: (:), body,
) = {
  let W(k, d) = words.at(k, default: d)
  let t = TRIMS.at(trim)
  set document(title: title, author: author)
  // one page rule for the whole book — the front matter's pages set their own (none), and a
  // page rule set after content would open a page of its own; the running head and the number
  // are the body's, in physical pages, since the counter restarts at the body and the sheets do not
  set page(
    width: t.width, height: t.height,
    margin: (inside: 0.9in, outside: 0.7in, top: 0.8in, bottom: 0.8in),
    numbering: "1",
    header: context {
      let pg = here().page()
      // an opener carries no running head, and a blank verso nothing at all
      let openers = query(heading.where(level: 1)).map(h => h.location().page())
      let ends = query(<end>).map(e => e.location().page())
      if openers.contains(pg) or blank-page(pg, ends, openers) { none } else {
        set text(font: "IBM Plex Mono", size: 7pt, tracking: 0.12em, fill: INK3)
        let heads = query(selector(<chapter>).before(here()))
        let ch = if heads.len() > 0 { heads.last().value } else { "" }
        if calc.odd(counter(page).get().first()) { align(right, upper(ch)) } else { align(left, upper(title)) }
      }
    },
    footer: context {
      let pg = here().page()
      let ends = query(<end>).map(e => e.location().page())
      let openers = query(heading.where(level: 1)).map(h => h.location().page())
      if blank-page(pg, ends, openers) { none } else { align(center, text(font: "IBM Plex Mono", size: 8pt, fill: INK3, counter(page).display())) }
    },
  )
  set text(font: "Bitter", size: 10.5pt, fill: INK, lang: "en", hyphenate: true)
  set par(justify: true, leading: 0.68em, first-line-indent: 1.4em, spacing: 0.68em)
  show heading.where(level: 1): set text(font: "Fraunces", size: 24pt, weight: 600, fill: INK)
  show heading.where(level: 2): set text(font: "Fraunces", size: 13pt, weight: 600, fill: INK)
  show heading: set block(above: 0em, below: 0em)
  show heading: set text(hyphenate: false)
  show heading: set par(justify: false)

  // ---- front matter: a blank first leaf (both sides), the title on a recto, the colophon on
  // its verso, the contents on a recto — and the body on the recto after, numbered from 1 ----
  page(header: none, footer: none)[]
  page(header: none, footer: none)[]
  // the title page: title and author, and at the foot the mark with the edition's eyebrow
  // between rules beneath it — placed as the jacket's front places them, in ink
  page(header: none, footer: none, margin: (x: 0.75in, top: 0.8in, bottom: 0.95in))[
    #v(1.2in)
    #set par(justify: false)
    #set text(hyphenate: false)
    #align(center)[
      #text(font: "Fraunces", size: if title.len() <= 14 { 30pt } else if title.len() <= 24 { 26pt } else { 22pt }, weight: 600, title)
      #v(0.35in)
      #text(font: "Bitter", size: 12pt, fill: INK2, author)
    ]
    #place(bottom + center, block(width: 100%)[
      #set align(center)
      #set par(spacing: 0pt)
      #cover-mark(size: 26pt, stroke-colour: INK2)
      #v(0.3in)
      #ruled(text(font: "IBM Plex Mono", size: 7.5pt, tracking: 0.2em, fill: INK3, upper(W("edition", "The modern edition"))), INK3)
    ])
  ]
  page(header: none, footer: none)[
    #v(1fr)
    #set text(size: 8pt, fill: INK3)
    #set par(first-line-indent: 0em, justify: false)
    #title #if year != none [ · #W("first-published", "first published") #year] \
    #W("colophon", "This edition set and published by the publisher.") \
    #W("site", "")
  ]
  page(header: none, footer: none)[
    #eyebrow[#W("contents", "Contents")]
    #v(0.25in)
    // the rows of a two-part book (every chapter twice) sit closer, so the list holds one page
    #let rows = if parts == none { chapters.len() } else { parts.map(p => p.chapters.len()).sum(default: 0) + parts.len() }
    #let tight = rows > 30
    #set par(first-line-indent: 0em, justify: false, leading: if tight { 0.42em } else { 0.6em }, spacing: if tight { 0.42em } else { 0.6em })
    // a row: the title, a leader, the page its label is on — a long title wraps under itself
    #let pg(lab) = context { let l = query(lab); if l.len() > 0 { counter(page).at(l.first().location()).first() } }
    #let row(body, lab, indent: 0em, size: 10.5pt, weight: 400, fill: INK, eye: none) = block(width: 100%, inset: (left: indent), par(hanging-indent: 1em)[#if eye != none [#eyebrow[#eye]#h(0.6em)]#text(font: "Fraunces", size: size, weight: weight, fill: fill, body)#sym.space.nobreak#box(width: 1fr, inset: (x: 0.3em), repeat(text(size: 8pt)[.]))#sym.space.nobreak#text(size: 9.5pt, pg(lab))])
    #let ch-size = if tight { 9.6pt } else { 10.5pt }
    #set text(hyphenate: false)
    #if note [ #row(W("note-title", "A Note on This Edition"), <note>, size: 11pt) ]
    #if introduction != none [ #row(W("intro", "Before you begin"), <intro>, size: 11pt) ]
    #if parts == none [
      #for (i, ch) in chapters.enumerate() [ #row(ch.title, label("ch-" + str(i + 1)), size: ch-size) ]
    ] else [
      #for (p, part) in parts.enumerate() [
        #v(0.5em)
        #row(part.title, label("part-" + str(p + 1)), size: 11pt, weight: 600, eye: part.eyebrow)
        #for (i, ch) in part.chapters.enumerate() [ #row(ch.title, label("ch-" + str(p + 1) + "-" + str(i + 1)), indent: 1.2em, size: ch-size) ]
      ]
    ]
    #if marks > 0 [
      #v(0.6em)
      #row(W("marks", "The lines worth noticing"), <marks>, size: 11pt, fill: INK2)
    ]
    #metadata("end")<end>
  ]

  // ---- the text, with running heads and numbers: on a recto, numbered from 1. The contents
  // page is marked as an end, so a verso skipped on the way to that recto is blank ----
  pagebreak(to: "odd", weak: true)
  counter(page).update(1)
  body
}

// A Note on This Edition: the publisher's page before the text, on a recto of its own
// `first`: the first thing in the body, already on the recto the front matter ends on — no break,
// and no end-mark on an otherwise empty page (which would push it to the next recto)
#let note-page(title, body, first: false) = {
  if not first { recto() }
  v(1.2in)
  heading(level: 1, outlined: false, numbering: none, text(size: 18pt, title))
  [#metadata(title)<chapter>#metadata("note")<note>]
  at-sheet("note", title)
  v(0.35in)
  set par(first-line-indent: 1.2em, justify: true, leading: 0.7em)
  set text(size: 10pt)
  body
}

// a part opener: a right-hand page of its own — the part's eyebrow, the book's title large,
// and under it, small, what this part is (the modern edition · the original full text)
#let part-opener(n, eye, title, book-title: "", first: false) = {
  if not first { recto() }
  v(2.6in)
  set par(justify: false)
  align(center)[
    #eyebrow[#eye]
    #v(0.25in)
    #heading(level: 1, outlined: false, numbering: none, text(size: if book-title.len() <= 14 { 28pt } else if book-title.len() <= 24 { 24pt } else { 20pt }, tracking: 0.06em, upper(book-title)))
    #v(0.18in)
    #text(font: "Fraunces", size: 13pt, weight: 400, fill: INK2, title)
  ]
  [#metadata(title)<chapter>#metadata("part")#label("part-" + str(n))]
  at-sheet("part", title)
}

// a chapter opener: the number as an eyebrow, the title, then air — always on a page of its own.
// `odd`: a chapter of a book of long chapters opens on a right-hand page; a short chapter (a
// page or two, as in a book of eighty-one) opens on the next page whichever side it is
#let opener(n, title, plain, lab, word: "Chapter", odd: true) = {
  if odd { recto() } else { pagebreak(weak: true) }
  v(1.6in)
  if n != none { eyebrow[#word #n] } else { v(0.7em) }
  v(0.12in)
  heading(level: 1, outlined: false, numbering: none, title)
  [#metadata(plain)<chapter>#metadata(plain)#lab]
  at-sheet("chapter", plain)
  v(0.5in)
}
#let intro-opener(title, plain, eye: "Before you begin", first: false) = {
  if not first { recto() }
  v(1.6in)
  eyebrow[#eye]
  v(0.12in)
  heading(level: 1, outlined: false, numbering: none, title)
  [#metadata(plain)<chapter>#metadata("intro")<intro>]
  at-sheet("intro", plain)
  v(0.5in)
}
// a subhead inside a chapter: air above, a little below, and never left at the foot of a page
#let subhead(body) = {
  block(sticky: true, above: 1.4em, below: 0.6em, heading(level: 2, outlined: false, numbering: none, body))
}
// the book's own last words, centred
#let the-end(body) = align(center, block(above: 2em, eyebrow[#body]))
// a section break within a chapter
#let dinkus = align(center, block(above: 1.2em, below: 1.2em, text(fill: INK3, size: 9pt, tracking: 0.7em, "\u{2217}\u{2217}\u{2217}")))
#let verse(body) = {
  set par(first-line-indent: 0em, justify: false, hanging-indent: 1.4em)
  block(inset: (left: 1.2em), above: 1.1em, below: 1.1em, body)
}
#let quote(body) = {
  set par(first-line-indent: 0em)
  block(inset: (left: 1.6em, right: 1.6em, y: 0.3em), above: 1.1em, below: 1.1em, text(size: 10pt, fill: INK2, body))
}

// the companion, after a chapter: in brief, and the key insights
// a short companion moves whole to the next page rather than leaving its insights orphaned
#let companion(summary: none, essence: (), brief: "In brief", insights: "Key insights", long: true) = {
  if summary == none and essence.len() == 0 { return }
  v(1.4em)
  block(width: 100%, breakable: long, stroke: (top: 0.5pt + HAIR, bottom: 0.5pt + HAIR), inset: (y: 1em))[
    #set par(first-line-indent: 0em, justify: true, leading: 0.66em, spacing: 0.8em)
    #set text(size: 9.6pt)
    #if summary != none [
      #block(sticky: true, below: 0.5em, eyebrow[#brief])
      #summary
    ]
    #if essence.len() > 0 [
      #if summary != none [ #v(0.6em) ]
      #set enum(numbering: n => text(font: "IBM Plex Mono", size: 8pt, fill: INK3, str(n)), indent: 0em, body-indent: 0.9em, spacing: 0.55em)
      // a list of four or fewer moves whole; a longer one may break, but never after its first
      // line (a heading with one line under it) nor before its last (one line alone on a page)
      #let n = essence.len()
      #if n <= 4 [
        #block(breakable: false)[
          #block(sticky: true, below: 0.55em, eyebrow[#insights])
          #enum(..essence)
        ]
      ] else [
        #block(breakable: false, below: 0.55em)[
          #block(sticky: true, below: 0.55em, eyebrow[#insights])
          #enum(..essence.slice(0, 2))
        ]
        #if n > 4 [ #block(below: 0.55em, enum(start: 3, ..essence.slice(2, n - 2))) ]
        #block(breakable: false, enum(start: n - 1, ..essence.slice(n - 2)))
      ]
    ]
  ]
}

// blank leaves at the very end, for a book shorter than the printer will bind (24 pages)
#let blank-pages(n) = { for _ in range(n) { page(header: none, footer: none, numbering: none)[] } }

// the back matter: every marked line, chapter by chapter, with its page
// `lists`: ((title: "From the Modern Edition", marks: ((n:, text:), …)), …)
// the lines at the back, set as a novel sets its pages: the heading face large, with generous
// leading, ragged on a narrow measure, a good deal of air between one line and the next, and
// between them the jacket's small ornament (a rule with a diamond) — never at the head of a
// page; the page small beneath each line
#let marks-page(lists: (), eye: "At the back", title: "The lines worth noticing", page-word: "p.") = {
  recto()
  let lists = lists.filter(l => l.marks.len() > 0)
  for (i, l) in lists.enumerate() {
    // each run opens its own page: the title under its eyebrow the first time, the run's name
    // between rules at the same height every time
    if i > 0 { pagebreak(weak: true) }
    v(1.6in)
    if i == 0 {
      eyebrow[#eye]
      v(0.12in)
      heading(level: 1, outlined: false, numbering: none, title)
      [#metadata(title)<chapter>#metadata("marks")<marks>]
      at-sheet("marks", title)
      v(0.3in)
      ruled(eyebrow[#l.title], HAIR)
    } else {
      v(24pt + 0.12in + 0.3in - 2pt)
      heading(level: 1, outlined: false, numbering: none, ruled(eyebrow[#l.title], HAIR))
    }
    v(0.6in)
    set par(first-line-indent: 0em, justify: false, leading: 1em, spacing: 1em)
    set text(font: "Fraunces", size: 13.5pt, hyphenate: false)
    for (k, m) in l.marks.enumerate() {
      let pg = context { let q = query(label("mark-" + str(m.n))); if q.len() > 0 { counter(page).at(q.first().location()).first() } }
      if k > 0 {
        // the ornament goes with the line after it, and is not drawn at the head of a page
        block(sticky: true, above: 2em, below: 2em, width: 100%, inset: (left: 0.35in), context { if here().position().y < 1in { hide(ornament(INK3, width: 0.9in)) } else { ornament(INK3, width: 0.9in) } })
      }
      block(breakable: false, width: 100%, above: 0em, below: 0em, inset: (left: 0.35in, right: 0.1in))[
        #m.text
        #v(0.45em)
        #text(font: "IBM Plex Mono", size: 7pt, tracking: 0.14em, fill: INK3)[#page-word #pg]
      ]
    }
  }
}
