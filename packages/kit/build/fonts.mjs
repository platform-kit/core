/*
 * THE THREE FACES A SITE SETS, read from the stylesheets that set them.
 *
 * `--f` is the body, `--fd` the display, `--m` the mono — declared in the theme's tokens.css and
 * overridden by a look that wants its own (the demo's north.css swaps Fraunces and IBM Plex Mono
 * for Newsreader and JetBrains Mono). The browser reads them from the CSS and nothing else needs
 * to know.
 *
 * Except one thing does. The share-image function draws the card where no browser can photograph
 * the real one, and a card set in the wrong type is not the site's card. It has no stylesheet and
 * no DOM, so the families are compiled into the catalog beside the store's words — the same
 * arrangement and for the same reason: what a function needs in order to render something in the
 * site's own voice travels with the catalog.
 *
 * Only the FIRST family of each stack is carried: the rest are the local fallbacks a browser walks,
 * and a function fetching a face by name has one name to fetch.
 */
import fs from 'node:fs'
import path from 'node:path'

const FIRST = (v) => String(v || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')
const grab = (css, name) => {
  /* the last declaration wins, as the cascade would have it for a token set at the root */
  let out = null
  for (const m of css.matchAll(new RegExp('--' + name + '\\s*:\\s*([^;]+);', 'gi'))) out = m[1]
  return out ? FIRST(out) : null
}

/* { display, body, mono } — the theme's, with the active look's overriding where it states any */
export function readFonts({ themeDir, lookFile } = {}) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
  let css = ''
  if (themeDir) for (const f of ['tokens.css', 'atlas.css']) css += read(path.join(themeDir, f))
  const out = { body: grab(css, 'f'), display: grab(css, 'fd'), mono: grab(css, 'm') }
  if (lookFile) {
    const look = read(lookFile)
    for (const [k, token] of [['body', 'f'], ['display', 'fd'], ['mono', 'm']]) {
      const v = grab(look, token)
      if (v) out[k] = v
    }
  }
  /* a site that names none is not a fault: the function falls back to what it can fetch */
  return out
}

/* the site's own, resolved from its config: the theme's source directory and the look it wears */
/*
 * THE FACES THIS SITE IS ACTUALLY SET IN. A site NAMES them in content/site.md now
 * (build/typefaces.mjs), and that is what the build writes into the page's head — so it is what
 * the card must be drawn in, or a share image is set in different type from the page it shares.
 *
 * The stylesheets are still read underneath, for a site from before the faces were a setting and
 * for any face a look still declares. The choice wins where there is one.
 */
export async function fontsOf(root = process.cwd()) {
  const { loadSite } = await import('./site.mjs')
  const { loadTheme } = await import('./theme.mjs')
  let fromCss = { body: null, display: null, mono: null }
  try {
    const site = await loadSite(root)
    const theme = await loadTheme(site)
    const look = site.looks && site.looks[site.defaultLook]
    const lookFile = look && look.css ? path.resolve(root, look.css) : null
    fromCss = readFonts({ themeDir: theme.src, lookFile })
  } catch { /* a site that will not load has no faces to read; the choice below may still answer */ }
  try {
    const { readSiteFonts } = await import('./site-fonts.mjs')
    const { resolveFonts } = await import('./typefaces.mjs')
    const chosen = resolveFonts(readSiteFonts(root))
    return {
      body: chosen.body.name || fromCss.body,
      display: chosen.heading.name || fromCss.display,
      mono: chosen.mono.name || fromCss.mono,
    }
  } catch (e) {
    let named = false
    try { named = /^\s*fonts:\s*$/m.test(fs.readFileSync(path.join(root, 'content', 'site.md'), 'utf8')) } catch { /* no site.md */ }
    if (named) throw new Error('fonts: this site names its faces in content/site.md and they could not be read — ' + e.message)
    return fromCss
  }
}

/*
 * THE SITE'S MARK, as flat SVG.
 *
 * The card's brand row is the mark and the site's name (`.sh-brand`, gap 10px). The mark is a Vue
 * component — SiteMark.vue, which a site replaces by name — and a function has no Vue, so the SVG
 * is lifted out of the template here and carried with the fonts.
 *
 * The lift is deliberately narrow: the component is a bare <svg> by convention (the theme's is, and
 * so is every override), and the two bindings it uses are `:width`/`:height="size"` and
 * `:stroke="stroke"`. A component that is anything more than that returns null and the card is
 * drawn with the name alone — which is the right failure, because a mark drawn wrongly is worse
 * than a mark left out.
 */
export function markFrom(vue, { size = 26, stroke = '#ffffff' } = {}) {
  const m = /<svg[\s\S]*?<\/svg>/.exec(String(vue || ''))
  if (!m) return null
  let svg = m[0]
  /* the bindings the convention allows, and nothing else */
  svg = svg.replace(/:width="size"/g, `width="${size}"`).replace(/:height="size"/g, `height="${size}"`)
  svg = svg.replace(/:stroke="stroke"/g, `stroke="${stroke}"`).replace(/:fill="stroke"/g, `fill="${stroke}"`)
  svg = svg.replace(/\s(?::|v-)[a-z-]+="[^"]*"/gi, '')   /* any other binding: dropped, not guessed */
  if (/\{\{|v-if|v-for/.test(svg)) return null           /* more than a bare mark: leave it out */
  if (!/\sxmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  return svg
}

/*
 * THE COLOUR THE MARK IS DRAWN IN, which is NOT the colour of the words beside it.
 *
 * SiteMark's stroke defaults to `var(--accent)`, so on the card the mark is the site's accent and
 * the name beside it is the row's grey. Tinting both to the row's colour — which the first version
 * did — makes the card look like a different site's.
 */
export function accentFrom(css) {
  /* THE LIGHT ONE. The card is photographed with data-theme="light" forced, and a look states its
     dark palette after its light one — taking the last match gave the dark accent, a cyan where the
     mark is actually crimson. So: the first declaration that is not inside a dark block. */
  const src = String(css || '')
  const blocks = src.split(/(?=[^{}]*\{)/)
  for (const b2 of blocks) {
    const head = b2.slice(0, b2.indexOf('{'))
    if (/dark/i.test(head)) continue
    const m = /--accent\s*:\s*([^;]+);/i.exec(b2)
    if (m) return m[1].trim()
  }
  return null
}
export async function accentOf(root = process.cwd()) {
  const { loadSite } = await import('./site.mjs')
  const { loadTheme } = await import('./theme.mjs')
  const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
  try {
    const site = await loadSite(root)
    const theme = await loadTheme(site)
    const look = site.looks && site.looks[site.defaultLook]
    /* the look states the site's palette; the theme's tokens are the floor under it */
    return accentFrom(look && look.css ? read(path.resolve(root, look.css)) : '')
      || accentFrom(read(path.join(theme.src, 'tokens.css'))) || null
  } catch { return null }
}

/* the site's own mark where it overrides one, else the theme's */
export async function markOf(root = process.cwd(), opts = {}) {
  const { loadSite } = await import('./site.mjs')
  const { loadTheme } = await import('./theme.mjs')
  try {
    const site = await loadSite(root)
    const theme = await loadTheme(site)
    const own = site.overrides && site.overrides.SiteMark
    const file = own ? path.resolve(root, own) : path.join(theme.src, 'components', 'SiteMark.vue')
    return markFrom(fs.readFileSync(file, 'utf8'), opts)
  } catch { return null }
}
