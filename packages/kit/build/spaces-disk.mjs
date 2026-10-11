/*
 * THE THREE THINGS THE SPACES COMPILE WANTS FROM A DISK, in one place so that build/spaces.mjs
 * wants none of them.
 *
 * None of these is content. Two are the build's own outputs, read to check a declaration against
 * them — the catalog (does this sku exist, is this tier one a membership declares) and the forms
 * (is this the name of a form a door can ask) — and the third is the compile's own output file.
 *
 * In the admin's Edge Function a publish compiles the spaces and projects them straight into the
 * database: there is no file to write, and the catalog and the forms are handed in by the caller or
 * simply absent. So spaces.mjs takes all three as data and reaches for this module only on the
 * machine path, which is why this file is the one allowed a filesystem (content-kinds.mjs
 * MAY_USE_FS) and spaces.mjs is not.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeIfChanged } from './write-if-changed.mjs'

const readJson = (root, rel) => { try { return JSON.parse(readFileSync(join(root, rel), 'utf8')) } catch { return null } }

/* the catalog as the compile wants it: the offers by sku and the booking types */
export const catalogFrom = (root) => {
  const c = readJson(root, 'supabase/functions/_shared/catalog.json')
  return c ? { offers: c.offers || {}, sessions: c.sessions || [] } : null
}
/* the names of the forms this site has */
export const formsFrom = (root) => {
  const f = readJson(root, 'supabase/functions/_shared/forms.json')
  return f ? Object.keys(f) : null
}
/*
 * WHICH MODULES THIS SITE SWITCHED ON — the fourth thing, and read the same way as the other
 * three: by the machine path only, handed in as data where there is no disk.
 *
 * It is here for one question, `encrypted: true` with the space-encryption module off, which must
 * be a FAULT and not a silent nothing. A channel a site believes is sealed and is not is worse
 * than either a sealed one or an open one, because nobody is told.
 */
export const modulesFrom = async (root) => {
  try {
    const { loadSite } = await import('./site.mjs')
    const site = await loadSite(root)
    return (site && site.modules) || {}
  } catch { return null }
}
/* the compile's output, written only where the bytes differ */
export const writeSpaces = (root, paths, text) => { for (const p of paths) writeIfChanged(join(root, p), text) }
