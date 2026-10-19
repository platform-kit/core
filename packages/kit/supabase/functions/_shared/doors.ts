/*
 * THE PUBLIC DOORS' LIMITS — how much one visitor may send to a door anybody can reach (guest checkout,
 * form answers, analytics intake) in an hour, counted where every isolate sees it (api_rate_take, the
 * API keys' counter) and set in the site's policy record (content/emails/policy.md, `limit-*`), with the
 * defaults below where it says nothing.
 *
 * WHO A VISITOR IS: a signed-in account by its id; otherwise the address the platform's own proxy wrote
 * (cf-connecting-ip, x-real-ip, or the last x-forwarded-for entry, which the nearest proxy appends) —
 * never the first x-forwarded-for entry, which is whatever the caller sent. With no address at all,
 * every such visitor shares one count rather than having none. The count is kept under a HASH of the
 * address (visitorKey), so no address is ever written down — the analytics promise holds here too.
 *
 * A database that cannot count FAILS OPEN, as the API's limit does: a limiter that took the door down
 * when it could not count would be the outage it exists to prevent.
 */
import { admin } from './lib.ts'
import { of } from './compiled.ts'

export type Door = 'checkout' | 'forms' | 'analytics'
export const DOOR_DEFAULTS: Record<Door, number> = { checkout: 30, forms: 300, analytics: 1200 }

export function addressOf(req: Request): string {
  const h = (k: string) => (req.headers.get(k) ?? '').trim()
  const fwd = h('x-forwarded-for').split(',').map((s) => s.trim()).filter(Boolean)
  return (h('cf-connecting-ip') || h('x-real-ip') || fwd[fwd.length - 1] || 'unknown').slice(0, 64)
}

export function doorLimit(door: Door): number {
  const p = ((of<Record<string, any>>('funnels') as any)?.policy ?? {}) as Record<string, unknown>
  const n = Number(p['limit-' + door])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DOOR_DEFAULTS[door]
}

/* who a visitor is in the counter: their account, or a hash of their address — never the address itself */
export async function visitorKey(req: Request, userId?: string | null): Promise<string> {
  if (userId) return 'u:' + userId
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('platformkit-door:' + addressOf(req))))
  return 'a:' + Array.from(d.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* one request through a door: over, and how long until the hour turns, when this one is past the limit */
export async function throughDoor(req: Request, door: Door, userId?: string | null): Promise<{ over: boolean; retry: number }> {
  const who = `door:${door}:${await visitorKey(req, userId)}`
  try {
    const { data, error } = await admin.rpc('api_rate_take', { p_who: who })
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row) return { over: false, retry: 0 }
    const over = Number(row.hr) > doorLimit(door)
    return { over, retry: over ? Math.ceil((3_600_000 - (Date.now() % 3_600_000)) / 1000) : 0 }
  } catch { return { over: false, retry: 0 } }
}
