/*
 * THE WORKER. It takes ONE step of ONE run and returns.
 *
 * That is the whole design. An Edge Function is given about two minutes and then it dies, so a
 * worker that tried to hold a conversation would be a worker that loses one. Instead the database
 * holds the run and this takes a single step from it — one model call, or one tool call, or the
 * saying of an answer — writes down what happened, and asks for itself again if there is more.
 *
 * Four properties fall out of that, and each of them is why it is built this way:
 *
 *   RESUMABLE   a step is a row. A worker that dies mid-step loses that step and nothing else;
 *               the next one rebuilds the conversation from the rows and carries on. A deploy in
 *               the middle of a run is not an event.
 *   CANCELLABLE `cancel_at` is read before every step and before every tool. A run stops
 *               mid-flight, keeps what it did, and says so where it was asked.
 *   SAFE        one run is leased to one worker at a time, by a single locking statement. Two
 *               workers racing get one run each. A lease expires; a status would not.
 *   ACCOUNTABLE every call is a row with what it cost, so a bot's spend is a sum, and a run that
 *               would go over its budget stops before the call rather than after the bill.
 *
 * Called three ways: by whatever started a run (which then returns at once), by itself while there
 * is more to do, and by pg_cron for anything whose worker died (`run_agents`).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cors, json } from '../_shared/lib.ts'
import { next, messagesFor, costOf, limitsOf, endingOf, openedSkills, memoryOf } from '../_shared/agents/loop.js'
import { roomAsProse } from '../_shared/agents/model.js'
import { occurrences } from '../_shared/recurrence.js'
import { ask, providersFrom, priceOf } from '../_shared/agents/provider.js'
import { pipeline, Paused } from '../_shared/pipe/build/enrich/pipeline.mjs'
import { runCache } from '../_shared/pipe/build/enrich-cache.mjs'
import { rowsStore } from '../_shared/pipe/build/store/rows.mjs'
import { runLlm } from '../_shared/enrich/llm.js'
import BRIEFS from '../_shared/pipe/enrichment-briefs.json' with { type: 'json' }
import { BUILTINS, toolsFor, callHttp } from '../_shared/agents/tools.js'
import {
  matchSocialAutomations,
  socialAutomationPrompt,
  socialBotAllowsAnonymousSubject,
} from '../_shared/social/automation-rules.mjs'
import { cutAnswer } from '../_shared/choices.js'
import bots from '../_shared/bots.json' with { type: 'json' }
import commands from '../_shared/commands.json' with { type: 'json' }
import { of } from '../_shared/compiled.ts'
/* the catalog as this deployment has it: the shipped file, or the row a publish wrote */
const catalog = of<Record<string, any>>('catalog')

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

/* how long one worker holds a run. Long enough for a slow model call, short enough that a worker
   which died is picked up again while anybody is still waiting. */
const LEASE = 90
/*
 * HOW LONG ONE INVOCATION STAYS WITH A RUN.
 *
 * A person waiting on a bot in a room should get their answer in this invocation, not in whichever
 * one the clock happens to hand it to. So the budget is WALL CLOCK, not a step count: keep going
 * while there is time, and hand back only when there is not. The step count is left as a ceiling
 * for a caller that wants one (`{ steps: 1 }` is what a test uses to interrupt a run mid-way).
 *
 * BUDGET sits comfortably inside both the platform's wall clock for a function and LEASE, so a
 * worker always hands back before anything else may take its run off it.
 */
