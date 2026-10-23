/*
 * The kit's Vite plugin — how a site runs: `platformkit()` in the site's vite.config.js is the whole
 * config. It reads platformkit.config.js from the site's root (cwd), runs velite over the site's
 * content, then the kit's post-steps (the search embedding, the sales report, the funnels' prompts),
 * mounts the admin's content API in dev, serves the uploads, and answers the modules a site is
 * reached through (each written to .platformkit/site/ too, so the dev server's dependency scan sees
 * the site's own imports — see site() below):
 *
 *   #site         the config, serialisable parts only (name, modules, looks' names, languages …)
 *   #site/looks   imports every look's css; exports LOOKS (names) and DEFAULT_LOOK
 *   #site/landing exports SKINS_BY_LOOK — each look's skins module, by look — and the site's SECTIONS, SECTION_SCHEMAS, STAGES (the hero's visuals) and STAGE_SCHEMAS
 *   #site/app     exports tabs — the site's own /app tabs, their components imported
 *   #site/routes  exports routes — the site's own pages, their components imported
 *   #site/nav     exports links and cta — the header's, or null for the theme's default
 *   #site/analytics exports panels — the site's own panels on the admin's content analytics
 *   #site/instrument the site's instrument: the component /app mounts and the vocabulary the admin names a reading by (INSTRUMENT)
 *   #site/recommendations the site's recommendation scorer: the reader's profile, its books, its signals (RECOMMENDATIONS)
 *   #site/permissions   the site's own permission rules, run after the kit's (PERMISSIONS)
 *   #site/admin   exports sections — the site's own admin sections, their components imported
 *   #site/content/* the site's content directory (a raw file, print.json say); #content/* its .velite
 *
 * Overrides: a site replaces any theme component by name (platformkit.config.js `overrides`): every
 * import that lands on the theme's <Name>.vue is answered with the site's file, wherever it is written
 * — except from the override itself, which gets the original, so a site can wrap as well as replace.
 *
 * Aliases: #content → the site's .velite; @ → the theme's src (the shadcn-vue layer imports by @/).
 */
import fs from 'node:fs'
import path from 'node:path'
import { gatesOf } from '../src/lib/member-panels.js'
import { loadSite, publicSite, communityOf, avatarsOf, INSTRUMENT, RECOMMENDATIONS, PERMISSIONS, DESK, deskSourcesOf, navOf, ctaOf } from '../build/site.mjs'
import { loadTheme, resolveOverrides } from '../build/theme.mjs'
export { loadSite, publicSite, loadTheme, resolveOverrides }
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import { adminServer } from '../build/admin-server.mjs'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { tailwindConfig } from './tailwind.config.js'
import { resolveSiteHomeHead } from '../src/lib/seo-head.js'
import { loadEnv } from 'vite'

/*
 * THE SOCIAL NETWORK'S DOORS, IN DEVELOPMENT. An atproto client asks /xrpc/<method> at the ROOT of
 * the host it was given and resolves a handle at that host's /.well-known — so the site's own
 * address must answer them, as the host's rewrites do in production (deploy/_redirects). The dev
 * server proxies the same three paths to the atproto function, telling it the host it was asked on.
 */
