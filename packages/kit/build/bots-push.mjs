/*
 * The bots, projected. The WORKER reads the compiled file the function carries — one copy of what
 * a bot is, and it is the file — but the surface has to know which bots exist and whether this
 * person may summon one, and that is a question only the database can answer against somebody's
 * standing. So the declaration's face is projected here: name, surfaces, audience, and nothing the
 * worker needs.
 *
 * One way, and the files own it: a bot no file declares is removed.
 */
import { createClient } from '@supabase/supabase-js'
import { compileBots } from './bots.mjs'
import { projectBots } from './bots-db.mjs'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'

/* the script's half: find a database from the environment, compile the declaration, hand both to
   the projection — which is bots-db.mjs, and imports no filesystem, so a publish can run it */
export async function pushBots({ root = process.cwd(), store, log = console.log } = {}) {
  const url = supabaseUrl()
  const key = serviceKey()
  if (!url || !key) { log('bots: no database to push to'); return { pushed: 0 } }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { bots } = await compileBots({ root, store, write: false })
  return projectBots({ bots, db, log })
}

if (import.meta.url === `file://${process.argv[1]}`) await pushBots()
