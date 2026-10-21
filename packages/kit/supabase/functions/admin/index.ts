/*
 * The admin's content API in cloud mode (CONTENT_STORE=cloud): the same pipe the dev server mounts
 * (_shared/pipe/build/admin-pipe.mjs, assembled from the kit's build — the models, the grammars, the checks,
 * the round trip) over the rows of public.content and the content-assets bucket, behind the signed-in
 * administrator's JWT. Every write goes through the pipe with the service role; nothing is written from a
 * client. The scripts that need a machine — the print's renderer, the spoken books, the enrichment — are
 * refused here with a line saying they run from a checkout or the deploy.
 *
 * POST { seg, method?, q?, body? } — one call shaped as the middleware's request:
 *   seg: collections | list | file | preview | options | action | upload | upload-image | asset | drafts | publish | keep | media
 *   method: GET | POST | DELETE (POST by default); q: the query as an object; body: the request's body
 * Also:
 *   github   body: { op: 'get' | 'put' | 'retry', repo?, branch?, token? }   the repository the saves are pushed to
 *   push-pending   (the service bearer, from pg_cron)                   every pending row pushed
 * Every reply is JSON; an asset comes back as { bytes: base64, type }.
 */
import { admin, json, preflight, getUser, isServiceBearer, cors } from '../_shared/lib.ts'
import { compileDesign } from '../_shared/mjml.ts'
import { rolesOf, isAdmin, mayEditContent, isProvider } from '../_shared/roles.ts'
import { adminRequest } from '../_shared/pipe/build/admin-pipe.mjs'
import { registry, describe } from '../_shared/pipe/build/models/index.mjs'
import { rowsStore } from '../_shared/pipe/build/store/rows.mjs'
import { models as SITE_MODELS } from '../_shared/pipe/site/index.js'
import * as SITE from '../_shared/pipe/site.js'
import { pushPending, githubSettings, saveGithubSettings, saveHook, askRebuild, contentArchive } from '../_shared/github.js'
import THEME from '../_shared/pipe/theme-strings.json' with { type: 'json' }
import THEME_SKILLS from '../_shared/pipe/theme-skills.json' with { type: 'json' }
import THEME_BRAND from '../_shared/pipe/theme-brand.json' with { type: 'json' }
import { deliverContentEvent } from '../_shared/api/manage.ts'
import { printSpec } from '../_shared/pipe/src/lib/print-offers.js'
import { of } from '../_shared/compiled.ts'

/*
 * THE ACTIONS THAT STILL NEED A MACHINE. Two of them, and they are the ones that run a program
 * this runtime has not got: the enrichment (a long chain of paid model calls, minutes at a time,
 * far past a function's budget) and the spoken books (onnxruntime and ffmpeg, both native).
 *
 * The PRINT's actions were on this list and are not any more: render, save, set, quote and pdf all
 * work here now, over print-render and the print bucket. It was a list of action NAMES rather than
 * of model-and-action, which is worth knowing if anything is ever added to it — a model that
 * happened to call an action `save` would have been refused for no reason.
 */
const MACHINE = ['enrich', 'introduce', 'tts']

/* bytes as base64, in pieces small enough to be arguments */
function base64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/*
 * THE PRINT RENDERER, over its own function. It is a separate invocation on purpose: setting a
 * book is most of a CPU budget (Typst as WASM, the type, the covers), and the admin answers many
 * other things in the same worker. The service key is the bearer, as the deploy's own calls are.
 */
const SUPA = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
async function callPrintRender(body: Record<string, unknown>) {
  const r = await fetch(`${SUPA}/functions/v1/print-render`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok || !out.ok) throw new Error(String(out.error ?? `print-render answered ${r.status}`))
  return out as Record<string, any>
}

