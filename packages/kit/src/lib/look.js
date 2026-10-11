/*
 * The look: the palette the site wears. Every look shares one design —
 * src/looks/design.css, the rules under [data-look], and the landing skins in
 * src/components/landing/skins/ — and is itself a set of colour tokens in
 * src/looks/<name>.css under [data-look="<name>"]. `classic` is the one look for
 * now; a new one is a css file of tokens, its name here and in landing/index.js,
 * the velite site schema and the admin's. The markdown never changes: a page names
 * its sections once and every look renders them.
 *
 * The site's choice is `look` in content/site.md (Site settings in the admin).
 * `?look=<name>` on any url overrides it for that visit — the admin's preview
 * uses that to flip between looks without saving.
 */
import { ref } from 'vue'
import { site as SITE } from '#content'
import { LOOKS, DEFAULT_LOOK } from '#site/looks'   /* the site's palettes, from platformkit.config.js */
export { LOOKS, DEFAULT_LOOK }

function fromQuery() {
  try {
    const q = new URLSearchParams(location.search).get('look')
    return LOOKS.includes(q) ? q : ''
  } catch (e) { return '' }
}

const siteLook = (SITE && SITE.look && LOOKS.includes(SITE.look)) ? SITE.look : DEFAULT_LOOK
export const look = ref(fromQuery() || siteLook)

/* stamp the root: every look is an attribute, so the design (src/looks/design.css,
   under [data-look]) and the look's palette (src/looks/<name>.css) both apply */
export function applyLook(name) {
  const l = LOOKS.includes(name) ? name : DEFAULT_LOOK
  look.value = l
  if (typeof document === 'undefined') return
  document.documentElement.dataset.look = l
  applyTokens()
}

/*
 * THE COLOURS AN OWNER CHANGED, over the look's own.
 *
 * A look is a stylesheet and an owner is not going to edit one, so Site settings offers every
 * token the look names and keeps what they changed in content/site.md — a DECLARATION, because the
 * answer to "if the database were deleted and the repository redeployed, should this come back" is
 * obviously yes.
 *
 * It is written as a STYLESHEET and not as inline properties on the root, because most of a look's
 * colours are not site-wide: they dress the landing, the instrument, the reader's page. An inline
 * property on <html> cannot reach a token declared under .lproot, so half the form would have
 * silently done nothing. Each override rebuilds the look's own selector exactly and is injected
 * last, which wins by order rather than by out-specifying anything — the same way a look wins over
 * the design.
 *
 * A token nobody changed is simply absent, so the look's own value applies and putting one back is
 * deleting a key rather than storing a copy of the default, which would go stale the day the look
 * is retuned.
 */
let sheet = null
export function applyTokens(over) {
  if (typeof document === 'undefined') return
  const chosen = over || (SITE && SITE.tokens) || {}
  const l = look.value
  const day = [], night = []
  for (const [key, value] of Object.entries(chosen)) {
    /* a value is a colour for the day, or { light, dark } for both */
    const light = typeof value === 'string' ? value : (value && value.light) || ''
    const dark = value && typeof value === 'object' ? value.dark || '' : ''
    /* the key is the look's own selector then the token — ".lproot --ink", or "--accent" for one
       stated site-wide. Split on the LAST space: a selector may contain them, a token may not. */
    const whole = String(key).trim()
    const at = whole.lastIndexOf(' ')
    const token = at < 0 ? whole : whole.slice(at + 1)
    const sel = at < 0 ? '' : whole.slice(0, at).trim()
    if (!token.startsWith('--')) continue
    if (light) day.push({ sel, token, value: String(light).trim() })
    if (dark) night.push({ sel, token, value: String(dark).trim() })
  }
  if (!day.length && !night.length) { if (sheet) sheet.textContent = ''; return }
  const rule = (base, rows) => {
    const by = {}
    for (const r of rows) (by[r.sel] || (by[r.sel] = [])).push(`  ${r.token}: ${r.value};`)
    return Object.entries(by).map(([sel, lines]) => `${base}${sel ? ' ' + sel : ''} {\n${lines.join('\n')}\n}`).join('\n')
  }
  const css = [
    day.length ? rule(`:root[data-look="${l}"]`, day) : '',
    /* the night is stated twice, as the look states it: the chosen theme, and the system's */
    night.length ? rule(`[data-theme="dark"][data-look="${l}"]`, night) : '',
    night.length ? `@media (prefers-color-scheme: dark) {\n${rule(`:root[data-look="${l}"]:not([data-theme="light"])`, night)}\n}` : '',
  ].filter(Boolean).join('\n')
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.setAttribute('data-tokens', '')
    document.head.appendChild(sheet)   /* last in the head, so it is the later rule */
  }
  sheet.textContent = css
}

