/*
 * The host's rewrite rules — one source of truth, `deploy/_redirects`: Netlify's format (`source destination status`,
 * `:splat` the rest of a `/*` path, 200 a rewrite), `$SUPABASE_URL` standing for the project's address. A site is a
 * static build, and everything else it needs from the host is that handful of rewrites to the project's Edge Functions
 * — the functions on the site's domain (/v1/*), the content API at Contentful's paths, the Scheduling API at cal.com's,
 * and the app for every other path. Nothing else declares them: this module reads the file and
 *
 *   - writes `dist/_redirects` with $SUPABASE_URL filled from VITE_SUPABASE_URL (Netlify takes it as is; the `rewrites`
 *     build step, `site` phase, after the bundle),
 *   - renders `deploy/nginx/templates/rewrites.inc.template` from it, a `location` per rule (nginx fills ${SUPABASE_URL}
 *     from the environment at start), the app's fallback last,
 *   - and checks the file against what the site's modules need (NEEDS below: the paths the functions answer at) — a
 *     rule a module on needs and the file lacks, or one for a module that is off, is refused.
 *
 *   node build/rewrites.mjs            write the nginx template (and dist/_redirects when dist/ is there)
 *   node build/rewrites.mjs --check    refuse a file that does not cover the modules, or a stale nginx template
 *   node build/rewrites.mjs --print    the rules, parsed, as JSON
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadSite, deploymentShape } from './site.mjs'
import { sites as discoverSites, workspaceRoot, siteNameFor } from './sites.mjs'

export const FILE = 'deploy/_redirects'
export const PLACEHOLDER = '$SUPABASE_URL'

/* what the functions answer at, by the modules that switch them on — the check's side; the file is the rules' */
export const NEEDS = [
  /* ONE ROOM PER API, named for what it does. The host strips the room and the function sees the
     product's own path, so no function knows about the prefix and no two rooms can collide. The
     order below is the file's order; nothing depends on it for correctness. */
  { source: '/api/content/*', fn: 'content', when: ['api', 'content'] },
  { source: '/api/media/*', fn: 'images', when: ['api', 'content'] },
  { source: '/api/desk/*', fn: 'support-api', when: ['api', 'support'] },
  { source: '/api/scheduling/*', fn: 'scheduling-api', when: ['api', 'sessions'] },
  { source: '/api/forms/*', fn: 'forms-api', when: ['api', 'forms'] },
  { source: '/api/events/*', fn: 'ingest', when: [] },
  { source: '/api/store/*', fn: 'storefront-api', when: ['api', 'store'] },
  /* the store's alias, last under the prefix: Shopify's client discards a path on its storeDomain
     and asks for /api/<version>/graphql.json whatever it is given, so the same door is there too */
  { source: '/api/*', fn: 'storefront-api', when: ['api', 'store'] },
  /* THE SOCIAL NETWORK'S DOORS: an atproto client asks /xrpc/<method> at the root of the host it was
     given, and resolves a handle at that host's /.well-known — neither can carry a room */
  { source: '/xrpc/*', fn: 'atproto', when: ['network'] },
  { source: '/.well-known/atproto-did', fn: 'atproto', when: ['network'] },
  { source: '/.well-known/did.json', fn: 'atproto', when: ['network'] },
  /* the app's own backend, which is not an API and has no room: the Edge Functions gateway on
     this site's domain. It can never be renamed — the links in mail already sent point at it. */
  { source: '/v1/*', fn: '', when: [] },
]
const HOLDS = { network: (m) => m.network !== false, api: (m) => m.api !== false, sessions: (m) => m.sessions !== false, store: (m) => m.store !== false, support: (m) => m.support !== false, forms: (m) => m.forms !== false, content: (m) => ['articles', 'books', 'wiki', 'docs', 'models'].some((k) => m[k] !== false) }
export const needsFor = (modules = {}) => NEEDS.filter((n) => n.when.every((w) => HOLDS[w](modules)))