/* which editions a book's block sells — the contents, in the canon's order */
async function contentsOf(slug: string): Promise<string[]> {
  const { data } = await admin.from('content').select('data').eq('path', `content/books/${slug}.md`).is('deleted_at', null).maybeSingle()
  const spec = printSpec(((data?.data ?? {}) as Record<string, unknown>).print)
  return spec && spec.contents.length ? spec.contents : ['parts']
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)
  let call: Record<string, unknown> = {}
  try { call = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const seg = String(call.seg ?? '')

  /* the cron's retry of the pushes: the service bearer, no user */
  if (seg === 'push-pending') {
    if (!(await isServiceBearer(req))) return json({ error: 'forbidden' }, 403)
    return json(await pushPending(admin))
  }

  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  /* an EDITOR reaches the content collections and the pipe that publishes them; everything else
     here — the offers, the funnels, the settings — stays an administrator's */
  const roles = await rolesOf(user.id)
  /* A COACH REACHES ONE THING: their own page. They are not an editor and must not become one by
     being let through the door, so they arrive with a fence — the pipe then answers for the pages
     collection alone and for exactly the records whose owner is their username. Somebody who has
     not taken a username has no page to own and is refused like anybody else. */
  let only: { col: string; field: string; value: string } | undefined
  if (!mayEditContent(roles) && !isAdmin(roles)) {
    if (!isProvider(roles)) return json({ error: 'not allowed to edit content' }, 403)
    const { data: prof } = await admin.from('profiles').select('username').eq('id', user.id).maybeSingle()
    const u = String(prof?.username ?? '')
    if (!u) return json({ error: 'take a username first — your page is at /p/<username>' }, 403)
    only = { col: 'pages', field: 'owner', value: u }
  }
  const by = (user.user_metadata?.full_name as string) || user.email || user.id

  if (seg === 'github') {
    const g = ((call.body ?? call) as Record<string, unknown>)
    const op = String(g.op ?? 'get')
    if (op === 'put') { await saveGithubSettings(admin, { repo: String(g.repo ?? ''), branch: String(g.branch ?? ''), token: g.token == null ? undefined : String(g.token) }); return json(await githubSettings(admin)) }
    if (op === 'retry') return json({ ...(await pushPending(admin, by)), ...(await githubSettings(admin)) })
    /* the deploy hook: a secret like the token — written here, never read back */
    if (op === 'hook') { await saveHook(admin, String(g.url ?? '')); return json(await githubSettings(admin)) }
    if (op === 'rebuild') return json({ ...(await askRebuild(admin)), ...(await githubSettings(admin)) })
    /* a copy of the content as it stands — the only one there is, where no repository keeps it */
    if (op === 'archive') {
      const a = await contentArchive(admin)
      return new Response(a.bytes, { headers: { ...cors, /* octet-stream, not application/zip: supabase-js decodes an unrecognised content type as TEXT,
           which re-encodes the bytes and hands the browser a zip whose directory is gone. The name
           says what it is. */
        'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="content.zip"' } })
    }
    return json(await githubSettings(admin))
  }

  /* every change the pipe makes is told to the content webhooks (the Management API's), a person's publish included */
  const store = rowsStore({ client: admin, by, url: '', key: '', onEvent: (e: unknown) => deliverContentEvent(e as any) })
  const site = { root: '', modules: SITE.modules, admin: {}, usage: SITE.usage }
  const env = {
    root: '', store, by, site, theme: THEME, themeSkills: THEME_SKILLS, brand: THEME_BRAND, only,
    /* the catalog as the functions hold it (live after a publish): a model that checks a sku against it has no disk here */
    catalog: () => of('catalog'),
    models: () => registry('', { site, siteModels: SITE_MODELS, store }),
    describe,
    /*
     * SETTING A PRINTED BOOK, WITH NO MACHINE. The print model does not run Typst when it is given
     * this: a render is the `print-render` function (Typst as WASM, the type from the bucket), and
     * a rendered file comes from the print bucket rather than off a disk. See that function, and
     * build/models/core/print.mjs for the seam.
     *
     * A DRAFT BUYS NOTHING. The admin renders on every save so the editor can turn the pages, and
     * a title at a printer that keeps one costs a setup fee — so `draft` stops short of the
     * registry and of print.json, and only Set the editions does the real thing.
     */
    /*
     * COMPILING AN EMAIL DESIGN, with no machine. Handed in for the same reason the renderer above
     * is: the pipe cannot import these packages itself, because a specifier it works out at run
     * time is not in the module graph the runtime resolves npm from. See _shared/mjml.ts.
     */
    compileDesign,
    editions: {
      render: async (slug: string, { draft }: { draft: boolean }) => {
        const spec = await contentsOf(slug)
        const editions: Record<string, unknown> = {}
        const t0 = Date.now()
        for (const contents of spec) {
          const r = await callPrintRender({ book: slug, contents, draft })
          /* `where` and `marks` are the document's own account of itself, read back out of the
             compiled file by the function. They are carried to the browser because the browser is
             what draws the listing's pictures, and a chapter's page is not something to infer from
             the text when the document will say it outright. */
          editions[contents] = { edition: r.edition, pages: r.pages, covers: r.covers, epub: !!r.epub, printers: r.printers ?? {}, dims: r.dims ?? {}, notes: r.notes ?? [], incomplete: r.incomplete ?? [], where: r.where ?? [], marks: r.marks ?? [] }
        }
        return { editions, ms: Date.now() - t0, at: new Date().toISOString() }
      },
      /*
       * AND BACK THE OTHER WAY: the pictures the browser drew, as bytes. print-render makes the
       * addresses itself and records them against the edition, refusing any other — so nothing the
       * browser sends becomes a url, and a book set again in between cannot be given pictures of
       * the text it used to have.
       */
      listing: async (call: Record<string, unknown>) => callPrintRender(call),
      file: async (book: string, edition: string, name: string) => {
        const { data } = await admin.storage.from('print').download(`${book}/${edition}/${name}`)
        return data ? new Uint8Array(await data.arrayBuffer()) : null
      },
    },
    /*
     * WHAT CANNOT BE DONE FROM HERE, and why — a refusal that names the reason is the difference
     * between a missing feature and a broken button.
     *
     * The printed book is no longer among them: print-render does the whole of it but the store's
     * cover art and the listing's page pictures, which want a browser. The enrichment and the
     * spoken books still want a machine, and say so.
     */
    refuseActions: (m: { key: string }, action: string) => (MACHINE.includes(action) ? 'this runs from a checkout or the deploy, not the live admin' : null),
  }
  const r = await adminRequest(env, { method: String(call.method ?? 'POST'), seg, q: (call.q as Record<string, string>) ?? {}, body: call.body ?? null })
  /* IN CHUNKS. `String.fromCharCode(...bytes)` spreads every byte as an argument, and a PDF of a
     few hundred kilobytes is past what a call can take — it throws, and the file that could not be
     sent looks like a broken button. */
  if (r.bytes) return json({ bytes: base64(r.bytes as Uint8Array), type: r.type }, r.status)
  if (r.stream) return json({ error: 'a streamed file is the dev server\'s' }, 409)
  /* a publish is pushed to the repository at once as one commit, when one is connected (a save is a draft and pushes nothing); failures stay pending for the cron */
  /*
   * A PUBLISH IS LIVE ALREADY — what follows is the copies catching up. The push sends the files to
   * the repository, where there is one; the hook asks the host to build, which is the only thing
   * that refreshes the prerendered pages and the share images. Neither can fail a publish: the rows
   * were written before either was asked.
   */
  if (r.status === 200 && seg === 'publish') {
    try { const b = (call.body ?? {}) as Record<string, unknown>; const p = await pushPending(admin, by, { message: b.message == null ? '' : String(b.message) }); (r.body as Record<string, unknown>).push = p } catch (e) { (r.body as Record<string, unknown>).push = { error: String((e as Error).message || e) } }
    try { (r.body as Record<string, unknown>).rebuild = await askRebuild(admin) } catch (e) { (r.body as Record<string, unknown>).rebuild = { asked: false, error: String((e as Error).message || e) } }
  }
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } })
})
