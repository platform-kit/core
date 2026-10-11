#!/usr/bin/env node
/*
 * EVERY COLOUR A LOOK NAMES, found rather than listed.
 *
 * A look is a palette: tokens under `[data-look="<name>"]`, with a dark variant beside each. An
 * owner should be able to change any of them from Site settings — and the moment that list is
 * typed out somewhere, it is a list that drifts. A look gains a token, nobody adds it to the form,
 * and the one thing the owner wanted to change is the one thing the form does not offer.
 *
 * So the list is read from the stylesheets themselves: the theme's design (the rule owed to a look
 * that has not named one) and each look's own file. What comes out is, per look, every token with
 * its day value and its night value — which is exactly what a form needs to show a default beside
 * the field and to offer putting it back.
 *
 *   node build/tokens.mjs            # write .velite/tokens.json
 *   node build/tokens.mjs --check    # check only (platformkit test)
 *
 * WHAT IS NOT HERE. A token that is not a colour — a width, a radius, a duration — is read the
 * same way and marked `kind: 'text'`, because an owner changing the measure of a page is a
 * different decision from changing its red, and a colour picker on a line-height is nonsense.
 */
import fs from 'node:fs'
import path from 'node:path'

/* a value that names a colour, as against a length, a shadow or a font stack. Deliberately
   generous: a token the form shows as a colour by mistake still edits as text underneath. */
const COLOUR = /^(#[0-9a-f]{3,8}|rgb|rgba|hsl|hsla|color-mix|oklch|light-dark)\b/i

/* `--name: value;` inside a block, with the block's selector */
function tokensIn(css) {
  const out = []
  /* strip comments first: a commented-out token is not a token */
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = clean.split('}')
  for (const block of blocks) {
    const at = block.lastIndexOf('{')
    if (at < 0) continue
    const selector = block.slice(0, at).split('\n').pop().trim()
    const body = block.slice(at + 1)
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      out.push({ selector, name: m[1], value: m[2].trim() })
    }
  }
  return out
}

/*
 * IS THIS SELECTOR THE NIGHT? A look states its dark values twice, as the design rule requires:
 * once under [data-theme="dark"], and once inside @media (prefers-color-scheme: dark) guarded by
 * :not([data-theme="light"]). The second is the one that catches people out — its own line says
 * "light", the word dark being on the @media line above it, which a selector read line by line
 * never sees. Missing it is not a missing value but a WRONG one: the dark block is the last in the
 * file, so its value lands on the light slot and the form offers a night colour as the day's.
 */
