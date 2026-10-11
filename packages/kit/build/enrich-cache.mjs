/*
 * WHERE A STAGE'S RESULT IS KEPT BETWEEN CALLS.
 *
 * Enrichment is a sequence of narrow model calls, each cached under a hash of its inputs and the
 * prompt version, so a rerun redoes only what changed and a dropped connection loses one stage of
 * one chapter rather than a book. That cache is the reason a rerun is cheap, and cheap is the
 * whole point: the rule this project has about spending exists because $130 went on reruns.
 *
 * It lives in two places, and the pipeline must not know which:
 *
 *   A CHECKOUT   build/.cache/<slug>.json, beside the other build scripts, gitignored.
 *   THE CLOUD    the agent run's own state, written by the same worker that makes the calls.
 *
 * Same shape, same keys, same contents — so a book half-enriched on a machine and finished in the
 * cloud picks up where it left off, and neither can tell which wrote what.
 *
 * The shape is one blob per book: `{ understand, introduce, chapters: { <title>: … }, … }`. It is
 * loaded once at the start of a run and saved after each stage, which is what makes a stage the
 * unit of loss.
 */

export const EMPTY = () => ({ chapters: {} })

/* a checkout's: a file beside the build scripts */
export function fileCache(slug, { root = process.cwd(), fs, path } = {}) {
  if (!fs || !path) throw new Error('enrich-cache: a file cache needs fs and path handed in — this module is imported where there is neither')
  const dir = path.join(root, 'build/.cache')
  const at = path.join(dir, slug + '.json')
  return {
    where: at,
    async load() { try { return JSON.parse(fs.readFileSync(at, 'utf8')) } catch { return EMPTY() } },
    async save(c) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(at, JSON.stringify(c, null, 1)) },
  }
}

/*
 * THE CLOUD'S: the run's own state.
 *
 * It is read back from the row on every save rather than kept in memory, because the row is the
 * truth: a run is resumable, and the worker that finishes it may not be the one that started it.
 * Merging into what the row holds is how a second worker does not discard a stage the first paid
 * for — which is money, not just work.
 */
export function runCache(db, runId, { field = 'enrich' } = {}) {
  const read = async () => {
    const { data, error } = await db.from('agent_runs').select('state').eq('id', runId).single()
    if (error) throw new Error('enrich-cache: the run could not be read — ' + error.message)
    return (data && data.state && data.state[field]) || EMPTY()
  }
  return {
    where: `agent_runs.${runId}.state.${field}`,
    load: read,
    async save(c) {
      const { data } = await db.from('agent_runs').select('state').eq('id', runId).single()
      const state = { ...((data && data.state) || {}), [field]: c }
      const { error } = await db.from('agent_runs').update({ state, updated_at: new Date().toISOString() }).eq('id', runId)
      if (error) throw new Error('enrich-cache: the run could not be written — ' + error.message)
    },
  }
}
