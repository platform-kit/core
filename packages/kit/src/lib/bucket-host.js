/*
 * A BUCKET ADDRESS AS THIS BROWSER REACHES IT.
 *
 * An Edge Function builds a public url from its own `SUPABASE_URL`, which in production is the
 * project's public address and on a local stack is the stack's INNER host (`http://kong:8000`) —
 * a name that resolves inside Docker and nowhere else. So every bucket address a function answers
 * with is brought to the host this client knows, path and query kept. In production the two hosts
 * are the same and nothing changes.
 *
 * It applies only to the public content bucket, and only to an absolute http address: anything
 * else is handed back untouched, because a relative path in a checkout is already right and a url
 * to somewhere else is somebody else's.
 */
const HERE = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const BUCKET_PATH = /\/storage\/v1\/object\/(?:public\/)?content-assets\//

export function here(u) {
  if (!HERE || typeof u !== 'string' || !/^https?:\/\//.test(u)) return u
  try { const x = new URL(u); return BUCKET_PATH.test(x.pathname) && x.origin !== HERE ? HERE + x.pathname + x.search : u }
  catch { return u }
}
