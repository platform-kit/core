/*
 * RECORDED RUNS, KEPT BY MEMBERSHIP (openspec: recorded-rounds).
 *
 *   sweep   CRON (hourly, the service key): every recording run_recordings_due says has run out is deleted — its row,
 *           whose delete trigger queues its folder — and then every queued folder is emptied in the bucket and taken
 *           off the queue. So a recording deleted any way at all (its owner, an account, this sweep) leaves no file
 *           behind for longer than an hour. Answers and results are never touched.
 *
 * verify_jwt is off (pg_cron holds no user); the service key is the only way in.
 */
import { admin, json, preflight, isServiceBearer } from '../_shared/lib.ts'

const BUCKET = 'run-recordings'

/* every object under one recording's folder, removed; true when the folder is empty after */
async function emptyFolder(prefix: string): Promise<boolean> {
  for (let round = 0; round < 50; round++) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 })
    if (error) return false
    if (!data || !data.length) return true
    const { error: gone } = await admin.storage.from(BUCKET).remove(data.map((o: any) => prefix + '/' + o.name))
    if (gone) return false
  }
  return false
}

export async function sweep(): Promise<{ expired: number, emptied: number }> {
  const { data: due } = await admin.rpc('run_recordings_due')
  const ids = (due ?? []).map((r: any) => r.id)
  if (ids.length) await admin.from('run_recordings').delete().in('id', ids)
  const { data: queued } = await admin.from('run_recording_trash').select('prefix').limit(500)
  let emptied = 0
  for (const q of queued ?? []) {
    if (await emptyFolder(q.prefix)) { await admin.from('run_recording_trash').delete().eq('prefix', q.prefix); emptied++ }
  }
  return { expired: ids.length, emptied }
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!(await isServiceBearer(req))) return json({ error: 'not allowed' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  if (String(body?.action ?? '') === 'sweep') return json(await sweep())
  return json({ error: 'unknown action' }, 400)
})