const BUDGET_MS = 55_000
const PER_CALL = 24
const WORKER = crypto.randomUUID().slice(0, 8)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => ({}))

  /* the service role alone: a run is machinery, and nobody's browser drives it */
  const auth = req.headers.get('authorization') || ''
  if (!auth.includes(serviceKey)) return json({ error: 'not-allowed' }, 401)

  /* what the clock is owed, before anything else: a bot that wakes on a schedule queues a run
     like any other, and the run then goes through the same loop as one somebody asked for */
  if (body.schedules) return json(await dueNow())

  /*
   * SAY WHETHER THERE IS ANYWHERE TO BUY A THOUGHT.
   *
   * This is the only thing that knows what keys it has, and every surface in the app needs to know
   * — a site with no provider must show no bot anywhere rather than offering one that cannot work.
   * So it is written down once, here, and the bots table's read policy reads it (agents_live()).
   * Cheap, and self-healing: the sweep runs every minute, so a key added or removed shows up in
   * the UI within one.
   */
  {
    const live = !providersFrom(Deno.env.toObject()).mock
    await admin.from('app_settings').upsert({ key: 'agents_live', value: live ? 'true' : 'false' }, { onConflict: 'key' })
  }

  const took: string[] = []
  const most = Math.max(1, Math.min(Number(body.steps) || PER_CALL, PER_CALL))
  const until = Date.now() + BUDGET_MS

  /*
   * CLAIM ONE RUN, THEN STAY WITH IT.
   *
   * The loop used to call claim() afresh each time round, which for a worker woken by the sweep
   * meant asking agent_claim for work while holding a ninety-second lease on the only run there
   * was — and being told, correctly, that there is nothing claimable. So every invocation took
   * exactly ONE step and handed back, and the run then waited for the next minute's cron for its
   * next one. A six-step answer took three and a half minutes of which three were spent waiting,
   * and from the room it looked like the bot had hung.
   *
   * Holding the run by its id is the same update without the where-clause that excludes us, so it
   * both re-reads the row (the spend, a cancel that has landed) and pushes the lease out.
   */
  let run = await claim(body.run)
  while (run) {
    const more = await step(run)
    took.push(`${run.bot}:${run.id.slice(0, 8)}`)
    if (took.length >= most || Date.now() >= until) break
    /* finished: take the next one waiting, if there is one. Still going: stay with this one. */
    run = more ? await claim(run.id) : await claim()
  }

  /*
   * ANYTHING CLAIMABLE is asked for again, so a run keeps moving without a person waiting on the
   * clock. CLAIMABLE, not merely unfinished — and the difference is the difference between a
   * follow-up and a stampede.
   *
   * A run being worked on by somebody else is unfinished but not claimable: its lease is held. If
   * this asked for another worker on "unfinished", that worker would claim nothing, find the run
   * still unfinished, and ask for another — immediately, with no model call to slow it down — and
   * so on for as long as the lease had left to run. Hundreds of invocations, none of them doing
   * anything. The condition was harmless only for as long as the follow-up was an un-awaited fetch
   * that never actually left; making that call work is what makes this matter.
   *
   * Asking on "claimable" terminates by itself: a worker that fires one and finds the run taken
   * sees nothing claimable and fires nothing. pg_cron remains the backstop for a lease that
   * expires with nobody watching.
   */
  const { count } = await admin.from('agent_runs').select('*', { count: 'exact', head: true })
    .in('status', ['queued', 'running']).is('cancel_at', null)
    .or('lease_until.is.null,lease_until.lt.' + new Date().toISOString())
  if (count) await queueAnother()
  return json({ ok: true, took, waiting: count || 0 })
})

/*
 * WHAT THE CLOCK IS OWED.
 *
 * A bot may say `hears: [{ schedule: …, in: <space>/<channel>, ask: … }]`, and something has to
 * ask, on the hour, whether that time has come. That is this, called by pg_cron.
 *
 * The clock is kept ON THE BOT (`fired_at`) rather than worked out from its runs, and the rule is
 * "the next occurrence after the last firing has passed". Two things fall out, and both are what
 * you want: a run that was cancelled or failed still counts as the Monday having happened, so
 * nothing is sent twice; and a deployment that was down for a day wakes once when it comes back,
 * not once for every hour it missed. A bot that has never fired is caught up to now rather than
 * replaying its whole history.
 */
async function dueNow() {
  const now = Date.now()
  const { data: rows } = await admin.from('bots').select('slug, hears, fired_at').eq('published', true)
  const queued: string[] = []
  for (const b of rows ?? []) {
    for (const h of (b.hears ?? []) as any[]) {
      if (h?.kind !== 'schedule' || !h.repeats || !h.in) continue
      const since = b.fired_at ? Date.parse(b.fired_at) : now
      /* EVERY occurrence between the last firing and now, of which only the LAST is owed: a site
         that was down for a week says good morning once when it comes back, not seven times over
         the next half hour. An occurrence is a span; what is owed is when it began. */
      const missed = occurrences(h.repeats, { from: since + 1, to: now, limit: 400 })
      const due = missed.length ? missed[missed.length - 1].start : null
      if (!due) {
        /* a bot that has never fired gets its clock started, so the first firing is the next
           occurrence and never a backlog of every one since the file was written */
        if (!b.fired_at) await admin.from('bots').update({ fired_at: new Date(now).toISOString() }).eq('slug', b.slug)
        continue
      }
      const channel = await channelAt(String(h.in))
      if (!channel) continue                      /* the room the file names is not there (yet) */
      /* stamped BEFORE the run is made: a failure to queue is a missed turn, never a repeat */
      await admin.from('bots').update({ fired_at: new Date(due).toISOString() }).eq('slug', b.slug)
      const { data: run } = await admin.from('agent_runs').insert({
        bot: b.slug, surface: 'spaces', channel_id: channel, root_id: channel, status: 'queued',
        state: { messages: [{ role: 'user', content: String(h.ask || '') }] },
      }).select('id').single()
      if (run) queued.push(b.slug)
    }
  }
  if (queued.length) queueAnother()
  return { ok: true, queued }
}

