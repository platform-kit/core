/*
 * The content pipe for an API door in cloud mode: the same `adminRequest` the admin function answers with, over the row
 * store, `by` the key's maker — so a write from outside goes through the model's fields, checks and grammar exactly as
 * a save in the admin does, and a publish is the pipe's. The Management API (manage.ts) and the Forms API's writes
 * (forms-api) share it; each hands the store its own events hook (the content webhooks) or none.
 *
 *   pipeFor(by, onEvent?)  → { store, env, call(method, seg, q, body) }
 *   makerOf(caller)        → { by: the key's maker's name, id }  — who a write is attributed to
 */
import { admin } from '../lib.ts'
import { adminRequest } from '../pipe/build/admin-pipe.mjs'
import { registry, describe } from '../pipe/build/models/index.mjs'
import { rowsStore } from '../pipe/build/store/rows.mjs'
import { models as SITE_MODELS } from '../pipe/site/index.js'
import * as SITE from '../pipe/site.js'
import THEME from '../pipe/theme-strings.json' with { type: 'json' }

export type Caller = { kind: string; id: string | null }
const MACHINE = ['enrich', 'introduce', 'render', 'save', 'set', 'quote', 'pdf', 'tts']

export function pipeFor(by: string, onEvent: ((e: unknown) => unknown) | null = null) {
  const store = rowsStore({ client: admin, by, url: '', key: '', onEvent })
  const site = { root: '', modules: (SITE as any).modules, admin: {} }
  const env = { root: '', store, by, theme: THEME, models: () => registry('', { site, siteModels: SITE_MODELS, store }), describe, refuseActions: (m: { key: string }, action: string) => (MACHINE.includes(action) || m.key === 'print' ? 'this runs from a checkout or the deploy, not the live admin' : null) }
  return { store, env, call: (method: string, seg: string, q: Record<string, string> = {}, body: unknown = null) => adminRequest(env, { method, seg, q, body }) }
}
export async function makerOf(caller: Caller) {
  if (!caller.id) return { by: 'api', id: 'api' }
  const { data: k } = await admin.from('api_keys').select('name, created_by').eq('id', caller.id).maybeSingle()
  const { data: p } = k?.created_by ? await admin.from('profiles').select('display_name, email').eq('id', k.created_by).maybeSingle() : { data: null }
  return { by: p?.display_name || p?.email || k?.name || 'api', id: k?.created_by || caller.id }
}