const isDark = (sel) => /data-theme=['"]?dark/.test(sel) || /:not\(\[data-theme=['"]?light/.test(sel)
/* which look does this selector belong to, if any */
const lookOf = (sel) => (sel.match(/data-look=['"]([a-z0-9-]+)['"]/i) || [])[1] || null

export function readTokens({ design, looks }) {
  /* the design's own, which every look inherits unless it says otherwise */
  const base = {}
  if (design && fs.existsSync(design)) {
    for (const t of tokensIn(fs.readFileSync(design, 'utf8'))) {
      if (lookOf(t.selector)) continue          /* a look's own, not the design's */
      const slot = base[t.name] || (base[t.name] = {})
      slot[isDark(t.selector) ? 'dark' : 'light'] = t.value
    }
  }
  const out = {}
  for (const [name, file] of Object.entries(looks || {})) {
    if (!fs.existsSync(file)) continue
    const own = {}
    for (const t of tokensIn(fs.readFileSync(file, 'utf8'))) {
      /* THE SITE'S PALETTE IS WHAT THE LOOK STATES SITE-WIDE. A look also dresses the landing
         (.lproot) and a surface or two of its own; those are that surface's business and not a
         colour an owner is choosing for the site, so only the root declarations are offered. */
      const sel = t.selector.trim()
      if (!sel.includes('[data-look')) continue
      /*
       * WHERE THIS COLOUR APPLIES, which an owner needs to know before changing it.
       *
       * A look states some tokens site-wide and dresses particular surfaces with others: the
       * landing (.lproot), the instrument (.qz), the reader's page. The same name can mean two
       * things in two places — --ink is one colour on the site and another on the landing — so a
       * form that showed one row called "ink" would be lying about one of them.
       */
      const after = sel.replace(/^[^\s]+\s*/, '').trim()
      /* THE SURFACE, not the selector. A look dresses a thing and then dresses a variation of it
         (.qz then .qz .qzread; the reader then its night scheme), and an owner does not think in
         those terms: they think "the diagnostic", "the reader". So a compound falls back to the
         first class in it, and a variation of a surface is that surface. */
      const first = after.replace(/[>+~]/g, ' ').trim().split(/\s+/)[0] || ''
      const scope = !after ? 'site'
        : after.includes('lproot') || first.startsWith('#lp') ? 'landing'
        : (first.match(/[.#]?([a-z0-9-]+)/i) || [])[1] || 'other'
      /* THE KEY CARRIES THE EXACT SELECTOR, not the friendly scope. The scope is for the form —
         somebody thinks "the diagnostic", not ".qz .qzread" — but a look dresses a surface and
         then a variation of it, and an override written against the base would apply to both.
         With the selector in the key nothing merges, and the runtime needs no lookup table: it
         splits on the last space and has the selector the look itself used. */
      const key = after ? after + ' ' + t.name : t.name
      /* the descendant part VERBATIM, so an override can rebuild the look's own selector exactly
         and win by being the later rule rather than by out-specifying it */
      const slot = own[key] || (own[key] = { token: t.name, scope, sel: after })
      /* LAST ONE WINS, as the cascade decides it: a look states a token once per mode, and where
         it states it twice the later rule is the one a browser paints. */
      slot[isDark(t.selector) ? 'dark' : 'light'] = t.value
    }
    /* the design's tokens are the architecture — derived values, a rule owed to a look that has
       not named one — and are not a palette an owner picks from. Only what the LOOK names. */
    const merged = {}
    for (const [k, v] of Object.entries(own)) {
      const light = (own[k] && own[k].light) ?? (base[k] && base[k].light) ?? ''
      const dark = (own[k] && own[k].dark) ?? (base[k] && base[k].dark) ?? ''
      merged[k] = {
        token: (own[k] && own[k].token) || k, scope: (own[k] && own[k].scope) || 'site', sel: (own[k] && own[k].sel) || '',
        light, dark,
        /* whether this look names it itself, or is wearing the design's */
        own: !!(own[k] && (own[k].light || own[k].dark)),
        kind: COLOUR.test(light || dark) ? 'colour' : 'text',
      }
    }
    out[name] = merged
  }
  return out
}

/* the tokens a site may change, for the admin and for the runtime */
export async function compileTokens({ root = process.cwd(), check = false } = {}) {
  const { loadSite } = await import('./site.mjs')
  const { loadTheme } = await import('./theme.mjs')
  const site = await loadSite(root)
  const theme = await loadTheme(site)
  const looksDir = path.join(root, 'src/looks')
  const looks = {}
  if (fs.existsSync(looksDir)) {
    for (const f of fs.readdirSync(looksDir)) {
      if (!f.endsWith('.css') || f === 'design.css') continue
      looks[f.replace(/\.css$/, '')] = path.join(looksDir, f)
    }
  }
  const found = readTokens({ design: theme.design, looks })
  const text = JSON.stringify(found, null, 2) + '\n'
  const out = path.join(root, '.velite/tokens.json')
  const n = Object.values(found).reduce((a, m) => a + Object.keys(m).length, 0)
  if (check) {
    if (!n) { console.error('✖ tokens: no look names a single token — is src/looks there?'); process.exitCode = 1; return null }
    console.log(`✔ tokens: ${Object.keys(found).length} look(s), ${n} token(s)`)
    return found
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, text)
  console.log(`.velite/tokens.json ← ${Object.keys(found).length} look(s), ${n} token(s)`)
  return found
}

if (import.meta.url === `file://${process.argv[1]}`) await compileTokens({ check: process.argv.includes('--check') })
