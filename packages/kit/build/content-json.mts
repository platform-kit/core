#!/usr/bin/env node
/*
 * The content index beside the functions, for the content API (content-api): everything the Delivery API answers from
 * in git mode, written once by the build so the function need not read the checkout —
 *
 *   models    every model with fields, as the admin's registry describes it (the kit's collections, the site's own,
 *             the custom models from the builder): its key, directory, whether it is single or nested, its body, its
 *             fields with their kinds and choices — the one description the content types are derived from
 *   types     the content types, derived here (_shared/api/types.js) so the function has them ready
 *   records   every file of those models, read through the store: its model, its path within the model, its
 *             frontmatter, its markdown body, whether it is published, and its times from git — first commit (created),
 *             last commit (updated), the commit count (revision); the build's time where there is no history
 *   assets    every file of the media library's two roots (content/uploads and public, less the build's own output
 *             under public/static and public/print): its address, name, size, type, and a picture's size
 *   deleted   the files of those models git shows removed, with when — the sync API's DeletedEntry rows
 *   plus the site's name, description and public address, the locales (the config's languages), whether the docs
 *   stand alone, and the space id
 *
 * Written to supabase/functions/_shared/content/index.json (gitignored, like dist: the deploy makes it before the
 * functions go up; `platformkit run content-json` makes it for a local stack). In cloud mode the function reads the
 * rows and the bucket instead (_shared/content-index.ts) and this file is not consulted.
 *
 *   node build/content-json.mjs          # write the index
 *   node build/content-json.mjs --check  # say what it would hold, write nothing
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import matter from 'gray-matter'
import { loadSite } from './site.mjs'
import { registry } from './models/index.mjs'
import { describeSchema } from './admin-schemas.mjs'
import { asStore } from './store/index.mjs'
import { contentTypes } from '../supabase/functions/_shared/api/types.js'
import { modelOfPath, pathWithin, isPublished, isRecordModel } from '../supabase/functions/_shared/api/records.js'
import { mimeOf } from '../supabase/functions/_shared/api/entry.js'
import { textWithheld, titlesOnly } from '../supabase/functions/_shared/gate.js'
import { isMain } from './is-main.mjs'
import type { ZodObject } from 'zod'
import type { $strip } from 'zod/v4/core'

const ROOT = process.cwd()
export const OUT = 'supabase/functions/_shared/content/index.json'
const SKIP_ASSETS = /^public\/(static|print)\//
const iso = (s: string|number|Date) => { const t = new Date(s); return Number.isNaN(t.getTime()) ? String(s) : t.toISOString() }

/* git's view of content/: per file its first and last commit and how many; the files removed and when */
function gitHistory(root: string) {
  const times = new Map(), deleted = []
  const run = (args: string) => { try { return execSync(`git log ${args} --relative -- content`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }) } catch { return '' } }
  let at = null
  for (const line of run('--format=%x00%cI --name-only').split('\n')) {
    if (line.startsWith('\0')) { at = iso(line.slice(1).trim()); continue }
    const f = line.trim(); if (!f || !at) continue
    const t = times.get(f) || { updated: at, created: at, revision: 0 }
    t.created = at; t.revision++; times.set(f, t)
  }
  at = null
  for (const line of run('--diff-filter=D --format=%x00%cI --name-only').split('\n')) {
    if (line.startsWith('\0')) { at = iso(line.slice(1).trim()); continue }
    const f = line.trim(); if (f && at && !fs.existsSync(path.join(root, f))) deleted.push({ file: f, at })
  }
  return { times, deleted }
}