function networkProxy(c, mode) {
  if ((c.modules || {}).network === false) return undefined
  const env = loadEnv(mode || 'development', c.root, '')
  const target = String(process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  if (!target) return undefined
  const door = { target, changeOrigin: true, xfwd: true, rewrite: (p) => '/functions/v1/atproto' + p }
  return { '/xrpc': door, '/.well-known/atproto-did': door, '/.well-known/did.json': door }
}


function site(c, theme, keys = []) {
  const overrides = resolveOverrides(c, theme)
  const overrideFiles = new Set(Object.values(overrides))
  /* a virtual id must not hold a '#': the browser would read it as a fragment */
  const V = Object.fromEntries(['site', 'site/looks', 'site/landing', 'site/app', 'site/routes', 'site/nav', 'site/analytics', 'site/instrument', 'site/recommendations', 'site/admin', 'site/member', 'site/permissions', 'site/desk', 'site/strings-default'].map((k) => ['#' + k, '\0platformkit:' + k.replace('/', '-')]))
  const abs = (p) => path.resolve(c.root, p)
  const J = JSON.stringify
  /* where the generated modules are written (see writeFiles below), and how one imports a site's file from there:
     relatively, because Vite's dependency scan takes an import whose specifier is already its resolved path for an
     external one and follows it no further */
  const dir = path.join(c.root, '.platformkit', 'site')
  /* a site's file, relative to the generated module; a package path (the kit's own place) as it is */
  const from = (p) => { if (/^platformkit\//.test(p)) return p; const r = path.relative(dir, path.resolve(c.root, p)).split(path.sep).join('/'); return r.startsWith('.') ? r : './' + r }
  /* a contract module: every name the kit and the theme may import, from the site's module when it exports it, else the default */
  const contract = (mod, names) => (mod ? `import * as M from ${J(from(mod))}\n` : '') + Object.entries(names).map(([k, d]) => `export const ${k} = ${mod ? `M.${k} !== undefined ? M.${k} : (${d})` : d}`).join('\n') + '\n'
  /* what each virtual module is: the code its id is answered with, generated from the config */
  const generate = async (id) => {
    if (id === V['#site']) return `export default ${JSON.stringify(publicSite(c))}\n/* the community's registered places, each page fetched when it is first opened */\nexport const places = [${communityOf(c).places.map((x) => `{ ...${J({ ...x, component: undefined })}, load: () => import(${J(from(x.component))}) }`).join(', ')}]\nexport const modules = ${JSON.stringify(c.modules)}\nexport const moduleKeys = ${JSON.stringify(keys)}\nexport const api = ${JSON.stringify(publicSite(c).api)}\n`
    if (id === V['#site/looks']) {
      /*
       * A SITE THAT REGISTERS NO LOOK WEARS THE THEME'S.
       *
       * This used to import `c.looks` and nothing else, so a site with none imported no palette
       * at all: `data-look` was still stamped, every `var(--x)` fell through to an undefined
       * custom property, and the landing's button resolved its text and its background to the
       * same value. sites/brochure had that fault for months and escaped notice only by having
       * no landing page.
       *
       * `LOOKS` still reports what the SITE declared, so a site with none offers no look
       * switcher — the theme's default is what it wears, not a choice it presents.
       */
      if (!Object.keys(c.looks).length && theme && theme.look && theme.look.css) {
        const css = path.resolve(theme.src, theme.look.css)
        return `import ${J(from(css))}\nexport const LOOKS = []\nexport const DEFAULT_LOOK = ${J(theme.look.name)}\n`
      }
      const names = Object.keys(c.looks)
      return names.map((n) => `import ${J(from(c.looks[n].css))}`).join('\n') + `\nexport const LOOKS = ${JSON.stringify(names)}\nexport const DEFAULT_LOOK = ${JSON.stringify(c.defaultLook)}\n`
    }
    if (id === V['#site/landing']) {
      const withSkins = Object.entries(c.looks).filter(([, l]) => l.skins)
      /* and the site's own landing section types: `sections`, a module exporting SECTIONS (name → component), and `schemas`, one exporting
         SECTION_SCHEMAS (name → schema entry) with no component in it, so the admin server can read it under Node */
      const L = c.landing || {}
      const sec = (L.sections ? `import { SECTIONS as SS } from ${J(from(L.sections))}\nexport const SECTIONS = SS\n` : 'export const SECTIONS = {}\n') + (L.schemas ? `import * as SC from ${J(from(L.schemas))}\nexport const SECTION_SCHEMAS = SC.SECTION_SCHEMAS || {}\nexport const STAGE_SCHEMAS = SC.STAGE_SCHEMAS || {}\n` : 'export const SECTION_SCHEMAS = {}\nexport const STAGE_SCHEMAS = {}\n')
      /* and the site's stages for the hero's visual: `stages`, a module exporting STAGES (key → component); their schemas are STAGE_SCHEMAS in `schemas` */
      const stg = L.stages ? `import { STAGES as ST } from ${J(from(L.stages))}\nexport const STAGES = ST\n` : 'export const STAGES = {}\n'
      return withSkins.map(([n, l], i) => `import { SKINS as s${i} } from ${J(from(l.skins))}`).join('\n') + `\nexport const SKINS_BY_LOOK = { ${withSkins.map(([n], i) => `${J(n)}: s${i}`).join(', ')} }\n` + sec + stg
    }
    if (id === V['#site/app']) {
      /* the site's own /app tabs: a module (app.tabs: './src/….js') exporting `tabs` — each { key, module?, component, start?, props?, on?, first?, label?, card? } —
         and optionally `answered`; or, for tabs with no code of their own, the list inline: [{ key, label, card?, module?, component: './src/….vue' }] */
      const tabs = (c.app && c.app.tabs) || []
      if (typeof tabs === 'string') return `import * as M from ${J(from(tabs))}\nexport const tabs = M.tabs || []\nexport const answered = M.answered || null\n`
      return tabs.map((t, i) => `import T${i} from ${J(from(t.component))}`).join('\n') + `\nexport const tabs = [${tabs.map((t, i) => `{ ...${J({ key: t.key, label: t.label, card: t.card, module: t.module })}, component: T${i} }`).join(', ')}]\nexport const answered = null\n`
    }
    if (id === V['#site/routes']) {
      /*
       * the site's own pages: { path, component: './src/….vue', prefix?: true (the path and
       * everything under it), prerender?: false, module?: 'x' }
       *
       * `module` is what makes a route a MODULE'S rather than merely the site's: a route whose
       * module is off is dropped here, so it is not in the bundle at all and the router never
       * learns of it — the same timing as the kit's own KINDS_ON, and stronger than a runtime
       * guard, which would ship the component and then decline to show it.
       *
       * A route naming a module nobody declares is refused rather than silently answered, for
       * the reason `moduleOn` throws: `modules.stor !== false` is TRUE, so a typo here would
       * make the route unconditional, which is the opposite of what was written.
       */
      const strange = (c.routes || []).filter((r) => r.module && !keys.includes(r.module))
      if (strange.length) throw new Error('a route is gated on a module no manifest declares: ' + strange.map((r) => `${r.path} → ${r.module}`).join(', '))
      const routes = (c.routes || []).filter((r) => !r.module || (c.modules || {})[r.module] !== false)
      return routes.map((r, i) => `import R${i} from ${J(from(r.component))}`).join('\n') + `\nexport const routes = [${routes.map((r, i) => `{ ...${J({ path: r.path, prefix: !!r.prefix })}, component: R${i} }`).join(', ')}]\n`
    }
    if (id === V['#site/nav']) {
      /* THE MIDDLE LAYER. The header has three — the theme's own by rule, this, and a nav in
         content/site.md that an administrator edits — and the most specific that EXISTS is the
         whole list, never a merge. This module answers only what the config said, normalised into
         the one item shape lib/nav.js resolves; null means the config said nothing, which is a
         different thing from an empty header and is why nothing is defaulted here. */
      return `export const links = ${J(navOf(c))}\nexport const cta = ${J(ctaOf(c))}\n`
    }
    if (id === V['#site/analytics']) {
      /* panels added to the admin's content analytics: { key, component } */
      const panels = (c.analytics && c.analytics.panels) || []
      /* the site's own events (a key, a label, goal, value) and its sources' names — never a source's key or hosts */
      const events = ((c.analytics && c.analytics.events) || []).map((e) => ({ key: String(e.key || ''), label: String(e.label || e.key || ''), goal: !!e.goal, value: e.value ? String(e.value) : null })).filter((e) => e.key)
      const sources = ((c.analytics && c.analytics.sources) || []).map((s) => ({ name: String(s.name || '') })).filter((s) => s.name)
      return panels.map((t, i) => `import P${i} from ${J(from(t.component))}`).join('\n') + `\nexport const panels = [${panels.map((t, i) => `{ key: ${J(t.key)}, component: P${i} }`).join(', ')}]\nexport const events = ${J(events)}\nexport const sources = ${J(sources)}\n`
    }
    if (id === V['#site/admin']) {
      /* the site's own admin sections: a module exporting `sections` — each { sec, key, label, icon?, module?, title?, lead?, component } */
      const m = c.admin && c.admin.sections
      return m ? `import * as M from ${J(from(m))}\nexport const sections = M.sections || []\n` : 'export const sections = []\n'
    }
    if (id === V['#site/instrument']) return contract(c.modules.instrument && c.instrument && c.instrument.module, INSTRUMENT)
    if (id === V['#site/recommendations']) return contract(c.modules.recommendations && c.recommendations && c.recommendations.module, RECOMMENDATIONS)
    /* the site's own permission rules, run after the kit's (build/permissions.js) */
    if (id === V['#site/permissions']) return contract(c.permissions, PERMISSIONS)
    /* THE MEMBER CARD'S PRIVATE HALF: the kit's panels whose module the site has on (Working with its own instrument,
       Read with a library, Bought with the store), then the site's own module, if it names one (spaces.member), turning
       kit panels off, adding its own and setting the order */
    if (id === V['#site/member']) {
      const site = c.modules.spaces && c.spaces && c.spaces.member
      return `import { kitPanels } from 'platformkit/theme/components/spaces/panels/index.js'\nimport { arrange } from 'platformkit/lib/member-panels.js'\n`
        + (site ? `import * as M from ${J(from(site))}\n` : 'const M = {}\n')
        + `export const panels = arrange(kitPanels, ${JSON.stringify(gatesOf(c))}, M)\n`
    }
    if (id === V['#site/desk']) return contract(deskSourcesOf(c).sources, DESK)
    /*
     * THE THEME'S OWN WORDS, as the fallback under every string the app reads.
     *
     * The site's `content/app/ui/*.md` is merged over the theme's at BUILD time and the result is
     * the `ui` collection — so a key neither file has, or a key the theme gained since the last
     * compile, resolves to nothing at all. On a label that is the whole of a control, nothing is a
     * control zero pixels wide, which is how the face designer came to sit behind a button nobody
     * could see. Shipping the theme's defaults as data gives `us()` something to fall back to
     * without a single English word in a component.
     */
    if (id === V['#site/strings-default']) {
      const { readScopes } = await import('platformkit/build/strings-io.mjs')
      const scopes = readScopes(theme.strings)
      const out = {}
      for (const [k, v] of Object.entries(scopes)) out[k] = v.groups
      return `export const groups = ${JSON.stringify(out)}\n`
    }
    return null
  }
  /*
   * EVERY MODULE THAT IMPORTS THE SITE'S CODE IS A REAL FILE, in .platformkit/site/.
   *
   * Vite pre-bundles a site's packages by scanning its imports when the dev server starts, and the
   * scan stops at a virtual id by design. Answered virtually, everything behind #site/admin,
   * #site/routes and the rest — the site's own code — was unseen, so a package only the site
   * imports (an admin field's editor extensions, say) was found on the first visit to its page and
   * bundled then, mid-request: a reload at best, and at worst a dev server serving 504s for a
   * bundle it never finished. Written out, the scan follows them like any other file, and what it
   * finds is exactly what this site has switched on, because the code is the same code: a route
   * whose module is off is no more in the scan than in the bundle.
   *
   * The files are a function of the config alone, so they are written when the config is read,
   * and a change to it is already a restart. Each is still answered from here by load(), so what
   * is served never waits on the disk. Not under node_modules: the scan takes anything there for
   * a package. #site/strings-default stays virtual — it imports nothing for the scan to find.
   */
  const asFile = {}, byFile = {}
  const writeFiles = async () => {
    fs.mkdirSync(dir, { recursive: true })
    /* the folder ignores itself, so it is never committed whichever repository the site lives in */
    const ignore = path.join(dir, '..', '.gitignore')
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n')
    for (const [k, v] of Object.entries(V)) {
      if (k === '#site/strings-default') continue
      const file = path.join(dir, v.slice('\0platformkit:'.length) + '.js'), code = await generate(v)
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== code) fs.writeFileSync(file, code)
      asFile[k] = file; byFile[file] = v
    }
  }
  return {
    name: 'platformkit-site',
    enforce: 'pre',   /* before vite:resolve, which would answer #site from a package's imports map (the Node side) */
    async configResolved() { await writeFiles() },
    /* a change to platformkit.config.js is a restart, as a change to vite.config.js is: the config is read once.
       A content model's record (content/models/<key>.md) is read at velite's config time too — the collections
       are declared from it — so a model saved in the builder, added or removed touches velite.config.js, and
       velite, which watches its own config, starts over with the new collections; the site's #content follows */
    configureServer(server) {
      const cfg = abs('platformkit.config.js'), vcfg = abs('velite.config.js')
      const modelsDir = abs('content/models')
      const isModel = (f) => f.startsWith(modelsDir + path.sep) && f.endsWith('.md') && !f.slice(modelsDir.length + 1).includes(path.sep)
      server.watcher.add(cfg)
      const changed = (f) => {
        if (f === cfg) { server.config.logger.info('platformkit.config.js changed, restarting server...', { timestamp: true }); server.restart(); return }
        if (isModel(f) && fs.existsSync(vcfg)) { server.config.logger.info('a content model changed, velite starts over...', { timestamp: true }); const now = new Date(); fs.utimesSync(vcfg, now, now) }
      }
      server.watcher.on('change', changed); server.watcher.on('add', changed); server.watcher.on('unlink', changed)
    },
    async resolveId(id, importer, opts) {
      if (V[id]) return asFile[id] || V[id]
      /* an import of a theme component a site overrides: answered with the site's file */
      /* no importer, or the page as importer: the dev server serving a module by its url, which must stay itself */
      if (!importer || importer.endsWith('.html') || !id.endsWith('.vue') || !overrides[path.basename(id, '.vue')]) return null
      const name = path.basename(id, '.vue'), own = overrides[name]
      if (overrideFiles.has(importer.split('?')[0])) return null   /* the override wrapping the original */
      const r = await this.resolve(id, importer, { ...opts, skipSelf: true })
      if (!r) return null
      const file = r.id.split('?')[0]
      return file === theme.components[name] ? own : null
    },
    load(id) {
      const v = byFile[id.split('?')[0]] || id
      return Object.values(V).includes(v) ? generate(v) : null
    },
  }
}

/* velite over the site's content, then the build steps of the prepare phase (build/steps/: the search index, the
   sales report, the funnels — and a site's own); in dev, a prepare step whose inputs match a changed file runs again
   once velite has rebuilt what it reads */
async function prepare(c, changed = null, dev = false) {
  const { runPhase } = await import('../build/steps.mjs')
  await runPhase('prepare', { site: c, changed, dev, log: (m) => console.log('  ' + m) })
}
async function refresh(c, changed = null, projectLocal = true) {
  const { refreshContent } = await import('../build/content-refresh.mjs')
  await refreshContent({
    site: c, changed, projectLocal,
    log: (m) => console.log('  ' + m),
  })
}
function velite(c) {
  let command = 'build'
  return {
    name: 'platformkit-velite',
    apply: () => true,
    configResolved(cfg) { command = cfg.command },
    async buildStart() {
      if (globalThis.__veliteStarted) return
      /* ALREADY DONE, IN ANOTHER PROCESS. `platformkit build` compiles the content and runs the
         prepare steps itself before it calls vite, so this would be the second time in one build:
         velite cleaning and rewriting what it just wrote, and the prepare steps — the search
         index's two hundred and thirteen embeddings among them — paid for twice. The flag on
         globalThis cannot see across a process boundary; this is the same fact, told across one. */
      if (process.env.PLATFORMKIT_CONTENT_DONE === '1') { globalThis.__veliteStarted = true; globalThis.__prepareReady = true; return }
      globalThis.__veliteStarted = true
      /* CONTENT_ENGINE=collections runs Content Collections over the same collection definitions
         instead (build/collections.mjs). velite otherwise, which is the default and the tested path. */
      /* WHICHEVER ENGINE COMPILES THIS SITE'S CONTENT: velite by default, Content Collections with
         CONTENT_ENGINE=collections, or the site's own module when it registers content.engine
         (build/collections.mjs holds the seam and both of the kit's engines). */
      const { engineFor } = await import('../build/collections.mjs')
      const eng = await engineFor(c.root)
      if (eng.name !== 'velite') {
        await eng.build({ root: c.root, log: (m) => console.log('  ' + m) })
        await prepare(c, null, command === 'serve')
        globalThis.__prepareReady = true
        return
      }
      const { build } = await import('velite')
      /* CLEAN ON A BUILD, NEVER IN DEV. velite's clean wipes BOTH .velite and its assets output —
         which is public/static, the directory the dev server is serving the covers out of. Vite keeps
         a set of the public files it knows about and maintains it from the watcher; a directory
         removed and rewritten underneath it loses most of that set, and from then on ten of eleven
         covers answer with the SPA shell instead of a picture. The cart's thumbnails were the place
         it showed. Nothing needs cleaning in dev anyway: every file is rewritten in place, and a
         stale one costs a few kilobytes on a disk nobody ships. */
      await build({ watch: command === 'serve', clean: command !== 'serve' })
      await prepare(c, null, command === 'serve')
      globalThis.__prepareReady = true   /* the watcher below waits for this first run; velite's clean and first write fire it otherwise */
    },
    /* velite's watcher rebuilds on a content change — and on a change to velite.config.js it starts
       over with a clean .velite, which drops the post-steps' files; when its index is written again
       and the search index is gone, the post-steps run again */
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/__platformkit/site-meta') return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }
        try {
          const readCollection = (name, fallback) => {
            try { return JSON.parse(fs.readFileSync(path.join(c.root, '.velite', name + '.json'), 'utf8')) }
            catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
          }
          const rawSite = readCollection('site', {})
          const site = Array.isArray(rawSite) ? rawSite[0] : rawSite
          const head = resolveSiteHomeHead({
            site: site || {},
            pages: readCollection('pages', []),
            ui: readCollection('ui', []),
            modules: c.modules,
          })
          const projectName = typeof c.dev?.projectName === 'string' ? c.dev.projectName.trim() : ''
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ ...head, projectName }))
        } catch (error) {
          server.config.logger.error(`site directory metadata: ${error.message}`, { timestamp: true })
          res.statusCode = 503
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ error: 'metadata-unavailable' }))
        }
      })
      /* THE DROP-IN SCRIPTS, from dist/ when they have been built, each at the address the product
         it answers uses — so a snippet copied out of somebody else's docs works against the dev
         server with one line changed, which is the whole point of answering a shape people have.
           /analytics.js, /static/array.js   the analytics script (build/analytics-sdk.mjs)
           /packs/js/sdk.js                  the support widget, at Chatwoot's (build/support-sdk.mjs)
           /packs/js/comments.js             the comment thread, at Disqus's (build/comments-sdk.mjs) */
      const PACKS = {
        '/analytics.js': 'dist/analytics.js',
        '/static/array.js': 'dist/analytics.js',
        '/packs/js/sdk.js': 'dist/packs/js/sdk.js',
        '/packs/js/comments.js': 'dist/packs/js/comments.js',
      }
      server.middlewares.use((req, res, next) => {
        const u = (req.url || '').split('?')[0]
        if (!PACKS[u]) return next()
        /* the end-to-end run builds its own (PLATFORMKIT_DIST), against its own stack, and serves those */
        const f = path.resolve(c.root, process.env.PLATFORMKIT_DIST ? PACKS[u].replace(/^dist\//, process.env.PLATFORMKIT_DIST.replace(/\/$/, '') + '/') : PACKS[u])
        if (!fs.existsSync(f)) return next()
        /* an embed is read from another origin by design: that is what an embed is */
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('content-type', 'application/javascript; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(fs.readFileSync(f))
      })
      /* a content model's JSON, at the address the build writes it to (dist/data/models/<key>.json) */
      if (c.modules.models !== false) server.middlewares.use(async (req, res, next) => {
        const m = /^\/data\/models\/([a-z0-9-]+)\.json$/.exec((req.url || '').split('?')[0])
        if (!m) return next()
        const { publishedModels } = await import('../build/model-io.mjs'); const { jsonFor } = await import('../build/models.mjs')
        const out = jsonFor(c.root, (await publishedModels(c.root)).find((x) => x.key === m[1]))
        if (!out) return next()
        res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(out, null, 2) + '\n')
      })
      const index = path.resolve(c.root, '.velite/index.js'), search = path.resolve(c.root, '.velite/search.json')
      const content = path.resolve(c.root, 'content') + path.sep
      /* content changes refresh every matching compile and local projection step; once velite has written its index
         again (it rewrites .velite/index.js at the end of a rebuild of a collection's file), or, for a file no
         collection reads (a funnel, a form), a moment after the last change */
      let pending = new Set(), timer = null
      const flush = async () => {
        clearTimeout(timer); timer = null
        if (!globalThis.__prepareReady || !pending.size) return
        const list = [...pending]; pending = new Set()
        try { await refresh(c, list) } catch (e) { server.config.logger.error(String(e && e.message || e), { timestamp: true }) }
      }
      const changed = (f) => { if (!f.startsWith(content)) return; pending.add(path.relative(c.root, f)); clearTimeout(timer); timer = setTimeout(flush, 2500) }
      const settled = async (f) => {
        if (f !== index || !globalThis.__prepareReady) return
        if (!fs.existsSync(search)) {
          const list = [...pending]
          pending = new Set()
          clearTimeout(timer)
          try { await refresh(c, list.length ? list : null, false) } catch (e) { server.config.logger.error(String(e && e.message || e), { timestamp: true }) }
          return
        }
        await flush()
      }
      for (const ev of ['change', 'add', 'unlink']) server.watcher.on(ev, changed)
      server.watcher.on('change', settled); server.watcher.on('add', settled)
    },
  }
}

