/*
 * The snippet's script: the theme's src/support-embed.js — the support widget on another site's page, answering
 * Chatwoot's website snippet — built as one file, dist/packs/js/sdk.js (IIFE, Vue and the widget inside, the css
 * inlined), after the site's own build and before the prerender, so /packs/js/sdk.js is served with the site (the dev
 * server serves dist/ paths when they are there). Built the way the form embed is: the light store in place of the
 * CRDT one, the content cut to what the widget needs (the site, the support and auth strings, the prompts). Run by
 * `platformkit build` with the support module on (the support-sdk step), and by hand: node build/support-sdk.mjs
 */
import path from 'node:path'
/* where the drop-in scripts go: the site's dist/, or the end-to-end run's own (PLATFORMKIT_DIST), so a run never rewrites a dev build's */
const DIST = process.env.PLATFORMKIT_DIST || 'dist'
import { existsSync } from 'node:fs'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { platformkit, loadSite, loadTheme, publicSite } from '../vite/index.mjs'
const KIT_SRC = fileURLToPath(new URL('../src/', import.meta.url))

const c = await loadSite()
if (c.modules.support === false) { console.log('support sdk: the support module is off — nothing built'); process.exit(0) }
const theme = await loadTheme(c)
/* nothing here builds the content any more (see the plugin's `content: false`), so a run before
   anything has says so rather than failing inside a resolver */
if (!existsSync(path.join(c.root, '.velite')))
  throw new Error('the content has not been built: this is a step of the site phase — run platformkit build, or platformkit steps --run prepare first')
const entry = path.join(theme.src, 'support-embed.js')
await build({
  configFile: false,
  root: c.root,
  logLevel: 'warn',
  plugins: [
    { name: 'support-site-api', enforce: 'pre',
      resolveId(id) {
        if (id === '#site') return '\0support-site-api'
        if (id === '#site/routes') return '\0support-site-routes'
      },
      load(id) {
        if (id === '\0support-site-routes') return 'export const routes = []'
        if (id !== '\0support-site-api') return
        const site = publicSite(c)
        const places = site.community.places.map(({ key, word, icon, wide, shows, claims }) => ({ key, word, icon, wide, shows, claims }))
        return `const site = ${JSON.stringify(site)}
export default site
export const api = site.api
export const modules = site.modules
export const moduleKeys = ${JSON.stringify(c.moduleKeys)}
export const places = ${JSON.stringify(places)}`
      } },
    { name: 'embed-light-store', enforce: 'pre', resolveId(id, importer) { if (/(^|\/)lib\/store\.js$/.test(id) || (/^\.\.?\/(\.\.\/)*store\.js$/.test(id) && importer && importer.startsWith(KIT_SRC + 'lib/'))) return path.join(KIT_SRC, 'lib/store-light.js') } },
    /* Keep the smaller APIs local to the widget; the rest of the theme still needs the full modules. */
    { name: 'embed-light-content', enforce: 'pre', resolveId(id, importer) {
      const supportComponent = importer && importer.startsWith(path.join(theme.src, 'components/support') + path.sep)
      const supportDependency = importer && (
        importer.startsWith(path.join(KIT_SRC, 'lib/support') + path.sep) ||
        importer === path.join(KIT_SRC, 'lib/auth.js') ||
        importer === path.join(KIT_SRC, 'lib/lockdown.js')
      )
      const supportVoiceRecorder = importer && importer.startsWith(path.join(theme.src, 'components/chat/VoiceRecorder.vue'))
      if (/(^|\/)lib\/content\.js$/.test(id) && (supportComponent || supportDependency))
        return path.join(KIT_SRC, 'lib/strings.js')
      if (/(^|\/)lib\/chat\/recorder\.js$/.test(id) && (supportComponent || supportVoiceRecorder))
        return path.join(KIT_SRC, 'lib/chat/recorder-light.js')
      return null
    } },
    { name: 'embed-content', enforce: 'pre',
      resolveId(id) { const v = path.join(c.root, '.velite'); if (id === '#content' || id === v || id === path.join(v, 'index.js')) return '\0embed-content' },
      load(id) {
        if (id !== '\0embed-content') return
        const dir = path.join(c.root, '.velite')
        const names = [...fs.readFileSync(path.join(dir, 'index.js'), 'utf8').matchAll(/export \{ default as (\w+) \} from '\.\/(\w+)\.json'/g)].map((m) => [m[1], m[2]])
        const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f + '.json'), 'utf8'))
        return names.map(([name, file]) => {
          if (name === 'site') return `export const ${name} = ${JSON.stringify(read(file))}`
          if (name === 'ui') return `export const ui = ${JSON.stringify(read(file).filter((x) => ['support', 'auth', 'chat'].includes(x.scope)))}`
          const v = read(file)
          return `export const ${name} = ${Array.isArray(v) ? '[]' : '{}'}`
        }).join('\n')
      } },
    /* a step of the SITE phase: velite and everything derived from it are already written, and
       rebuilding them here cost three extra runs of the search index's embeddings per build */
    ...(await platformkit({ config: c, content: false })),
    /* the css inlined into the script, so one file is the whole snippet */
    { name: 'embed-inline-css', enforce: 'post', generateBundle(_, bundle) { let css = ''; for (const [k, a] of Object.entries(bundle)) if (a.type === 'asset' && k.endsWith('.css')) { css += String(a.source); delete bundle[k] } const js = Object.values(bundle).find((x) => x.type === 'chunk'); if (js && css) js.code = `(function(){var s=document.createElement('style');s.setAttribute('data-platformkit-support-css','');s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();\n` + js.code } },
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,   /* the site's public/ is the site's: nothing copied beside the script */
  build: {
    outDir: path.join(DIST, 'packs/js'), emptyOutDir: false, cssCodeSplit: false, sourcemap: false,
    lib: { entry, name: 'PlatformKitSupport', formats: ['iife'], fileName: () => 'sdk.js' },
    rollupOptions: { output: { assetFileNames: 'sdk-[name][extname]', inlineDynamicImports: true } },
  },
})
console.log('✔ support sdk: dist/packs/js/sdk.js')
