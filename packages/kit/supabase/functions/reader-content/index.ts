/*
 * THE READER'S OWN TEXT — what of a gated record THIS reader may be sent (_shared/gate.js).
 *
 * The published bundle carries what a guest may read: a locked chapter's title and teaser, a gated page's hero
 * and excerpt. A reader with more — signed in, a member, the buyer of a book — asks here, and is answered from
 * the source (the content index beside the functions, or the rows in cloud mode) with exactly what the access
 * rule admits for their account. Their class is read from their own entitlements, never from the request, and
 * a refusal carries no text.
 *
 *   POST { collection: 'books', slug }                → { raw, companion } the book cut to the reader's chapters
 *   POST { collection: 'articles'|'wiki'|'docs', slug } → { body } the page's markdown, or 403
 *   POST { action: 'rows' }                            → { rows } cloud mode's published rows as a guest may have
 *                                                        them (lib/content-live.js) — every row, drafts too, for an
 *                                                        administrator, whose preview reads them whole
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin, getUser, json, preflight } from '../_shared/lib.ts'
import { contentIndexes } from '../_shared/content-index.ts'
import { classOf, allowedBy } from '../_shared/access.js'
import { readableChapters, sentText, splitChapters, publicRow, companionTextFor } from '../_shared/gate.js'
import { parseCompanionBody, serialiseCompanionBody } from '../_shared/pipe/src/lib/companion-body.js'

const COMPANION = { parseCompanionBody, serialiseCompanionBody }

const PAGES = new Set(['articles', 'wiki', 'docs'])
const fail = (error: string, status: number) => json({ error }, status)

/* the database, asked as the reader: their own session decides what get_my_entitlements and is_admin answer */
const asReader = (req: Request) => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
  global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  auth: { persistSession: false, autoRefreshToken: false },
})

/* the reader's entitlements, as the database answers them for THEIR session */
async function entitlementsOf(req: Request) {
  const { data, error } = await asReader(req).rpc('get_my_entitlements')
  if (error) throw new Error('entitlements could not be read: ' + error.message)
  return data as { class?: string; products?: string[] } | null
}

async function rows(req: Request) {
  const user = await getUser(req)
  const isAdmin = user ? (await asReader(req).rpc('is_admin').then((r) => r.data === true, () => false)) : false
  let q = admin.from('content').select('collection, slug, path, published, data, body, text').is('deleted_at', null).order('path')
  if (!isAdmin) q = q.eq('published', true).not('text', 'is', null)
  const { data, error } = await q
  if (error) return fail('content could not be read', 500)
  if (isAdmin) return json({ rows: data ?? [] })
  const books = new Map((data ?? []).filter((r: any) => r.collection === 'books').map((r: any) => [r.slug, r.data || {}]))
  return json({ rows: (data ?? []).map((r: any) => publicRow(r, books, COMPANION)) }, 200)
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return fail('method not allowed', 405)
  const body = await req.json().catch(() => ({}))
  try {
    /* the rows are cloud mode's; a site whose content is files has none, and is answered with none */
    if (body.action === 'rows') return await rows(req)

    const collection = String(body.collection ?? ''), slug = String(body.slug ?? '')
    if (!(collection === 'books' || PAGES.has(collection)) || !slug) return fail('collection and slug are required', 400)
    const { live } = await contentIndexes()
    const rec = live.records.find((r) => r.model === collection && r.path === slug && r.published)
    if (!rec) return fail('not found', 404)
    const fm = rec.data || {}

    /* nobody signed in reads what a guest may — which the bundle already has */
    const user = await getUser(req)
    const ent = user ? await entitlementsOf(req) : null
    const cls = classOf(ent, !!user)

    if (collection === 'books') {
      const owned = Array.isArray(ent?.products) && ent!.products!.includes(slug)
      const n = readableChapters(fm, cls, { owned })
      const raw = rec.body || ''
      const comp = live.records.find((r) => r.model === 'companions' && r.data && (r.data as any).book === slug && r.published)
      return json({
        raw: sentText(fm, raw, n),   /* a book whose text is withheld sends its chapters' titles alone, to anyone */
        chapters: splitChapters(raw).length,
        readable: Number.isFinite(n) ? n : null,
        companion: comp ? companionTextFor(comp.body || '', n, COMPANION) : null,
      })
    }
    if (!allowedBy(fm.canAccess, cls)) return fail('not allowed', 403)
    return json({ body: rec.body || '' })
  } catch (e) {
    console.error('reader-content', e)
    return fail('the text could not be read', 500)
  }
})