/* `<space>/<channel>`, as a bot's file names a room */
async function channelAt(path: string) {
  const [space, channel] = path.split('/')
  if (!space || !channel) return null
  const { data } = await admin.from('channels')
    .select('id, spaces!inner(slug)').eq('slug', channel).eq('spaces.slug', space).maybeSingle()
  return data ? (data as any).id : null
}

/* ------------------------------------------------------------------ one run, one step */

async function claim(id?: string) {
  if (id) {
    const { data } = await admin.from('agent_runs').update({
      status: 'running', worker: WORKER, lease_until: new Date(Date.now() + LEASE * 1000).toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id).in('status', ['queued', 'running']).select().maybeSingle()
    return data || null
  }
  const { data } = await admin.rpc('agent_claim', { p_worker: WORKER, p_lease_seconds: LEASE })
  return data || null
}

/*
 * A RUN IS A CONVERSATION OR A JOB, never both (the table's own constraint), and a job walks stages
 * instead of turns. Everything else about a run is the same and stays the same: the claim, the
 * lease, the cancel, the budget, the step rows, the asking-for-itself-again — none of which ever
 * looked at what kind of run it was.
 *
 * ONE INVOCATION IS NOT ONE JOB. A book has more stages than a function has minutes, so the pipeline
 * is given a DEADLINE and stops before a call it cannot finish; every stage that did finish is in
 * the run's own state, saved as it went, and the next invocation carries on from there. Which is
 * what the cache was built for: a book half-enriched on a machine and finished here picks up where
 * it left off rather than paying twice.
 */
async function jobStep(run: any) {
  const job = run.job || {}
  const slug = String(job.subject || '')
  const opts = job.options || {}
  if (job.script !== 'enrich') return void await finish(run, 'failed', `no job called ${job.script}`)
  if (!slug) return void await finish(run, 'failed', 'a job needs a subject: which book?')
  if (!Object.keys(BRIEFS as Record<string, string>).length) {
    return void await finish(run, 'failed', 'this deployment has no enrichment briefs compiled in — the site names none, or the last build could not read the module it names')
  }

  const providers = providersFrom(Deno.env.toObject())
  /* a scripted job is a rehearsal and is never bought: the mock rides on the run, as it does for a bot */
  const llm = runLlm({ run, providers, model: opts.model || undefined, admin, think: opts.think || 'low', mock: run.state?.mock || null })
  if (!llm.ready()) return void await finish(run, 'failed', llm.missingKey())

  /* what a run says about itself as it goes: a line per stage, kept on the row so the drawer can
     show it without reading every step back */
  const said: string[] = []
  const log = (...a: unknown[]) => { const line = a.map(String).join(' ').replace(/^\n+/, ''); if (line.trim()) said.push(line) }

  const store = rowsStore({ client: admin, by: run.asked_by || null, url: '', key: '' })
  const cache = runCache(admin, run.id)
  const { enrich } = pipeline({
    briefs: BRIEFS, llm, log,
    write: true, review: false,
    force: !!opts.force, writeModel: opts.writeModel || '', stage: opts.stage || 'all',
    chapters: Array.isArray(opts.chapters) ? opts.chapters : [],
    /* the run's budget in dollars, so the pipeline's guard and the run's are one number */
    maxSpend: Number(run.budget_cents) > 0 ? Number(run.budget_cents) / 100 : Number(opts.maxSpend) || 1,
    /* room for the call in flight to come back inside the invocation */
    deadline: Date.now() + BUDGET_MS,
  })

  try {
    const report = await enrich(slug, { store, cache })
    const failed = (report.failed || []).length
    await finish(run, failed ? 'failed' : 'done', failed ? `${failed} chapter(s) without a draft: ${report.failed.join(', ')}` : null, said.slice(-40).join('\n'))
    return false
  } catch (e) {
    /* OUT OF TIME IS NOT A FAILURE. Nothing is finished, nothing is lost, and the run stays
       claimable so the next worker — this one, a moment later, or the sweep's — carries on. */
    if (e instanceof Paused) {
      /* THE LEASE, AND NOTHING ELSE. Writing `state` here from the row this invocation started with
         would put back the version it read BEFORE the pipeline saved its cache into it — every
         stage this invocation paid for, thrown away, and the next one paying for them again. The
         cache is the pipeline's to write and its save already merges; a worker has no business
         touching the same column behind it. */
      await admin.from('agent_runs').update({ lease_until: null, updated_at: new Date().toISOString() }).eq('id', run.id)
      return true
    }
    await admin.from('agent_steps').insert({ run_id: run.id, n: Number(run.step || 0), kind: 'note', name: job.script, error: String((e as Error).message || e) })
    /* WITH WHAT IT SAID ON THE WAY DOWN. The narration was only written on the success path, so a
       run that threw — the one time anybody needs to read it — finished with an empty log and a
       one-line error. A failure keeps its last forty lines like any other ending. */
    await finish(run, 'failed', String((e as Error).message || e), said.slice(-40).join('\n'))
    return false
  }
}

async function socialRunInput(run: any, bot: any) {
  const responseId = run.state?.social_response_id
  if (!responseId || !socialBotAllowsAnonymousSubject(bot)) return null
  const { data: response, error: responseError } = await admin
    .from('social_automation_responses')
    .select('id, account_id, automation_id, event_id, destination, mode, status, bot_run_id, body')
    .eq('id', responseId)
    .maybeSingle()
  if (responseError) throw new Error(`social response lookup failed: ${responseError.message}`)
  if (
    !response ||
    !['generating', 'draft'].includes(response.status) ||
    (response.bot_run_id && response.bot_run_id !== run.id)
  ) return null

  const [automationResult, eventResult, accountResult] = await Promise.all([
    admin.from('social_automations').select('*').eq('id', response.automation_id).maybeSingle(),
    admin.from('social_inbound_events').select('*').eq('id', response.event_id).maybeSingle(),
    admin.from('social_accounts').select('id, backend_id, provider_id, external_id').eq('id', response.account_id).maybeSingle(),
  ])
  for (const [label, result] of [
    ['automation', automationResult],
    ['event', eventResult],
    ['account', accountResult],
  ] as const) {
    if (result.error) throw new Error(`social ${label} lookup failed: ${result.error.message}`)
  }
  const automation = automationResult.data
  const event = eventResult.data
  const account = accountResult.data
  if (
    !automation ||
    !event ||
    !account ||
    automation.bot_slug !== run.bot ||
    response.account_id !== automation.account_id ||
    event.account_id !== response.account_id ||
    event.backend_id !== account.backend_id ||
    event.provider_id !== account.provider_id ||
    event.event_kind !== automation.event_kind ||
    response.mode !== automation.mode ||
    !automation.destinations?.includes(response.destination) ||
    !matchSocialAutomations({ event, account, automations: [automation], bots: [bot] }).length
  ) return null

  const content = socialAutomationPrompt(event, account.external_id)
  if (!content) return null
  const state = { ...(run.state || {}), social_response_id: response.id, messages: [{ role: 'user', content }] }
  delete state.context
  delete state.before
  delete state.command
  delete state.args
  const { data: linked, error: linkError } = await admin
    .from('social_automation_responses')
    .update({ bot_run_id: run.id })
    .eq('id', response.id)
    .eq('status', response.status)
    .or(`bot_run_id.is.null,bot_run_id.eq.${run.id}`)
    .select('id')
    .maybeSingle()
  if (linkError) throw new Error(`social response link failed: ${linkError.message}`)
  if (!linked) return null
  const { error: stateError } = await admin
    .from('agent_runs')
    .update({ state, updated_at: new Date().toISOString() })
    .eq('id', run.id)
  if (stateError) throw new Error(`social run context save failed: ${stateError.message}`)
  return { ...run, state }
}

async function failSocialRun(run: any, reason: string, status = 'failed') {
  const responseId = run.state?.social_response_id
  if (responseId) {
    const { error } = await admin
      .from('social_automation_responses')
      .update({ status: 'failed', last_error: reason })
      .eq('id', responseId)
      .eq('status', 'generating')
    if (error) throw new Error(`social response failure update failed: ${error.message}`)
  }
  await finish(run, status, reason)
  return false
}

async function step(run: any) {
  if (run.job) return await jobStep(run)
  const bot = (bots as any[]).find((b) => b.slug === run.bot)
  if (!bot) return void await finish(run, 'failed', `no bot called ${run.bot}`)
  if (run.surface === 'social') {
    const prepared = await socialRunInput(run, bot)
    if (!prepared) return await failSocialRun(run, 'Social response is no longer eligible for generation.')
    run = prepared
  }
  if (run.state?.command && !(run.state.messages || []).length) {
    const asked = await fromCommand(run)
    if (!asked) return void await finish(run, 'failed', `no command called ${run.state.command}`)
    run = asked
  }

  /* a bot that remembers the person is given what that person asked before — once, on the run, so a
     resumed run on another machine builds the same conversation. Resolved from the run, so it is
     the SUBJECT's history and never the asker's. */
  if (run.surface !== 'social' && (memoryOf(bot) === 'person' || memoryOf(bot) === 'person+recall') && !(run.state && run.state.before)) {
    const { data: recalled } = await admin.rpc('agent_recall', { p_run: run.id, p_limit: 6 })
    const state = { ...(run.state || {}), before: recalled || [] }
    await admin.from('agent_runs').update({ state, updated_at: new Date().toISOString() }).eq('id', run.id)
    run = { ...run, state }
  }

  /*
   * WHAT THE ROOM SAID, read here. Never a parameter: see the note over messagesFor. The prose is
   * built with the same roomAsProse the surface draws a line with, so what a bot is handed and what
   * a person reads are one thing.
   */
  if (!(run.state && run.state.context)) {
    const { data: rows } = await admin.rpc('agent_transcript', { p_run: run.id, p_limit: 60 })
    const W = bot.context || {}
    const said = roomAsProse(rows || [], {
      words: bot.events || {}, unheard: W.voice, someone: W.someone,
      who: run.surface === 'spaces' ? undefined : (m: any) => (m.mine ? W.us : W.them),
      names: Object.fromEntries((rows || []).filter((m: any) => m.author_id)
        .map((m: any) => [m.author_id, m.name || W.someone])),
    })
    if (said) {
      const inThread = run.surface === 'spaces' && run.root_id && run.root_id !== run.channel_id
      const head = String((run.surface !== 'spaces' ? W.desk : inThread ? W.thread : W.channel) || '')
      const state = { ...(run.state || {}), context: [head, said].filter(Boolean).join('\n') }
      await admin.from('agent_runs').update({ state, updated_at: new Date().toISOString() }).eq('id', run.id)
      run = { ...run, state }
    }
  }

  /* WHAT THIS RUN MAY USE. Every tool and skill the bot declares, with its audience, asked of the
     database in one go — and the answer filters the tool list and the skills line together, because
     a skill named in the prompt whose tool was withheld is a model reaching for nothing. */
  const named: Record<string, unknown> = {}
  for (const s of bot.skills || []) if (s && s.name) named[s.name] = s.audience || []
  for (const n of bot.tools || []) named[n] = ((bot.declared || {})[n] || {}).audience || []
  let allowed: Set<string> | null = null
  if (Object.values(named).some((a: any) => (a || []).length)) {
    const { data: ok } = await admin.rpc('agent_permits', { p_run: run.id, p_named: named })
    allowed = new Set<string>((ok || []) as string[])
  }
  run = { ...run, allowed }

  const { data: steps } = await admin.from('agent_steps').select('*').eq('run_id', run.id).order('n')
  const taken = steps || []
  const what = next({ run, bot, steps: taken, now: Date.now() })

  if (what.do === 'stop') {
    /* a run that stops without an answer still says something where it was asked, unless it was
       cancelled by the person who asked — they know why it stopped, they stopped it */
    const say = what.why === 'cancelled' ? null : endingOf(what.why, bot.endings || {})
    if (run.surface === 'social') {
      return await failSocialRun(
        run,
        `Social response generation stopped: ${what.why}.`,
        what.why === 'cancelled' ? 'cancelled' : 'failed',
      )
    }
    if (say) await post(run, bot, say)
    return void await finish(run, what.why === 'cancelled' ? 'cancelled' : (what.why === 'nothing-said' ? 'done' : 'failed'), what.why)
  }

  if (what.do === 'say') {
    const posted = await post(run, bot, what.text)
    if (run.surface === 'social' && posted !== true) {
      return await failSocialRun(run, 'The Social response draft could not be saved.')
    }
    await admin.from('agent_steps').insert({ run_id: run.id, n: taken.length, kind: 'say', response: { text: what.text } })
    return void await finish(run, 'done', null, what.text)
  }

  if (what.do === 'model') return await think(run, bot, taken, what.messages)
  if (what.do === 'tool') return await use(run, bot, taken, what)
  return false
}

/*
 * A COMMAND'S PROMPT IS RESOLVED HERE, NEVER SENT.
 *
 * The browser knows a command's name and the shape of its arguments, because it has to draw the
 * form; it does not know what the command asks the bot. That stays in the file it was compiled
 * from, so /summarise always means what the file says it means — a client cannot send its own
 * words under a command's name, and changing what a command does is an edit in a pull request.
 *
 * The arguments are filled in by name and anything the command did not declare is dropped, so the
 * prompt is built from the fields somebody was offered and from nothing else.
 */
async function fromCommand(run: any) {
  const cmd = (commands as any[]).find((c) => c.name === run.state.command)
  if (!cmd) return null
  const given = run.state.args || {}
  const args: Record<string, string> = {}
  for (const a of cmd.args || []) {
    const v = given[a.name] ?? a.default
    args[a.name] = v == null ? '' : String(v).slice(0, 400)
  }
  const ask = String(cmd.prompt || '').replace(/\{(\w+)\}/g, (_m, k) => (args[k] == null ? '' : args[k]))
  const state = { ...run.state, messages: [{ role: 'user', content: ask }] }
  await admin.from('agent_runs').update({ state, updated_at: new Date().toISOString() }).eq('id', run.id)
  return { ...run, state }
}

/* --- a model call --- */
async function think(run: any, bot: any, taken: any[], messages: any[]) {
  const providers = providersFrom(Deno.env.toObject())
  /* the model the bot asked for goes to the FIRST provider; a fallback uses its own */
  const model = bot.model || providers.list[0]?.model
  const tools = toolsFor({ bot, declared: bot.declared || {}, surface: run.surface, opened: openedSkills(taken), allowed: run.allowed })
  const began = Date.now()
  try {
    /* the mock's script rides on the system message, so the provider needs to know nothing of runs */
    const msgs = run.state?.mock
      ? messages.map((m: any, i: number) => (i === 0 && m.role === 'system'
        ? { ...m, content: `${m.content}\n<<mock:${JSON.stringify(run.state.mock)}>>` }
        : m))
      : messages
    const out = await ask({ providers, model, messages: msgs, tools })
    /* costed on what ANSWERED, not on what was asked: a fallback is a different model and a
       different price, and a bill that says otherwise is a bill nobody can check */
    const cost = costOf({ tokensIn: out.usage.in, tokensOut: out.usage.out }, priceOf(out.model || model))
    await admin.from('agent_steps').insert({
      run_id: run.id, n: taken.length, kind: 'model', name: out.model || model,
      request: {
        messages: messages.length, tools: tools.map((t: any) => t.name),
        ...(out.provider ? { provider: out.provider } : {}),
        /* said out loud, because a site quietly paying a second vendor is a thing to notice */
        ...(out.fellBackFrom ? { fell_back_from: out.fellBackFrom } : {}),
      },
      response: { message: out.message },
      tokens_in: out.usage.in, tokens_out: out.usage.out, cost_cents: cost, ms: Date.now() - began,
    })
    await admin.from('agent_runs').update({
      step: taken.length + 1, spent_cents: Number(run.spent_cents || 0) + cost,
      lease_until: new Date(Date.now() + LEASE * 1000).toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', run.id)
    return true
  } catch (e) {
    await admin.from('agent_steps').insert({
      run_id: run.id, n: taken.length, kind: 'model', name: model, error: String((e as Error).message || e), ms: Date.now() - began,
      request: { providers: providers.list.map((x: any) => x.id) },
    })
    await post(run, bot, endingOf('failed', bot.endings || {}))
    await finish(run, 'failed', String((e as Error).message || e))
    return false
  }
}

/* --- a tool call --- */
async function use(run: any, bot: any, taken: any[], what: any) {
  const began = Date.now()
  /* CHECKED AGAIN, right here. The model asked for this some seconds ago; between then and now
     somebody may have pressed stop, and a tool is the step that changes the world. */
  const { data: fresh } = await admin.from('agent_runs').select('cancel_at').eq('id', run.id).maybeSingle()
  if (fresh?.cancel_at) { await finish(run, 'cancelled', 'cancelled'); return false }

  let result: any = null
  let error: string | null = null
  try {
    /* ON OFFER, OR NOT AT ALL. A model may name a tool it was never given — a skill's tool before
       the skill is open, a desk tool in a room — and the answer is the same as if it did not exist. */
    const offered = toolsFor({ bot, declared: bot.declared || {}, surface: run.surface, opened: openedSkills(taken), allowed: run.allowed })
    if (!offered.some((t: any) => t.name === what.name)) throw new Error(`no tool called ${what.name}`)
    const builtin = (BUILTINS as any)[what.name]
    if (builtin) {
      if (builtin.needs === 'desk' && run.surface !== 'support') throw new Error('that is not something I can do here')
      /* no asker is passed. A personal tool names the RUN and the database resolves whose data that
         is, so there is no identity here to hand it the wrong one of. The "nobody to ask about"
         case is the function's null, answered in the bot's own words. */
      result = await builtin.run({
        admin, run: run.id, args: what.args, ctx: ctxOf(run), catalog, bot,
        words: (bot.words || {}),
      })
    } else {
      const declared = (bot.declared || {})[what.tool || what.name]
      if (!declared) throw new Error(`no tool called ${what.name}`)
      if (declared.kind === 'openapi') {
        const tool = (declared.tools || []).find((t: any) => t.name === what.name)
        if (!tool) throw new Error(`no operation called ${what.name}`)
        const headers: Record<string, string> = {}
        if (declared.auth?.header && declared.auth?.env) {
          const v = Deno.env.get(declared.auth.env)
          if (v) headers[declared.auth.header] = (declared.auth.prefix || '') + v
        }
        result = await callHttp(tool, what.args, { headers })
      } else if (declared.kind === 'code') {
        const mod = await import(declared.module)
        /* a site's own code tool is given the run and the subject, never the asker — the same rule
           as the kit's own: what it may look up is decided by who the run is about */
        result = await (mod.run || mod.default)({
          args: what.args, ctx: ctxOf(run), run: run.id, admin, env: Deno.env.toObject(),
        })
      } else throw new Error(`tool ${what.name} is of a kind I do not know`)
    }
  } catch (e) { error = String((e as Error).message || e) }

  await admin.from('agent_steps').insert({
    run_id: run.id, n: taken.length, kind: 'tool', name: what.name,
    request: { args: what.args }, response: { call: what.call, result: error ? { error } : result },
    error, ms: Date.now() - began,
  })
  await admin.from('agent_runs').update({
    step: taken.length + 1, lease_until: new Date(Date.now() + LEASE * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', run.id)
  return true
}

/* ------------------------------------------------------------------ who a tool answers for */

/*
 * A BOT IS NOT A WAY AROUND A POLICY, AND IT NEVER HOLDS AN IDENTITY IT COULD MISUSE.
 *
 * The obvious thing would be to hand every tool a client that IS the person being answered, so RLS
 * does the work. There is no honest way to do that here: the platform will not mint a user's token
 * for a machine, and a service-role client wearing a header that says who it would like to be is a
 * lie that looks like a policy.
 *
 * So a tool that touches somebody's own things is given THE RUN, and the database resolves whose
 * data that is (agent_subject). Nothing here is told who anybody is, which is the point: the first
 * version of this passed `asker` — the person who pressed the button — and on a support desk that
 * is a member of staff, so every personal tool returned the agent's own purchases and membership
 * and the bot wrote a draft to the customer about them. Passing the subject instead would have
 * fixed that one case and left the next tool to reach for whatever was in scope. There is now
 * nothing in scope.
 *
 * ctxOf is what a tool may know about WHERE it is, and carries no identity at all.
 */
const ctxOf = (run: any) => ({
  surface: run.surface, channel: run.channel_id, conversation: run.conversation_id,
  root: run.root_id,
})

/* ------------------------------------------------------------------ saying it */

/* where a run is talking. The same answer goes to a room, a support thread or a coaching thread,
   through whatever that surface's own writer is — a bot posts the way a person posts. */
/*
 * WHERE AN ANSWER GOES, AND WHOSE NAME IT IS IN.
 *
 * In a room a bot speaks as itself: the line carries its name, everybody can see a bot said it,
 * and posting is the whole point of summoning one. On a desk it would be speaking as the person
 * on the desk, to a customer, in a thread that then reads as answered — so by default it does not
 * speak at all. It hands back a draft (`said` on the run) and a human decides whether to send it.
 *
 * A bot may say `answers: directly` in its own markdown and take the desk over — a bot that IS
 * the coach, or a front line nobody is staffing. That is a decision somebody writes down, in a
 * file, in a pull request; it is never what happens because nobody thought about it.
 */
async function post(run: any, bot: any, text: string): Promise<boolean | void> {
  if (!text) return
  if (run.surface === 'social') {
    const responseId = run.state?.social_response_id
    if (!responseId) return false
    const body = text.trim()
    const { data: response, error: responseError } = await admin
      .from('social_automation_responses')
      .select('id, bot_run_id, status, body')
      .eq('id', responseId)
      .maybeSingle()
    if (responseError) throw new Error(`social draft lookup failed: ${responseError.message}`)
    if (
      response?.bot_run_id === run.id &&
      response.status === 'draft' &&
      response.body === body
    ) return true
    if (response?.bot_run_id !== run.id || response.status !== 'generating') return false
    const { data: saved, error } = await admin
      .from('social_automation_responses')
      .update({ body, status: 'draft', last_error: null })
      .eq('id', responseId)
      .eq('bot_run_id', run.id)
      .eq('status', 'generating')
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`social draft save failed: ${error.message}`)
    return Boolean(saved)
  }
  const drafts = run.surface !== 'spaces' && (bot?.answers || 'draft') !== 'directly'
  if (drafts) return                              /* the draft is `said`, written by finish() */
  /*
   * WHAT IT OFFERED, CUT OFF WHAT IT SAID. An answer whose last lines are a `- ` list ends in
   * buttons, in the grammar the desk's prompts are already written in — so a model writes markdown
   * rather than learning a syntax, and a bot that writes a list by accident gets buttons saying
   * exactly what its list said. The cut happens HERE, once, on the way into the row: a client that
   * reparsed the words would show the reader the grammar the first time it disagreed, and two
   * clients would disagree with each other.
   */
  const cut = cutAnswer(text)
  text = cut.text
  /* A run is rooted where the surface is looking, which in a space is the channel itself unless
     somebody summoned the bot inside a thread. Only the second is a thread root. */
  const inThread = run.root_id && run.root_id !== run.channel_id ? run.root_id : null
  let error: any = null
  if (run.surface === 'spaces' && run.channel_id) {
    ;({ error } = await admin.from('space_messages').insert({
      channel_id: run.channel_id, kind: 'system', body: text,
      thread_root_id: inThread,
      meta: { bot: run.bot, name: bot?.name || run.bot, run: run.id, ...(cut.choices.length ? { choices: cut.choices } : {}) },
    }))
  } else if (run.surface === 'support' && run.conversation_id) {
    ;({ error } = await admin.from('support_messages').insert({
      conversation_id: run.conversation_id, author: 'agent', kind: 'text', body: text,
      /* an agent's line and a bot's are both the business answering, and a reader is owed the
         difference — the widget cannot offer "talk to a person" without it */
      bot: run.bot, choices: cut.choices,
    }))
  } else if (run.surface === 'coaching' && run.conversation_id) {
    ;({ error } = await admin.from('messages').insert({
      conversation_id: run.conversation_id, sender_id: run.state?.as || null, kind: 'text', body: text,
    }))
  }
  /* A RUN THAT COULD NOT SAY ITS ANSWER IS NOT A RUN THAT WENT WELL. It keeps the answer — the row
     holds what it said — but the failure is written down rather than swallowed, because a bot that
     silently says nothing is indistinguishable from a bot that is broken. (These calls RETURN their
     errors; they do not throw, which is how this went unnoticed once.) */
  if (error) {
    await admin.from('agent_steps').insert({
      run_id: run.id, n: 9999, kind: 'say', name: 'post', error: String(error.message || error),
    })
  }
}

async function finish(run: any, status: string, why: string | null, said?: string) {
  await admin.from('agent_runs').update({
    status, error: status === 'failed' ? why : null, said: said || null,
    finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), lease_until: null,
  }).eq('id', run.id)
}

/*
 * ASK FOR OURSELVES AGAIN — and make sure the ask actually leaves.
 *
 * A fetch started and not awaited is killed when the isolate is torn down after the response, so
 * this call was usually never made at all and the run waited for pg_cron instead. waitUntil is how
 * the platform is told to keep the isolate alive for it; cal-webhook does the same thing for the
 * same reason. Where there is no waitUntil (a plain Deno, a test) we wait for it ourselves.
 */
function queueAnother(): Promise<void> {
  const go = fetch(`${url}/functions/v1/agent-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + serviceKey },
    body: JSON.stringify({ sweep: true }),
  }).then(() => {}, () => {})
  const rt = (globalThis as any).EdgeRuntime
  if (rt && typeof rt.waitUntil === 'function') { rt.waitUntil(go); return Promise.resolve() }
  return go
}