/* uploads through the admin live in content/uploads and are referenced as /uploads/<file>: dev serves them, a build copies them */
/*
 * THE SITE'S TYPEFACES, INTO THE HEAD.
 *
 * The three tokens every `font-family` in the theme reads used to get their values from a
 * stylesheet, and the Google Fonts link was written by hand into each site's index.html. Two places
 * that had to agree, and when they did not the page named a family it never loaded and fell back to
 * Georgia looking almost right.
 *
 * Both come from `content/site.md` now. The link goes in before the site's own stylesheets so the
 * face is on its way while the CSS parses, and the token block goes in the head rather than a
 * stylesheet so it is set before anything paints — a face that arrives after first paint is a
 * reflow the reader watches happen.
 *
 * A family the kit does not serve stops the build naming it. Quietly falling back would leave
 * somebody staring at a page that did not change.
 */
function fonts(root) {
  let head = ''
  return {
    name: 'platformkit-fonts',
    enforce: 'pre',
    async buildStart() {
      const { linkFor, tokensFor, faultsIn } = await import('../build/typefaces.mjs')
      const { readSiteFonts } = await import('../build/site-fonts.mjs')
      const chosen = readSiteFonts(root)
      const faults = faultsIn(chosen)
      if (faults.length) this.error('content/site.md names a typeface the kit does not serve:\n  ' + faults.join('\n  '))
      head = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${linkFor(chosen)}"><style>${tokensFor(chosen)}</style>`
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => (head ? html.replace('</head>', head + '</head>') : html),
    },
  }
}

