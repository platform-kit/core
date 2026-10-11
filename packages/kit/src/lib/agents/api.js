/*
 * SUMMONING ONE, AND STOPPING IT.
 *
 * A run is a row, so starting one is a row being written and nothing waits for a model. The row
 * itself wakes the worker (a trigger over pg_net), so the button returns at once and the answer
 * arrives where the conversation is, like anybody else's.
 *
 * And because a run is a row, the surface can show it: which bot, how many steps it has taken, and
 * a way to stop it. THAT BUTTON IS THE POINT. An agent that cannot be stopped is a thing you have
 * to sit and watch; one that can is a thing you can let off the lead.
 */
import { reactive } from 'vue'
import { supabase } from '../supabase.js'
import { user, roles, isAdmin, canAccess, hasTier, hasProduct } from '../auth.js'

export const runs = reactive({ here: [], starting: false, error: null })

/*
 * WHY A RUN FAILED, said to the person who asked for it.
 *
 * "That did not work" is what the ROOM is told — it is the bot's line, and a customer has no use
 * for a stack trace. But whoever pressed the button is usually the one person who can fix it, and
 * the commonest failures are all theirs: no credits, a bad key, a rate limit, a model that is not
 * theirs to call. Hiding that behind a polite sentence means they go and read a database.
 *
 * A provider's error is JSON wrapped in a status line, so this takes the sentence out of it and
 * leaves the rest.
 */
export function whyFailed(error) {
  const raw = String(error || '').trim()
  if (!raw) return ''
  const at = raw.indexOf('{')
  if (at >= 0) {
    try {
      const body = JSON.parse(raw.slice(at))
      const said = body?.error?.message || body?.message
      if (said) return String(said).split('\n')[0].trim()
    } catch { /* not JSON after all */ }
    return raw.slice(0, at).replace(/[:\s]+$/, '')
  }
  return raw.split('\n')[0].slice(0, 200)
}

/*
 * What has run where the surface is looking. `runs.here` is the live ones — what the Stop button
 * is for — and the whole list comes back, because a finished run is the one carrying the answer.
 */
export async function runsHere(rootId) {
  if (!supabase || !rootId) { runs.here = []; return [] }
  try {
    const { data } = await supabase.rpc('agent_runs_here', { p_root: rootId })
    const all = data || []
    runs.here = all.filter((r) => ['queued', 'running'].includes(r.status))
    return all
  } catch { runs.here = []; return [] }
}

/*
 * Ask a bot something, where the asking is happening. `context` is what it should read before it
 * starts — the conversation so far — and is written onto the run rather than fetched by the bot,
 * so what it was given is a matter of record beside what it did with it.
 */
export async function summon(bot, { surface = 'spaces', channel = null, conversation = null, root = null, ask = '', context = '', command = null, args = null } = {}) {
  if (!supabase || !bot) return { error: 'no bot' }
  runs.starting = true
  runs.error = null
  try {
    /* asked for, never inserted: a client that could write the row could summon a bot it is not
       entitled to, in a room it cannot read. The database decides all three. */
    const { data, error } = await supabase.rpc('agent_summon', {
      p_bot: bot, p_surface: surface, p_channel: channel, p_conversation: conversation,
      p_root: root, p_ask: ask, p_context: context,
      /* a command by NAME and its arguments as fields — never the prompt, which is the file's */
      p_command: command, p_args: args,
    })
    if (error) throw error
    if (data && data.error) { runs.error = data.error; return data }
    runs.here = [...runs.here, { id: data.id, bot, status: 'queued', step: 0, mine: true }]
    return data
  } catch (e) {
    runs.error = e.message || String(e)
    return { error: runs.error }
  } finally { runs.starting = false }
}

/*
 * A JOB, not a conversation: a script the worker runs over one subject. The enrichment is the one
 * there is, and it exists because in cloud mode there is no machine to start a process on.
 *
 * ASKED FOR, NEVER INSERTED, like a summon — the database decides who may (administrators), whether
 * there is anywhere to buy a thought at all, and that there is not already one going for the same
 * subject. Two runs enriching the same book would each redo what the other had just cached and pay
 * for it twice, so the one already going is handed back rather than refused: pressing the button
 * again shows the run rather than an error about pressing the button again.
 */
export async function job(script, subject, { options = {}, budgetCents = null } = {}) {
  if (!supabase || !script || !subject) return { error: 'what job' }
  const { data, error } = await supabase.rpc('agent_job', {
    p_script: script, p_subject: subject, p_options: options, p_budget_cents: budgetCents,
  })
  if (error) return { error: error.message }
  return data || {}
}

/* what a run has done so far: its status, what it spent, and a line per step — for a job, which
   has no room to say anything in and so says it where it was started from */
export async function progress(runId) {
  if (!supabase || !runId) return null
  const [{ data: run }, { data: steps }] = await Promise.all([
    supabase.from('agent_runs').select('id, status, step, spent_cents, budget_cents, error, said, job').eq('id', runId).maybeSingle(),
    supabase.from('agent_steps').select('n, kind, name, request, error, cost_cents, ms').eq('run_id', runId).order('n'),
  ])
  return run ? { ...run, steps: steps || [] } : null
}

/* stop one. The row is marked; if nobody is holding it, it ends here and now, and if a worker is
   mid-step it stops at the next boundary — which is before any tool it had asked for runs. */
export async function stop(runId) {
  if (!supabase || !runId) return { error: 'no run' }
  const { data, error } = await supabase.rpc('agent_cancel', { p_run: runId })
  if (error) return { error: error.message }
  runs.here = runs.here.filter((r) => r.id !== runId)
  return data || {}
}

/*
 * WHO MAY ASK. The same audience grammar as everything else here — a list of conditions, any of
 * which lets a person through, written in the bot's or command's own markdown (`for: subscribed`,
 * `for: tier:inner`, `for: role:admin`, `for: bought:the-kybalion`); an empty list is everybody.
 *
 * This decides what is OFFERED, never what is allowed: the database asks the same question again
 * (`event_for_me` inside `agent_summon`) and it is the one that refuses. A surface that hid a
 * command would still be a surface a modified client could run it from — hence both.
 */
export function mayRun(audience) {
  const list = Array.isArray(audience) ? audience : audience ? [audience] : []
  if (!list.length) return true
  return list.some((a) => {
    if (!a || typeof a !== 'object') return false
    if (a.entitlement === 'account') return !!user.value
    if (a.entitlement) return canAccess(a.entitlement)
    if (a.tier) return hasTier(a.tier)
    if (a.product) return hasProduct(a.product)
    if (a.role) return (a.role || []).some((r) => roles.value.includes(r) || (r === 'admin' && isAdmin.value))
    return false
  })
}

/*
 * THE COMMANDS, as the composer needs them: name, hint and each argument's kind, label, default
 * and choices — everything required to draw a form and nothing else. The prompt each one runs is
 * deliberately absent (build/bots.mjs writes two files), so a client cannot send its own words
 * under a command's name; the worker fills it from its own copy.
 */
export const COMMANDS = Object.values(import.meta.glob('#content/agent-commands.json', { eager: true, import: 'default' }))[0] || []

/*
 * THE BOTS, as a surface needs them: the name to show, which surfaces they work on, what wakes
 * them and who may summon them. Never the prompt — that is the worker's, and a browser has no use
 * for it. Compiled from content/bots/*.md by build/bots.mjs; the database holds the same list and
 * is the one that refuses (`agent_summon`), so this only decides what is OFFERED.
 */
export const BOTS = Object.values(import.meta.glob('#content/agents.json', { eager: true, import: 'default' }))[0] || []
