/*
 * The admin's one client for the content pipe (build/admin-server.mjs): every editor loads and saves through it.
 *   collections()                  every model, its fields and parts
 *   list(col)                      the records of a model — { items } for a plain listing, or the model's own shape
 *   read(col, name)                one record: { name, data, content, parsed, … }
 *   save(col, name, rec, opts)     write — opts.create for a new file, opts.check to look first (a model with a preflight)
 *   remove(col, name) · rename(col, name, to)
 *   action(col, action, payload)   a model's named operation; actionUrl(...) the GET address of one that streams a file
 *   options(key) · upload(col, file) · preview(col, name, rec)
 *   github(op, payload)            cloud mode's repository (the admin function's own door): get · put · retry; the dev server has none
 *   media(op, params)              the library (Content → Media, the pickers): list · mkdir · rename · move · copy · remove · search · upload; mediaFileUrl(path) the checkout's preview
 *   drafts()                       what waits to be published ({ drafts, mode }); publish(col?, name?, message?) one record or everything; keep(path) a removal called off
 * A refusal throws an Error carrying the server's `issues`, `errors`, `failing`, `entries` as they came.
 */
import { CLOUD } from 'platformkit/lib/router.js'
const API = '/__admin'
/* the dev server's middleware, or — built for cloud mode — the `admin` Edge Function, called through the signed-in
   client (its JWT rides along): one call shaped as the middleware's request, { seg, method, q, body } */
async function call(path: string|URL, opts: any = {}) {
  if (CLOUD) {
    const { supabase } = await import('platformkit/lib/supabase.js')
    const u = new URL(path, 'http://x')
    const seg = u.pathname.replace(/^\//, ''), method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    const { data, error } = await supabase!.functions.invoke('admin', { body: { seg, method, q: Object.fromEntries(u.searchParams.entries()), body } })
    if (error) {
      let j: any = {}; try { j = error.context ? await error.context.json() : {} } catch { /* no body */ }
      const e: any = new Error(j.error || error.message); Object.assign(e, j); e.status = error.context ? error.context.status : 500; throw e
    }
    return data
  }
  const r = await fetch(API + path, opts)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e: any = new Error(j.error || r.statusText); Object.assign(e, j); e.status = r.status; throw e }
  return j
}
const post = (path: string, body: any) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const enc = encodeURIComponent

export const collections = () => call('/collections').then((j) => j.collections)
export const list = (col: string|number|boolean) => call('/list?col=' + enc(col))
export const items = (col: any) => list(col).then((j) => j.items || [])
export const read = (col: string|number|boolean, name: string|number|boolean) => call(`/file?col=${enc(col)}&name=${enc(name)}`)
export const save = (col: any, name: any, rec: any, opts: any = {}) => post('/file', { col, name, ...rec, ...(opts.create ? { create: true } : {}), ...(opts.check ? { check: true } : {}) })
export const remove = (col: string|number|boolean, name: string|number|boolean) => call(`/file?col=${enc(col)}&name=${enc(name)}`, { method: 'DELETE' })
export const rename = (col: any, name: any, to: any) => post('/file', { col, name, rename: to })
export const action = (col: any, action: any, payload = {}) => post('/action', { col, action, ...payload })
/* the address of an action that streams a file: the dev server's own. There is none in cloud mode
   — a function cannot be a GET a browser navigates to, since the call carries a bearer — so use
   fileUrl below, which answers one either way. */
export const actionUrl = (col: any, action: any, payload = {}) => (CLOUD ? '' : `${API}/action?${new URLSearchParams({ col, action, ...payload })}`)
/*
 * A FILE AN ACTION MAKES, as an address this browser can open. On the dev server that is the
 * action's own GET. In cloud mode there is no such GET, so the action is CALLED — it answers the
 * bytes as base64 — and those become a blob this page owns: the print's PDFs and its EPUB, which
 * were simply absent in the live admin before.
 *
 * The blobs are held so a preview that reloads does not leak one per render; `forgetFiles()` frees
 * them, and the page that opens them calls it as it unmounts.
 */
const blobs = new Map()
export async function fileUrl(col: string, act: string, payload = {}) {
  if (!CLOUD) return actionUrl(col, act, payload)
  const key = col + ':' + act + ':' + JSON.stringify(payload)
  if (blobs.has(key)) return blobs.get(key)
  const j = await action(col, act, payload)
  if (!j || typeof j.bytes !== 'string') throw new Error('the file was not answered')
  const raw = atob(j.bytes)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const u = URL.createObjectURL(new Blob([bytes], { type: j.type || 'application/octet-stream' }))
  blobs.set(key, u)
  return u
}
export function forgetFiles() { for (const u of blobs.values()) { try { URL.revokeObjectURL(u) } catch (e) { /* gone */ } } blobs.clear() }
export const options = (key: string|number|boolean) => call('/options?key=' + enc(key)).then((j) => j.options || [])
/* the dev server compiles a draft through velite; in cloud mode the draft goes through the site's own adapter here, no call */
export const preview = async (col: any, name: any, rec: any) => (CLOUD ? (await import('platformkit/lib/content-live.js')).previewEntry(col, name, rec) : post('/preview', { col, name, ...rec }))
/* a bucket address as the browser reaches it — the kit's one definition, since the store's own
   index needs the same rule and two copies of it would drift */
import { here } from 'platformkit/lib/bucket-host.js'
export { here }
const addressed = (v: any): any => (Array.isArray(v) ? v.map(addressed) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, addressed(x)])) : typeof v === 'string' ? here(v) : v)
export const upload = async (col: any, file: any) => {
  const dataBase64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })
  return post('/upload', { col, filename: file.name, dataBase64 }).then(addressed)
}
export const uploadImage = async (file: any) => {
  const dataBase64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })
  return post('/upload-image', { filename: file.name, dataBase64 }).then(addressed)
}
/* an asset's address for the preview: the dev server serves it from the checkout; in cloud mode an upload's path is the bucket's own url, so a relative name is one written before the move and has no address here */
export const assetUrl = (col: string|number|boolean, file: string|number|boolean) => (CLOUD ? '' : `${API}/asset?col=${enc(col)}&file=${enc(file)}`)
export const media = (op: string, params = {}) => post('/media', { op, ...params }).then(addressed)
/* where else a picture can come from (build/images): the sources this deployment has, a search,
   and taking one — which puts it in the library and answers with an ordinary address */
export const images = (op: any, params = {}) => post('/images', { op, ...params }).then(addressed)
export const mediaFileUrl = (path: string|number|boolean) => (CLOUD ? '' : `${API}/media-file?path=${enc(path)}`)
export const drafts = () => call('/drafts')
export const publish = (col: any, name: any, message = '') => post('/publish', { ...(col ? { col, name } : {}), message })
export const keep = (path: any) => post('/keep', { path })
export const github = (op: any, payload = {}) => (CLOUD ? call('/github', { method: 'POST', body: JSON.stringify({ op, ...payload }) }) : Promise.resolve(null))
export default { collections, list, items, read, save, remove, rename, action, actionUrl, fileUrl, forgetFiles, options, preview, upload, uploadImage, assetUrl, github, drafts, publish, keep, media, mediaFileUrl, here }
