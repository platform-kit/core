// The cover, set in type — never the site's cover art, which was made for a screen.
// One design for both bindings, in the cloth's colour and the foil's: a double rule
// frames each panel; the front carries the title
// large and centred in the upper third, an ornament, the author in spaced capitals, and at
// the foot the mark with the edition's eyebrow between rules beneath it,
// the whole on a ground that lightens toward the top like a lamp on cloth; the spine
// says what the foil under it says — Title · THE MODERN EDITION; the back sets
// the companion's insight as a pull quote over the introduction's opening; a jacket's
// flaps say what the book is and what the edition is. A casewrap prints this straight
// onto the boards (`bleed` is the wrap round the board plus the bleed); a linen wrap
// wears it as the dust jacket (`flap` > 0). Sized in points, to the printer's
// dimensions for the page count. Bump VERSION when this changes.

#let VERSION = "3"

// the cloths the printer binds in, and the foils it stamps — as colours
#let CLOTH = (
  navy: rgb("#1c2740"), gray: rgb("#585b60"), red: rgb("#712727"), black: rgb("#161512"), tan: rgb("#b39a72"), forest: rgb("#28422f"),
)
#let FOIL = (gold: rgb("#d4ad57"), black: rgb("#161512"), white: rgb("#f4f1ea"))
#let PAPER = rgb("#f4f1ea")

// the mark: the site's own six-pointed figure
#let mark(size: 28pt, stroke-colour: PAPER, weight: 1.2pt) = box(width: size, height: size, {
  place(polygon(fill: none, stroke: weight + stroke-colour,
    (size * 0.5, size * 0.08), (size * 0.87, size * 0.71), (size * 0.13, size * 0.29),
    (size * 0.5, size * 0.92), (size * 0.87, size * 0.29), (size * 0.13, size * 0.71)))
})

#let eyebrow(body, fill: PAPER, size: 7.5pt) = text(font: "IBM Plex Mono", size: size, tracking: 0.2em, fill: fill, upper(body))

// a line with a small diamond at its middle — the ornament under a title
#let ornament(colour, width: 1.6in) = box(width: width, height: 8pt, {
  place(dy: 3.6pt, line(length: width, stroke: 0.5pt + colour))
  place(dx: width / 2 - 3.2pt, dy: 0.6pt, rotate(45deg, rect(width: 4.6pt, height: 4.6pt, fill: colour)))
})

// an eyebrow between two rules, as on a title page
#let ruled(body, colour, width: 100%) = grid(columns: (1fr, auto, 1fr), column-gutter: 0.6em, align: horizon,
  line(length: 100%, stroke: 0.4pt + colour), body, line(length: 100%, stroke: 0.4pt + colour))

// the double rule that frames a panel: inset from the panel's edge, well inside the safe area
#let frame(x, y, w, h, colour, inset: 0.42in) = {
  place(dx: x + inset, dy: y + inset, rect(width: w - 2 * inset, height: h - 2 * inset, stroke: 0.7pt + colour, fill: none))
  place(dx: x + inset + 5pt, dy: y + inset + 5pt, rect(width: w - 2 * inset - 10pt, height: h - 2 * inset - 10pt, stroke: 0.3pt + colour, fill: none))
}

