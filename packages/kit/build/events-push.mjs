/*
 * The events, projected. What is in the files becomes rows the database can answer a community's
 * home with — `events` and the `event_occurrences` expanded from each repeat over a rolling year.
 *
 * The projection is ONE WAY and the files own it: an event no file declares is removed, and so is
 * an occurrence the repeat no longer makes. Two things survive the rewrite even so, because they
 * are acts and not declarations:
 *
 *   - an occurrence somebody has said they are coming to is kept, marked as it was, even if the
 *     rule moved: a file must never quietly cancel somebody's evening;
 *   - an occurrence called off by hand, or carrying a note, keeps both.
 *
 * Run by the deploy after the spaces are pushed (an event names a space), by `npm run db:reset`,
 * and by hand while writing one. Reads the same store as everything else, so it works in cloud
 * mode. Nothing here is a migration: the shape is declared in 95-events.sql.
 */
import { createClient } from '@supabase/supabase-js'
import { compileEvents, WINDOW_DAYS } from './events.mjs'
import { projectEvents, projectEventComments } from './events-db.mjs'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'

/*
 * The script's half: find a database from the environment, compile the declaration, hand both to
 * the projection. The projection itself is events-db.mjs, which imports no filesystem and so can
 * run inside the admin's Edge Function when somebody publishes — the only way an event becomes rows
 * where nothing rebuilds.
 */
export async function pushEvents({ root = process.cwd(), store, log = console.log, days = WINDOW_DAYS } = {}) {
  const url = supabaseUrl()
  const key = serviceKey()
  if (!url || !key) { log('events: no database to push to (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); return { pushed: 0 } }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { events, rows } = await compileEvents({ root, store, write: false })
  return projectEvents({ events, rows, db, log, days })
}

/* kept as the name the rest of the build knows it by */
export const pushEventComments = projectEventComments

if (import.meta.url === `file://${process.argv[1]}`) {
  await pushEvents()
}