/* the models with fields as plain records the function can hold */
export async function describedModels(root = ROOT) {
  const reg = await registry(root)
  return reg.filter((m: { fields: any; dir: any }) => m.fields && m.dir).map((m: { key: any; name: any; dir: any; single: any; nested: any; body: any; bodyLabel: any; fields: ZodObject<{ [x: string]: any },$strip>; model: { key: any; name: any; singular: any } }) => ({
    key: m.key, name: m.name, dir: String(m.dir).replace(/^\.?\//, ''), single: !!m.single, nested: !!m.nested, body: !!m.body, bodyLabel: m.bodyLabel || null,
    fields: describeSchema(m.fields), model: m.model ? { key: m.model.key, name: m.model.name, singular: m.model.singular } : null,
  })).filter(isRecordModel)
}

export async function contentIndex({ root = ROOT } = {}) {
  const c = await loadSite(root)
  const M = c.modules || {}
  const on = { articles: M.articles !== false, books: M.books !== false, wiki: M.wiki !== false, docs: M.docs !== false }
  const accounts = ['store', 'memberships', 'sessions', 'coaching', 'support', 'instrument', 'recommendations'].some((m) => M[m] !== false)
  const docsOnly = on.docs && !on.articles && !on.books && !on.wiki && !accounts
  const store = asStore(root)
  const models = await describedModels(root)
  const { times, deleted } = gitHistory(root)
  const now = new Date().toISOString()
  const records = []
  for (const m of models) {
    const files = m.single ? [m.dir + '/' + m.key.replace(/^.*\//, '') + '.md'] : (await store.list(m.dir, { ext: 'md', deep: m.nested })).map((p: string) => m.dir + '/' + p + '.md')
    for (const file of files) {
      if (modelOfPath(models, file) !== m) continue
      const text = await store.read(file); if (text == null) continue
      let fm; try { fm = matter(text) } catch { continue }
      const t = times.get(file) || {}
      const data = fm.data || {}
      /* a book whose text is withheld goes up as its chapters' titles: the server never holds what it may not send */
      const content = m.key === 'books' && textWithheld(data) ? titlesOnly(fm.content) : fm.content
      records.push({ model: m.key, path: pathWithin(m, file), data, body: content && content.trim() ? content : null, published: isPublished(data), created: data.date ? new Date(data.date).toISOString() : (t.created || now), updated: t.updated || data.updated || now, revision: t.revision || 1 })
    }
  }
  /* the library's files, both roots */
  const assets: any = []
  let sharp = null; try { sharp = (await import('sharp')).default } catch { /* no dimensions */ }
  const walk = async (dir: string) => { for (const e of await store.assets.list(dir)) { if (e.type === 'dir') { await walk(e.path); continue } if (SKIP_ASSETS.test(e.path) || e.name.startsWith('.')) continue; const address = e.path.startsWith('content/uploads/') ? '/uploads/' + e.path.slice('content/uploads/'.length) : '/' + e.path.slice('public/'.length); const mime = e.mime || mimeOf(e.name); let width = null, height = null; if (sharp && /^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) { try { const md = await sharp(path.join(root, e.path)).metadata(); width = md.width || null; height = md.height || null } catch { /* not a picture after all */ } } assets.push({ address, name: e.name, size: e.size, mime, width, height, modified: e.modified ? new Date(e.modified).toISOString() : now }) } }
  for (const r of ['content/uploads', 'public']) { try { await walk(r) } catch (e: any) { if (e.code !== 'ENOENT') throw e } }
  const siteRec = records.find((r) => r.model === 'site')
  const S = siteRec ? siteRec.data : {}
  const space = String((c.api && c.api.space) || slug(c.name || 'site'))
  const langs = Array.isArray(c.languages) && c.languages.length ? c.languages : ['en']
  const locales = langs.map((code: any, i: number) => ({ code, name: code, default: i === 0, fallbackCode: i === 0 ? null : langs[0] }))
  const types = contentTypes(models, { space, now })
  for (const r of records) { const t = types.find((x: { _model: any }) => x._model === r.model); ;(r as any).typeId = t ? t.sys.id : null }
  const gone = deleted.map((d) => { const m = modelOfPath(models, d.file); return m ? { model: m.key, path: pathWithin(m, d.file), at: d.at } : null }).filter(Boolean)
  return { built: now, space, site: { name: S.name || c.name || '', tagline: S.tagline || '', description: S.description || '', url: String(S.url || '').replace(/\/+$/, '') }, docsOnly, locales, models, types, records, assets, deleted: gone }
}
const slug = (s: any) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check')
  /* cloud mode reads the rows and the bucket at run time (_shared/content-index.ts) and never opens this file; shipping the whole
     index would put it in every function that imports the content API, and a function bundled server-side may not pass 5 MB */
  if (!check && process.env.CONTENT_STORE === 'cloud') {
    const file = path.join(ROOT, OUT)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ note: 'CONTENT_STORE is cloud: the content function reads public.content and the content-assets bucket, not this file' }))
    console.log(`${OUT} ← a stub: CONTENT_STORE is cloud, so the functions read the rows`)
    process.exit(0)
  }
  const index = await contentIndex()
  const by: any = {}; for (const r of index.records) by[(r as any).typeId] = (by[(r as any).typeId] || 0) + 1
  const line = `${index.records.length} records (${Object.entries(by).map(([k, n]) => k + ' ' + n).join(', ')}), ${index.assets.length} assets, ${index.types.length} content types, ${index.deleted.length} deletions${index.site.url ? '' : ' (no public address in content/site.md)'}`
  if (check) { console.log(`✔ content index: ${line}`); process.exit(0) }
  const file = path.join(ROOT, OUT)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(index))
  console.log(`${OUT} ← ${line}`)
}
