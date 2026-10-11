/*
 * THE SUPPLIERS AND THE KINDS A SITE ACTUALLY HAS — the kit's, plus whatever it registered.
 *
 * `_shared/suppliers/index.js` is the registry and takes a site's own as an argument; `storeOf`
 * in build/site.mjs says where that site keeps them. Until this file there was nothing between
 * the two: the registry COULD walk a site's suppliers, the demo's bindery WAS registered in its
 * config, and nothing in a build or an admin ever passed one — so every surface quietly ran on
 * the kit's five, and the only thing that proved the seam was a test importing the module by
 * hand. Which is exactly the way a plug-in seam rots: true of the interface, false of the
 * product.
 *
 * So this is the ONE build-side door. Everything that needs a supplier or a kind asks here and
 * gets both lists bound to this process's environment, and nothing downstream knows which of
 * them came from where.
 *
 * It is cached per root: the config is read once per process, since a dev server restarts on a
 * change to it and a build runs once.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { printers, PRINTER_IDS, SUPPLIER_IDS, FORMATS_PRINTED } from '../supabase/functions/_shared/suppliers/index.js'
import { kinds as registerKinds } from './kinds/index.js'
import { storeOf } from './site.mjs'
import { loadDotEnv } from './tts/storage.mjs'

loadDotEnv()   /* the keys from .env, for a process that has not read it (the admin server) */
const ENV = (k) => process.env[k] || ''

/* a module path a site registered, resolved against the site's root and imported for its exports */
async function own(root, rel) {
  if (!rel) return []
  const url = pathToFileURL(path.resolve(root, rel)).href
  const mod = await import(/* @vite-ignore */ url)
  /* every export that is a factory or an object: a site may put one in a file or several */
  return Object.values(mod).filter((v) => typeof v === 'function' || (v && typeof v === 'object'))
}

const CACHE = new Map()

export async function storeRegistry(root = process.cwd()) {
  if (CACHE.has(root)) return CACHE.get(root)
  const p = (async () => {
    let s = { suppliers: null, kinds: null }
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'platformkit.config.js')).href)
      s = storeOf(mod.default || mod)
    } catch { /* no config (a kit test, a bare checkout): the kit's own, which is every shop until one needs a bindery */ }
    const P = printers(ENV, await own(root, s.suppliers))
    return { ...P, kinds: registerKinds(await own(root, s.kinds)) }
  })()
  CACHE.set(root, p)
  return p
}

/* every supplier as a list, which is what a choices list and the admin's tab want */
export async function suppliersFor(ctx = {}) {
  const { SUPPLIERS } = await storeRegistry(ctx.root || process.cwd())
  return Object.values(SUPPLIERS)
}

export async function kindsFor(ctx = {}) {
  return (await storeRegistry(ctx.root || process.cwd())).kinds
}

export { PRINTER_IDS, SUPPLIER_IDS, FORMATS_PRINTED }
