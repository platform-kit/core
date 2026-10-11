/*
 * THE BOTS, MADE REAL — the half that needs a database and not a disk.
 *
 * The WORKER reads the compiled file the function carries: one copy of what a bot is, and it is the
 * file. But the SURFACE has to know which bots exist and whether this person may summon one, and
 * that is a question only the database can answer against somebody's standing. So the declaration's
 * face is projected here — name, surfaces, audience — and nothing the worker needs.
 *
 * One way, and the files own it: a bot no file declares is removed.
 *
 * It lives apart from bots-push.mjs because that file reaches for the environment (tts/storage.mjs,
 * which opens .env) to find a database, and a file that touches the filesystem at import time
 * cannot be in the admin's pipe. This half imports none, so a publish can run it where nothing
 * rebuilds.
 */
export async function projectBots({ bots, db, log = () => {} } = {}) {
  const list = bots || []
  const { data: had, error: selectError } = await db.from('bots').select('id, slug')
  if (selectError) throw new Error(`bots: could not read existing rows: ${selectError.message}`)
  if (!Array.isArray(had)) throw new Error('bots: could not read existing rows: expected a row list')
  const idOf = new Map(had.map((b) => [b.slug, b.id]))
  let n = 0
  for (const b of list) {
    const row = {
      slug: b.slug, name: b.name, avatar: b.avatar, model: b.model,
      surfaces: b.surfaces, audience: b.audience, serves: b.serves || [], offer: b.offer || 'off', spaces: b.spaces, hears: b.hears,
      tools: b.tools, limits: b.limits, memory: b.memory, extends: b.extends,
      prompt: b.prompt, published: true, updated_at: new Date().toISOString(),
    }
    const id = idOf.get(b.slug)
    if (id) {
      const { error } = await db.from('bots').update(row).eq('id', id)
      if (error) throw new Error(`bots: ${b.slug}: ${error.message}`)
    }
    else {
      const { error } = await db.from('bots').insert(row)
      if (error) throw new Error(`bots: ${b.slug}: ${error.message}`)
    }
    n++
  }
  let gone = 0
  for (const b of had) if (!list.some((x) => x.slug === b.slug)) {
    const { error } = await db.from('bots').delete().eq('id', b.id)
    if (error) throw new Error(`bots: could not remove ${b.slug}: ${error.message}`)
    gone++
  }
  log(`bots: ${n} declared${gone ? `, ${gone} gone` : ''}`)
  return { pushed: n, gone }
}
