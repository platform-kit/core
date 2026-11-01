#!/usr/bin/env node
/*
 * The drop-in analytics script: src/sdk/posthog.js (PostHog's surface over the shared core, sdk/core.js) built as one
 * file with nothing of the site in it — dist/analytics.js, served with the site at /analytics.js, and the same file at
 * dist/static/array.js, where PostHog's own snippet looks with api_host set to this site. Run by `platformkit build`
 * (the analytics-sdk step, before the prerender) and by hand: node build/analytics-sdk.mjs — the dev server serves
 * both paths from dist/ when they are there.
 */
import path from 'node:path'
import fs from 'node:fs'
/* where the drop-in scripts go: the site's dist/, or the end-to-end run's own (PLATFORMKIT_DIST), so a run never rewrites a dev build's */
const DIST = process.env.PLATFORMKIT_DIST || 'dist'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { gzipSync } from 'node:zlib'

const KIT_SRC = fileURLToPath(new URL('../src/', import.meta.url))
const root = process.cwd()
const entry = path.join(KIT_SRC, 'sdk/entry.js')
await build({
  configFile: false, root, logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: DIST, emptyOutDir: false, sourcemap: false, minify: 'esbuild', target: 'es2018',
    lib: { entry, name: 'posthog', formats: ['iife'], fileName: () => 'analytics.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
const out = path.resolve(root, DIST, 'analytics.js')
fs.mkdirSync(path.resolve(root, DIST, 'static'), { recursive: true })
fs.copyFileSync(out, path.resolve(root, DIST, 'static/array.js'))
const bytes = fs.statSync(out).size, gz = gzipSync(fs.readFileSync(out)).length
console.log(`✔ analytics sdk: dist/analytics.js and dist/static/array.js — ${(bytes / 1024).toFixed(0)} KB, ${(gz / 1024).toFixed(0)} KB gzipped`)
