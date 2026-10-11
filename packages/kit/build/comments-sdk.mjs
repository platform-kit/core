/*
 * The snippet's script: the theme's src/comments-embed.js, built as one file into
 * dist/packs/js/comments.js (IIFE) after the site's own build and before the prerender, so
 * /packs/js/comments.js is served with the site.
 *
 * IT IS A FEW HUNDRED BYTES. The script draws an IFRAME of our own /embed/comments and sizes it
 * from what that page says, so nothing of ours — no Vue, no stylesheet, no client library — runs
 * in somebody else's page. It used to bundle the whole thread, which was both heavy and, worse,
 * read-only: a script on their origin cannot see a session that lives on ours, so everybody in it
 * was a guest and a guest may not comment.
 *
 * Run by the build (the comments-sdk step), and by hand: node build/comments-sdk.mjs
 */
import path from 'node:path'
import { build } from 'vite'
import { loadSite, loadTheme } from '../vite/index.mjs'

const c = await loadSite()
const theme = await loadTheme(c)
await build({
  configFile: false,
  root: c.root,
  logLevel: 'warn',
  /* the address of the database the counts are read from, and nothing else of the site's */
  envPrefix: ['VITE_'],
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,   /* the site's public/ is the site's: nothing copied beside the script */
  build: {
    outDir: 'dist/packs/js', emptyOutDir: false, cssCodeSplit: false, sourcemap: false,
    lib: { entry: path.join(theme.src, 'comments-embed.js'), name: 'PlatformKitComments', formats: ['iife'], fileName: () => 'comments.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
console.log('✔ comments sdk: dist/packs/js/comments.js')
