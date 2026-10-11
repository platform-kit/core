#!/usr/bin/env node
/*
 * The declaration, made real: teams.json into the `teams` table, then the sweep.
 *
 * It is a PROJECTION and behaves like one. It is the only writer — no client has an insert, update
 * or delete policy on `teams` — and it goes one way: the file says what exists, this makes the
 * database agree, and nothing here ever reads a row back into a file.
 *
 *   · a team is upserted by its slug, so its id survives every edit and every membership hanging
 *     off it survives with it;
 *   · a team whose file has gone is DELETED, and its memberships with it — unlike a space, a team
 *     holds nothing anybody said, so there is nothing to lose by taking it away. A booking type
 *     still pointing at one is refused at the compile, before it ever gets here;
 *   · membership is never written here beyond the sweep: an invitation is an act and stays.
 *
 * With no service key, or nothing declared, it says so and does nothing.
 *
 *   node build/teams-push.mjs            project, then sweep
 *   node build/teams-push.mjs --check    say what it would do, and change nothing
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'
import { OUT } from './teams.mjs'
import { projectTeams } from './teams-io.mjs'

export async function pushTeams({ root = process.cwd(), check = false, log = console.log, db: client = null } = {}) {
  const at = join(root, OUT)
  if (!existsSync(at)) { log('teams: nothing declared — node build/teams.mjs first'); return { teams: 0 } }
  const declared = Object.values(JSON.parse(readFileSync(at, 'utf8')))
  const url = client ? '' : supabaseUrl(), key = client ? '' : serviceKey()
  if (!client && (!url || !key)) { log('teams: no database to push to'); return { teams: declared.length, pushed: 0 } }
  if (check) { log(`teams: would write ${declared.length} team(s): ${declared.map((t) => t.slug).join(', ') || '(none)'}`); return { teams: declared.length } }
  const db = client || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  /* the writes themselves are teams-io's, because the admin's Edge Function does them too where
     there is no machine to run this script (see projectTeams) */
  const out = await projectTeams({ teams: declared, db })
  log(`teams: ${out.teams} written${out.removed ? `, ${out.removed} removed` : ''}, ${out.swept} membership change(s)`)
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) await pushTeams({ check: process.argv.includes('--check') })
