/*
 * The library's driver for VueFinder: the manager's `uploads://…` and `site://…` paths mapped onto the store's two
 * roots (content/uploads, public) through the content pipe's `media` calls — the dev server's middleware from a
 * checkout, the `admin` function in cloud mode — so the checkout and the bucket are one library. Uploads go through
 * the same client, one file at a time (an Uppy uploader plugin of a few lines: no XHR endpoint, so the function's
 * JSON body stays the one shape); a preview is the file's served address (cloud mode: the bucket's url; the checkout:
 * /uploads/… and /… as Vite serves them). Archives, unarchiving, a new empty file and a text editor are not the
 * pipe's and are refused here; the page turns their features off.
 */
import { BasePlugin } from '@uppy/core'
import { media, mediaFileUrl } from './api.js'
import { us } from '@platform-kit/kit/lib/strings.js'

export const STORAGES = { uploads: 'content/uploads', site: 'public' }
const ROOT_OF = Object.fromEntries(Object.entries(STORAGES).map(([k, v]) => [v, k]))

/* uploads://a/b ↔ content/uploads/a/b */
export function toStore(vf) {
  const s = String(vf || '')
  const [storage, rest] = s.includes('://') ? s.split('://') : ['uploads', s]
  const root = STORAGES[storage]; if (!root) throw new Error('not a storage the library has: ' + storage)
  const p = (rest || '').replace(/^\/+|\/+$/g, '')
  return p ? root + '/' + p : root
}
export function toVf(rel) {
  const p = String(rel || '').replace(/\\/g, '/')
  for (const [root, storage] of Object.entries(ROOT_OF)) { if (p === root) return storage + '://'; if (p.startsWith(root + '/')) return storage + '://' + p.slice(root.length + 1) }
  return 'uploads://' + p
}
/* the served address of every file the driver has listed, by its store path: the bucket's url in cloud mode */
const URLS = new Map()
const entry = (e) => {
  if (e.url) URLS.set(e.path, e.url)
  const path = toVf(e.path), [storage] = path.split('://'), dir = path.slice(0, path.lastIndexOf('/') + 1).replace(/\/$/, '') || storage + '://'
  return { storage, dir: dir.endsWith('://') ? dir : dir, basename: e.name, extension: e.type === 'file' ? (e.name.includes('.') ? e.name.split('.').pop() : '') : '', path, type: e.type, file_size: e.size ?? null, last_modified: e.modified ? Math.round(e.modified / 1000) : 0, mime_type: e.mime || null, visibility: 'public', url: e.url || null, previewUrl: e.url || null }
}
const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob) })

/* the uploader: every queued file posted through the pipe, its entry answered */
class PipeUploader extends BasePlugin {
  constructor(uppy, opts) { super(uppy, opts); this.id = 'PipeUploader'; this.type = 'uploader'; this.upload = this.upload.bind(this) }
  install() { this.uppy.addUploader(this.upload) }
  uninstall() { this.uppy.removeUploader(this.upload) }
  async upload(fileIDs) {
    const files = this.uppy.getFilesByIds(fileIDs).filter((f) => !f.progress.uploadComplete)
    this.uppy.emit('upload-start', files)
    for (const f of files) {
      try {
        const dir = toStore(this.opts.getTargetPath())
        const r = await media('upload', { dir, filename: f.name, dataBase64: await toBase64(f.data) })
        this.uppy.emit('upload-success', this.uppy.getFile(f.id), { status: 200, body: r, uploadURL: r.entry && r.entry.url })
      } catch (e) { this.uppy.emit('upload-error', this.uppy.getFile(f.id), e); throw e }
    }
  }
}

export class MediaDriver {
  constructor() { this.storages = Object.keys(STORAGES) }
  configureUploader(uppy, ctx) { uppy.use(PipeUploader, { getTargetPath: ctx.getTargetPath }) }
  async result(dirVf) { const dir = toStore(dirVf); const r = await media('list', { dir }); return { storages: this.storages, dirname: toVf(dir), files: r.files.map(entry), read_only: false } }
  async list(params = {}) { return this.result(params.path || 'uploads://') }
  /* a file in use is kept: the pipe refuses (409, the records that name it) and the refusal is worded from the media
     scope for VueFinder's toast — the name, the records' titles (three at most, and the rest counted) */
  refusal(e, what) {
    if (!e || e.status !== 409 || !e.used) throw e
    const F = us('media').page.file, fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
    const [path, records] = Object.entries(e.used)[0]
    const titles = records.map((r) => r.title), shown = titles.slice(0, 3).join(', ') + (titles.length > 3 ? ' ' + fill(F.more, { n: titles.length - 3 }) : '')
    const isDir = !/\.[a-z0-9]+$/i.test(path)
    throw new Error(fill(isDir ? F['refused-folder'] : F['refused-' + what], { name: path.split('/').pop(), records: shown }))
  }
  async usage(paths) { const r = await media('usage', { paths: paths.map((p) => (String(p).includes('://') ? toStore(p) : p)) }); return r.usage || {} }   /* VueFinder's paths or the store's */
  async delete({ path, items }) { await media('remove', { paths: items.map((i) => toStore(i.path)) }).catch((e) => this.refusal(e, 'delete')); const r = await this.result(path); return { ...r, deleted: items.map((i) => ({ ...i, path: i.path })) } }
  async rename({ path, item, name }) { await media('rename', { path: toStore(item), name }).catch((e) => this.refusal(e, 'rename')); return this.result(path) }
  async move({ path, sources, destination }) { await media('move', { paths: sources.map(toStore), to: toStore(destination) }).catch((e) => this.refusal(e, 'move')); return this.result(path || destination) }
  async copy({ path, sources, destination }) { await media('copy', { paths: sources.map(toStore), to: toStore(destination) }); return this.result(path || destination) }
  async createFolder({ path, name }) { await media('mkdir', { dir: toStore(path), name }); return this.result(path) }
  async search({ path, filter, deep }) { const r = await media('search', { dir: toStore(path || 'uploads://'), q: filter, deep: deep !== false }); return r.files.map(entry) }
  getPreviewUrl({ path }) { const rel = toStore(path); return URLS.get(rel) || mediaFileUrl(rel) || this.urlOf(rel) }
  getDownloadUrl({ path }) { return this.getPreviewUrl({ path }) }
  /* the served address of a file, for the picker and the copy button; the entries carry it, this is the fallback */
  urlOf(rel) { if (URLS.has(rel)) return URLS.get(rel); const p = String(rel); return p.startsWith('public/') ? '/' + p.slice(7) : p.startsWith('content/uploads/') ? '/uploads/' + p.slice(16) : '/' + p }
  async archive() { throw new Error('the library keeps files, not archives') }
  async unarchive() { throw new Error('the library keeps files, not archives') }
  async createFile() { throw new Error('the library takes files, it does not write them') }
  async save() { throw new Error('the library takes files, it does not write them') }
  async getContent() { return { content: '' } }
  async upload() { return this.result('uploads://') }
}