function uploads() {
  return {
    name: 'platformkit-uploads', apply: 'build',
    async closeBundle() {
      const { promises: fs } = await import('node:fs')
      try { await fs.cp(path.resolve('content/uploads'), path.resolve('dist/uploads'), { recursive: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
    },
  }
}

/*
 * `content: false` LEAVES THE CONTENT PIPELINE OUT, for a build that is not the site's.
 *
 * The snippet builds (the support widget, the form embed) are steps of the SITE phase: they run
 * after the prepare phase has already put velite's output and everything derived from it in place,
 * and each is its own node process, so the guard inside the velite plugin — a flag on globalThis —
 * cannot see that the work is done. Left to itself each one rebuilt the whole pipeline: velite, the
 * tokens, the sales report, the funnels, the bots, and the search index with its two hundred and
 * thirteen embeddings. Three times per build, for a bundle that only ever READS what the first run
 * wrote.
 */
export async function platformkit(opts = {}) {
  const c = opts.config || await loadSite(opts.root)   /* a config given (a test) or the site's file */
/*
 * THE MODULES THE BROWSER IS ALLOWED TO ASK ABOUT — the kit's AND any the site registers.
 *
 * `loadSite` resolves the kit's alone, on purpose: it is assembled into the functions' pipe, and an
 * Edge Function importing a site's manifest file — a path that does not exist inside the function —
 * would throw for no reason at all. The plugin has no such problem. It runs in Node at build time,
 * in the site's own tree, so it is where the full set is resolved and handed to the browser.
 *
 * Without this, a site's own module would be a module the build knew about and `moduleOn` refused.
 */
  let keys = c.moduleKeys || []
  try {
    const { moduleSet } = await import('../build/steps.mjs')
    keys = [...(await moduleSet(c)).keys()]
  } catch (e) {
    /* a broken registration is refused where the person who wrote it is looking — the build — and
       not here, where the message would arrive as a mysterious missing module in the browser */
    throw new Error('the site\'s own module manifests could not be resolved: ' + (e && e.message ? e.message : e))
  }
  const theme = await loadTheme(c)
  const withContent = opts.content !== false
  return [
    {
      name: 'platformkit',
      config: (_cfg, env) => ({
        /* pusher-js is the email editor's optional peer for its cloud tier, reached by a dynamic import the store never takes */
        build: {
          target: 'esnext',
          /* the voice's runtime is a 26 MB wasm and is meant to be: the advice to code-split it is
             five lines of every build log, about a chunk that is already a dynamic import. What a
             bundle's size is gets reported once, by the build, as its own line */
          chunkSizeWarningLimit: 100 * 1024,
          rollupOptions: {
            external: ['pusher-js'],
            /* zod's own source carries a @__PURE__ comment rollup cannot read where it sits, and says
               so — eight paragraphs of it, every build, about a file nobody here can edit. Its code is
               dropped and every other warning is passed on, because a warning we can act on is the
               only reason to read a build log at all. */
            onwarn(w, warn) { if (w.code !== 'INVALID_ANNOTATION') warn(w) },
          },
        },
        esbuild: { target: 'esnext' },
        /*
         * TWO LIBRARIES THAT FIND THEIR OWN FILES AT RUN TIME, and must not be pre-bundled.
         *
         * onnxruntime-web resolves its runtime files itself. The Matrix crypto library resolves its
         * `.wasm` against its own `import.meta.url`: pre-bundled, that is a path under
         * `node_modules/.vite/deps`, which the dev server answers with HTML — and
         * `instantiateStreaming` refuses it as the wrong MIME type with nothing else to show that
         * anything went wrong. Served as it is, the same address is the real file and arrives as
         * `application/wasm`. A deep import of the file instead is refused: the package's exports
         * map has only one entry.
         */
        optimizeDeps: { esbuildOptions: { target: 'esnext' }, exclude: ['onnxruntime-web', '@matrix-org/matrix-sdk-crypto-wasm'] },
        /* the in-browser voice runs in a module worker whose runtime is a dynamic import */
        worker: { format: 'es' },
        /* IN_BROWSER_TTS, LOCKDOWN_MODE and CONTENT_STORE are the client flags read by name */
        envPrefix: ['VITE_', 'IN_BROWSER_TTS', 'LOCKDOWN_MODE', 'CONTENT_STORE'],
        resolve: { alias: { '#content': path.resolve(c.root, '.velite'), '#site/content': path.resolve(c.root, 'content'), '@': theme.src } },
        /* Tailwind over the theme's sources and the site's, utilities only (the kit's tailwind.config.js); a site needs no postcss config */
        css: { postcss: { plugins: [tailwindcss(tailwindConfig(c, theme)), autoprefixer()] } },
        server: { host: '0.0.0.0', proxy: networkProxy(c, env && env.mode) },   /* the port is the CLI's (dev.mjs holds one strictly) */
        preview: { host: '0.0.0.0' },
      }),
    },
    fonts(c.root),
    site(c, theme, keys),
    ...(withContent ? [velite(c)] : []),
    adminServer(),
    uploads(),
    wasm(),
    /* the .schema and .expr blocks are white-space:pre; vidstack ships web components */
    vue({ template: { compilerOptions: { whitespace: 'preserve', isCustomElement: (tag) => tag.startsWith('media-') } } }),
  ]
}
export default platformkit