/* the file → rules: { source, to, status, comment } — a rule's comment is the comment lines just above it */
export function parseRedirects(text) {
  const rules = []
  let comment = []
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line) { comment = []; continue }
    if (line.startsWith('#')) { comment.push(line.replace(/^#\s?/, '')); continue }
    const [source, to, status = '200'] = line.split(/\s+/)
    if (!source || !to) throw new Error(`${FILE}: a rule is "source destination status" — got "${line}"`)
    rules.push({ source, to, status: Number(status), comment: comment.join(' ') })
    comment = []
  }
  return rules
}
export const readRedirects = (root) => parseRedirects(fs.readFileSync(path.join(root, FILE), 'utf8'))

/* the file with $SUPABASE_URL filled — dist/_redirects */
export const fillRedirects = (text, supabaseUrl) => String(text).split(PLACEHOLDER).join(String(supabaseUrl || '').replace(/\/+$/, ''))

/* nginx: a `location` per proxy rule (a destination on $SUPABASE_URL), the app's fallback for `/* /index.html 200` */
/*
 * A RULE NGINX IMPLEMENTS ITS OWN WAY, so it is left out of the generated include.
 *
 * The share pictures are file-first: the one the build photographed where there is one, and only a
 * missing one drawn by something else. On a host whose redirects apply only when no file matches —
 * Netlify's rule, and the reason this file is in Netlify's format — the plain rule gives exactly
 * that, pointing at the share-image function. nginx gets the same behaviour from prerender.inc,
 * with the sidecar in place of the function, and rendering the rule here as well would be a second
 * `location ^~ /share/` and a refusal to start.
 *
 * So the rule belongs in the file (it is what a host must do) and not in the nginx template.
 */
export const NGINX_OWN = { '/share/*': 'prerender.inc serves the baked file first and photographs a missing one with the sidecar' }

export function renderNginx(rules, { appFallback = true } = {}) {
  const out = [
    `# generated by packages/kit/build/rewrites.mjs from ${FILE} — never edited by hand (node packages/kit/build/rewrites.mjs writes it; --check holds it)`,
    '# one location per rule, in the file\'s order; nginx fills ${SUPABASE_URL} from the environment at start (the image\'s envsubst on /etc/nginx/templates)',
    '',
  ]
  for (const r of rules) {
    if (NGINX_OWN[r.source]) continue
    if (r.to.startsWith(PLACEHOLDER) && !r.source.includes('*')) {
      /* one address, proxied exactly (the analytics door: one path, not a prefix) */
      out.push(r.comment ? '# ' + r.comment : '', `location = ${r.source} {`, `  proxy_pass ${'${SUPABASE_URL}'}${r.to.slice(PLACEHOLDER.length)};`, '  include /etc/nginx/conf.d/functions-proxy.inc;', '}')
    } else if (r.to.startsWith(PLACEHOLDER)) {
      const src = r.source.replace(/\*$/, ''), dst = r.to.slice(PLACEHOLDER.length).replace(/:splat$/, '')
      if (!r.source.endsWith('/*') || !r.to.endsWith(':splat')) throw new Error(`${FILE}: a proxy rule is "/prefix/* ${PLACEHOLDER}/…/:splat 200" — got "${r.source} ${r.to}"`)
      /* The prefix alone, with no trailing slash, would be taken by nginx's directory redirect and
         301 to <prefix>/ — which would hand /api, the reference page, to the store's function. So it
         is pinned to the app with an exact location. Unless another rule already claims that exact
         path (the events door is one address, /api/events): two locations for it is something nginx
         refuses to start on, and that rule is the one that should win. */
      const claimed = rules.some((x) => x !== r && x.source === src.replace(/\/$/, ''))
      out.push(r.comment ? '# ' + r.comment : '')
      if (!claimed) out.push(`location = ${src.replace(/\/$/, '')} {`, `  try_files ${src}index.html /index.html;`, '}')
      out.push(`location ^~ ${src} {`, `  proxy_pass \${SUPABASE_URL}${dst};`, '  include /etc/nginx/conf.d/functions-proxy.inc;', '}')
    } else if (r.source === '/*' && r.to === '/index.html' && r.status === 200) {
      if (!appFallback) continue
      /* the catch-all hands an unmatched path to @page rather than straight to the shell, so the
         crawler branch has somewhere to live (default.conf defines @page, and prerender.inc gives
         it either the sidecar or an inert stub). A host without nginx — Netlify, Render — takes the
         plain rule from _redirects and knows nothing of this. */
      out.push(r.comment ? '# ' + r.comment : '', 'location / {', '  try_files $uri $uri/index.html @page;', '}')
    } else if (!r.source.includes('*') && r.to.startsWith('/') && r.status === 200) {
      /* one file of the build served at a second address (the widget's script under /api, where a
         Chatwoot snippet's baseUrl puts it): an exact location handing nginx the file it already has */
      out.push(r.comment ? '# ' + r.comment : '', `location = ${r.source} {`, `  try_files ${r.to} =404;`, '}')
    } else throw new Error(`${FILE}: nginx cannot say "${r.source} ${r.to} ${r.status}" — a rule is a proxy to ${PLACEHOLDER}/functions/v1/…, one file of the build at a second address (an exact source, a path for a destination), or the app's fallback (/* /index.html 200)`)
  }
  out.push('')
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

/* the check: every need covered by a rule to its function; no rule for a function whose module is off; the fallback last */
export function checkRules(rules, modules = {}) {
  const faults = []
  const need = needsFor(modules)
  for (const n of need) {
    const r = rules.find((x) => x.source === n.source)
    const want = `${PLACEHOLDER}/functions/v1/${n.fn ? n.fn + '/' : ''}`
    if (!r) faults.push(`${n.source} is needed (${n.fn || 'the functions'}) and ${FILE} has no rule for it`)
    else if (!r.to.startsWith(want) || r.status !== 200) faults.push(`${n.source} must rewrite to ${want}… with status 200 — the file says ${r.to} ${r.status}`)
  }
  for (const x of NEEDS) if (!need.includes(x) && rules.some((r) => r.source === x.source)) faults.push(`${x.source} is in ${FILE} but its module is off on this site — remove the rule`)
  const last = rules[rules.length - 1]
  if (!last || last.source !== '/*' || last.to !== '/index.html' || last.status !== 200) faults.push(`the last rule must be the app's fallback: /* /index.html 200`)
  const order = rules.map((r) => r.source); const v1 = order.indexOf('/v1/*')
  for (const s of NEEDS.map((n) => n.source).filter((x) => x !== '/v1/*')) if (order.includes(s) && v1 >= 0 && order.indexOf(s) > v1) faults.push(`${s} must come before /v1/* (a host takes the first match)`)
  return faults
}

const enabledFor = (rule, modules) => {
  if (rule.source === '/*' || rule.source === '/api/events' || rule.source === '/api/events/*' || rule.source === '/v1/*') return true
  if (rule.source === '/share/*') return modules.api !== false
  if (rule.source === '/api/desk/packs/js/sdk.js') return modules.support !== false
  const need = NEEDS.find((item) => item.source === rule.source)
  return !need || need.when.every((key) => HOLDS[key](modules))
}

export function siteRules(defaultRules, localRules = [], modules = {}) {
  const merged = defaultRules.filter((rule) => enabledFor(rule, modules)).map((rule) => ({ ...rule }))
  const positions = new Map(merged.map((rule, index) => [rule.source, index]))
  const seen = new Set()
  for (const rule of localRules) {
    if (seen.has(rule.source)) throw new Error(`site redirects contain "${rule.source}" more than once`)
    seen.add(rule.source)
    const index = positions.get(rule.source)
    if (index !== undefined) {
      merged[index] = rule
      continue
    }
    const fallback = merged.findIndex((item) => item.source === '/*')
    const functionsDoor = merged.findIndex((item) => item.source === '/v1/*')
    const insertion = rule.source.startsWith('/api/') && functionsDoor >= 0 ? functionsDoor : fallback
    merged.splice(insertion < 0 ? merged.length : insertion, 0, rule)
  }
  return merged
}

function mergedText(rules) {
  return rules.map(({ source, to, status, comment }) => `${comment ? `# ${comment}\n` : ''}${source} ${to} ${status}`).join('\n') + '\n'
}

async function buildForSite(root, site, defaultRules, { check, env }) {
  const config = await loadSite(site.directory)
  if (deploymentShape(config).backend === false) return { skipped: true }
  const localFile = site.root ? null : path.join(site.directory, '_redirects')
  const localText = localFile && fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : ''
  const rules = siteRules(defaultRules, localText ? parseRedirects(localText) : [], config.modules || {})
  const faults = checkRules(rules, config.modules || {})
  if (faults.length) throw new Error(`${site.name}: ${faults.join('\n  ')}`)
  const nginx = renderNginx(rules, { appFallback: false })
  const output = path.join(root, 'deploy', 'nginx', 'templates', `rewrites.${site.name}.inc.template`)
  if (check) {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== nginx) throw new Error(`${path.relative(root, output)} is stale — run node packages/kit/build/rewrites.mjs`)
  } else {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, nginx)
  }
  if (path.resolve(process.cwd()) === path.resolve(site.directory)) {
    const dist = path.join(site.directory, 'dist')
    const url = env.VITE_SUPABASE_URL || ''
    if (!check && fs.existsSync(dist) && url) fs.writeFileSync(path.join(dist, '_redirects'), fillRedirects(mergedText(rules), url))
  }
  return { rules, output }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const cwd = path.resolve(process.cwd())
  const ROOT = workspaceRoot(cwd)
  const check = process.argv.includes('--check')
  const selectedName = cwd === ROOT ? null : siteNameFor(ROOT, cwd, process.env)
  const allSites = discoverSites(ROOT, process.env)
  const selected = selectedName ? allSites.filter((site) => site.name === selectedName) : allSites
  try {
    if (!selected.length) throw new Error('no sites are selected; set PLATFORMKIT_ROOT_SITE for a root site')
    const defaultFile = path.join(ROOT, FILE)
    if (!fs.existsSync(defaultFile)) throw new Error(`the checkout has no ${FILE}`)
    const defaultText = fs.readFileSync(defaultFile, 'utf8')
    const defaultRules = parseRedirects(defaultText)
    const targets = selected
    let count = 0
    for (const site of targets) {
      const result = await buildForSite(ROOT, site, defaultRules, { check, env: process.env })
      if (!result.skipped) count += 1
    }

    if (!selectedName) {
      const config = await loadSite(ROOT)
      if (deploymentShape(config).backend !== false) {
        const rootRules = siteRules(defaultRules, [], config.modules || {})
        const faults = checkRules(rootRules, config.modules || {})
        if (faults.length) throw new Error(`root site: ${faults.join('\n  ')}`)
        const nginxFile = path.join(ROOT, 'deploy', 'nginx', 'templates', 'rewrites.inc.template')
        const nginx = renderNginx(rootRules)
        if (check) {
          if (!fs.existsSync(nginxFile) || fs.readFileSync(nginxFile, 'utf8') !== nginx) throw new Error('deploy/nginx/templates/rewrites.inc.template is stale — run node packages/kit/build/rewrites.mjs')
        } else {
          fs.mkdirSync(path.dirname(nginxFile), { recursive: true })
          fs.writeFileSync(nginxFile, nginx)
          const dist = path.join(ROOT, 'dist')
          const url = process.env.VITE_SUPABASE_URL || ''
          if (fs.existsSync(dist) && url) fs.writeFileSync(path.join(dist, '_redirects'), fillRedirects(mergedText(rootRules), url))
        }
        count += 1
      }
    }
    console.log(`✔ rewrites: ${count} site-specific rule set(s) ${check ? 'checked' : 'written'}`)
  } catch (error) {
    console.error(`✖ rewrites: ${error.message}`)
    process.exitCode = 1
  }
}