#let cover(
  width: 0pt, height: 0pt, bleed: 9pt, spine: 0pt, flap: 0pt, trim-width: 432pt,
  cloth: "black", foil: "gold",
  title: "", author: "", insight: "", description: "", opening: "", about-text: "",
  edition: "The modern edition", spine-title: "", spine-edition: "", edition-line: "", about: "About this book", this-edition: "This edition",
  site: "",
  // the foil layer alone: what is stamped, black on white (a printer's foil file; the store's
  // mask) — the type and the mark in the foil's colour, nothing printed
  foil-only: false,
  // a paperback: the e-book's own cover fills the front — it carries its title and author already —
  // and only the mark and the edition line are set over it, at the foot on a scrim
  picture: "",
) = {
  let ground = if foil-only { white } else { CLOTH.at(cloth, default: CLOTH.black) }
  let gilt = if foil-only { black } else { FOIL.at(foil, default: FOIL.gold) }
  let light = cloth != "tan"
  let ink = if foil-only { white } else if light { PAPER } else { rgb("#1b1a17") }
  let soft = if foil-only { white } else if light { PAPER.transparentize(35%) } else { rgb("#3d3a33") }
  let faint = if foil-only { white } else { gilt.transparentize(if light { 55% } else { 30% }) }
  set page(width: width, height: height, margin: 0pt)
  set text(font: "Bitter", fill: ink, lang: "en")
  set par(justify: false)

  // the ground: the cloth, lit from above
  place(rect(width: width, height: height, fill: if foil-only { white } else { gradient.linear(angle: 90deg, ground.lighten(if light { 9% } else { 4% }), ground, ground.darken(if light { 12% } else { 3% })) }))

  // where things are: the panels from the left, every text block inside the safe area
  let trim-height = height - 2 * bleed
  let back-x = bleed + flap
  let front-x = back-x + trim-width + spine
  let safe = 0.75in
  let inner = trim-width - 2 * safe

  // ---- front ----
  if picture != "" and not foil-only {
    // the picture over the whole front panel and its bleed, cropped to fill; a scrim rising
    // from the foot so the mark and the edition line read over anything
    place(dx: front-x, dy: 0pt, image(picture, width: trim-width + bleed, height: height, fit: "cover"))
    place(dx: front-x, dy: height - 4.6in, rect(width: trim-width + bleed, height: 4.6in, fill: gradient.linear(angle: 90deg, rgb("#00000000"), rgb("#00000033"), rgb("#00000080"), rgb("#000000b3"))))
    place(dx: front-x + safe, dy: bleed + trim-height - 0.95in - 26pt - 0.42in, block(width: inner)[
      #set align(center)
      #set par(spacing: 0pt)
      #mark(size: 26pt, stroke-colour: FOIL.gold)
      #v(0.3in)
      #ruled(eyebrow(edition, fill: FOIL.gold.transparentize(35%)), FOIL.gold.transparentize(35%))
    ])
  } else {
    frame(front-x, bleed, trim-width, trim-height, faint)
    // the title block sits in the upper third, its own parts close: title, ornament, author
    place(dx: front-x + safe, dy: bleed + trim-height * 0.215, block(width: inner)[
      #set align(center)
      #set par(leading: 0.5em, spacing: 0pt)
      #text(font: "Fraunces", size: if title.len() > 24 { 28pt } else if title.len() > 14 { 34pt } else { 40pt }, weight: 500, fill: gilt, tracking: -0.01em, title)
      #v(0.34in)
      #ornament(gilt)
      #v(0.24in)
      #text(font: "Bitter", size: 10.5pt, tracking: 0.22em, fill: if foil-only { gilt } else { ink }, upper(author))
    ])
    // the foot: the mark, and under it the edition between rules
    place(dx: front-x + safe, dy: bleed + trim-height - 0.95in - 26pt - 0.42in, block(width: inner)[
      #set align(center)
      #set par(spacing: 0pt)
      #mark(size: 26pt, stroke-colour: gilt)
      #v(0.3in)
      #ruled(eyebrow(edition, fill: faint), faint)
    ])
  }

  // ---- spine: what the foil beneath it says ----
  if spine > 22pt {
    let small = spine < 40pt
    place(dx: back-x + trim-width, dy: bleed + 0.55in, block(width: spine, align(center, line(length: spine * 0.5, stroke: 0.4pt + faint))))
    place(dx: back-x + trim-width, dy: height - bleed - 0.55in, block(width: spine, align(center, line(length: spine * 0.5, stroke: 0.4pt + faint))))
    place(dx: back-x + trim-width, rect(width: spine, height: height, fill: none, stroke: none, align(center + horizon,
      rotate(90deg, reflow: true, box(width: height - 2 * bleed - 1.6in)[
        #text(font: "Fraunces", size: if small { 9.5pt } else { 12pt }, weight: 500, fill: gilt, if spine-title != "" { spine-title } else { title })
        #if spine-edition != "" [#h(0.6em)#text(fill: faint, size: if small { 8pt } else { 10pt })[·]#h(0.6em)#eyebrow(spine-edition, fill: soft, size: if small { 6.5pt } else { 7.5pt })]
        #h(1fr)
        #mark(size: if small { 9pt } else { 11pt }, stroke-colour: gilt)
      ]))))
  }

  // ---- back ----
  frame(back-x, bleed, trim-width, trim-height, faint)
  place(dx: back-x + safe, dy: bleed + 0.95in, block(width: inner)[
    #set align(center)
    #set par(spacing: 0pt)
    #if insight != "" [
      #text(font: "Fraunces", size: 30pt, weight: 300, fill: gilt)["]
      #v(0.04in)
      #block(width: inner - 0.4in, par(leading: 0.62em, text(font: "Fraunces", size: 15.5pt, weight: 400, fill: ink, insight)))
      #v(0.26in)
      #ornament(gilt, width: 1.1in)
      #v(0.32in)
    ]
    #if opening != "" or description != "" [
      #block(width: inner - 0.3in)[
        #set par(justify: true, leading: 0.72em, spacing: 0.6em)
        #set text(size: 9pt, fill: soft)
        #for (i, p) in (if opening != "" { opening } else { description }).split("\n\n").enumerate() [ #if i > 0 [ #v(0.1in) ] #p ]
      ]
    ]
  ])
  place(dx: back-x + safe, dy: bleed + trim-height - 0.95in - 0.62in, block(width: inner)[
    #set align(center)
    #mark(size: 20pt, stroke-colour: gilt)
    #v(0.1in)
    #eyebrow(edition, fill: soft) \
    #text(font: "IBM Plex Mono", size: 7pt, tracking: 0.08em, fill: soft, site)
  ])

  // ---- the flaps of a jacket ----
  if flap > 0pt {
    let fx = 0.4in
    let fw = flap - fx - 0.45in
    // front flap: what the book is
    place(dx: front-x + trim-width + fx, dy: bleed + 0.95in, block(width: fw)[
      #set par(leading: 0.7em)
      #eyebrow(about, fill: faint)
      #v(0.06in)
      #line(length: 0.5in, stroke: 0.4pt + faint)
      #v(0.16in)
      #if about-text != "" [
        #for (i, p) in about-text.split("\n\n").enumerate() [ #if i > 0 [ #v(0.12in) ] #text(size: 9pt, fill: ink, p) ]
      ] else [
        #text(size: 9pt, fill: ink, description)
        #if author != "" [ #v(0.16in) #text(size: 8.5pt, fill: soft, author) ]
      ]
    ])
    // back flap: what the edition is
    place(dx: bleed + 0.45in, dy: bleed + 0.95in, block(width: fw)[
      #set par(leading: 0.7em)
      #eyebrow(this-edition, fill: faint)
      #v(0.06in)
      #line(length: 0.5in, stroke: 0.4pt + faint)
      #v(0.16in)
      #text(size: 9pt, fill: ink, edition-line)
      #v(0.3in)
      #mark(size: 16pt, stroke-colour: gilt)
    ])
  }
}
