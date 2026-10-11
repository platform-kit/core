/*
 * The embed script: the theme's src/embed.js — a form of this site mounted on another site's page —
 * built as one file, dist/form.js (IIFE, Vue and the runner inside) with dist/form.css beside it, after
 * the site's own build and before the prerender, so /form.js is served with the site. The kit's own
 * Vite plugins, in library mode; nothing of the site's bundle is touched (the dist is not emptied).
 * Run by `platformkit build` with the forms module on, and by hand: node build/form-embed.mjs
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { platformkit, loadSite, loadTheme } from '../vite/index.mjs'
const KIT_SRC = fileURLToPath(new URL('../src/', import.meta.url))

const c = await loadSite()
if (c.modules.forms === false) { console.log('form embed: the forms module is off — nothing built'); process.exit(0) }
const theme = await loadTheme(c)
/* nothing here builds the content any more (see the plugin's `content: false`), so a run before
   anything has says so rather than failing inside a resolver */
if (!existsSync(path.join(c.root, '.velite')))
  throw new Error('the content has not been built: this is a step of the site phase — run platformkit build, or platformkit steps --run prepare first')
const entry = path.join(theme.src, 'embed.js')
await build({
  configFile: false,
  root: c.root,
  logLevel: 'warn',
  plugins: [
    /* the CRDT store and its wasm stay on the site: the embed keeps a guest's id in plain localStorage (lib/store-light.js) */
    { name: 'embed-light-store', enforce: 'pre', resolveId(id, importer) { if (/(^|\/)lib\/store\.js$/.test(id) || (id === './store.js' && importer && importer.startsWith(KIT_SRC + 'lib/'))) return path.join(KIT_SRC, 'lib/store-light.js') } },
    /* The shared diagnostic runner reaches the semantic search embedder, but forms never use it.
       Keep its top-level-await WASM out of this single-file IIFE rather than eagerly shipping it. */
    { name: 'embed-no-semantic-model', enforce: 'pre',
      resolveId(id) { if (id === '@ternlight/base') return '\0embed-no-semantic-model' },
      load(id) { if (id === '\0embed-no-semantic-model') return "export function embed() { throw new Error('Semantic embeddings are unavailable in the form embed') }" } },
    /* the compiled content, cut to what a form needs: the forms, the site record, the forms strings scope; every other
       collection empty — the runner's other screens and the libraries import them by name and never read them here */
    { name: 'embed-content', enforce: 'pre',
      resolveId(id) { const v = path.join(c.root, '.velite'); if (id === '#content' || id === v || id === path.join(v, 'index.js')) return '\0embed-content' },   /* the plugin's alias has turned #content into the path by the time this runs */
      load(id) {
        if (id !== '\0embed-content') return
        const dir = path.join(c.root, '.velite')
        const names = [...fs.readFileSync(path.join(dir, 'index.js'), 'utf8').matchAll(/export \{ default as (\w+) \} from '\.\/(\w+)\.json'/g)].map((m) => [m[1], m[2]])
        const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f + '.json'), 'utf8'))
        return names.map(([name, file]) => {
          if (name === 'forms' || name === 'site') return `export const ${name} = ${JSON.stringify(read(file))}`
          if (name === 'ui') return `export const ui = ${JSON.stringify(read(file).filter((x) => x.scope === 'forms'))}`
          const v = read(file)
          return `export const ${name} = ${Array.isArray(v) ? '[]' : '{}'}`
        }).join('\n')
      } },
    /* a step of the SITE phase: velite and everything derived from it are already written, and
       rebuilding them here cost three extra runs of the search index's embeddings per build */
    ...(await platformkit({ config: c, content: false })),
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist', emptyOutDir: false, cssCodeSplit: false, sourcemap: false,
    lib: { entry, name: 'PlatformKitForm', formats: ['iife'], fileName: () => 'form.js' },
    rollupOptions: { output: { assetFileNames: (a) => (a.name && a.name.endsWith('.css') ? 'form.css' : 'form-[name][extname]'), inlineDynamicImports: true } },
  },
})
console.log('✔ form embed: dist/form.js and dist/form.css')
