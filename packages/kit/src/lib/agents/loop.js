/*
 * WHAT A RUN DOES NEXT — the decision at the middle of the agent loop, as a pure function.
 *
 * The worker's job is small on purpose: claim a run, ask this what to do, do that one thing, write
 * down what happened, and return. Everything that decides — has it been cancelled, is it out of
 * money, out of steps, out of time, is the model asking for a tool, has it finished — is here,
 * where it can be tested without a database, a model or a network.
 *
 * That split is the whole reliability story. A loop whose decisions live inside an async function
 * that also does the calling can only be tested by running it, which means it is only ever tested
 * on the happy path. This way the awkward cases — cancelled between a model call and its tool call,
 * a tool that throws, a budget that runs out mid-thought, a worker that dies holding a lease — are
 * ordinary inputs.
 *
 * Pinned by build/agents.test.mjs.
 */

/* what a step costs, before it is taken. A price is per million tokens, which is how every
   provider quotes one; a model the site has not priced costs nothing and is simply not counted. */
export function costOf({ tokensIn = 0, tokensOut = 0 } = {}, price = {}) {
  const inM = Number(price.in) || 0
  const outM = Number(price.out) || 0
  const cents = ((tokensIn / 1e6) * inM + (tokensOut / 1e6) * outM) * 100
  return Math.round(cents * 100) / 100
}

/* the limits a run is held to, with the kit's own defaults where a bot says nothing */
export const LIMITS = { steps: 12, spend: 50, minutes: 10, tools: 24 }
export function limitsOf(bot = {}, run = {}) {
  const l = bot.limits || {}
  return {
    steps: Number(l.steps) > 0 ? Number(l.steps) : LIMITS.steps,
    /* a bot's spend is written in the money people think in, and kept in the money a row holds */
    spend: Number(run.budget_cents) > 0 ? Number(run.budget_cents)
      : Number(l.spend) > 0 ? Math.round(Number(l.spend) * 100) : LIMITS.spend,
    minutes: Number(l.minutes) > 0 ? Number(l.minutes) : LIMITS.minutes,
    tools: Number(l.tools) > 0 ? Number(l.tools) : LIMITS.tools,
  }
}

/* ------------------------------------------------------------------ what to do next */

/*
 * Given a run as the database holds it, the bot as its file declares it, and the steps taken so
 * far, say what the worker should do now. One of:
 *
 *   { do: 'stop',  why, say }     — finished, cancelled, or spent; the worker writes the ending
 *   { do: 'model', messages }     — ask the model, with the conversation built from the steps
 *   { do: 'tool',  name, args, call }  — run one tool the model asked for
 *   { do: 'say',   text }         — post what the model wrote where the run is talking
 *
 * `now` is passed in, never read, so a deadline is testable.
 */
export function next({ run = {}, bot = {}, steps = [], now = Date.now() } = {}) {
  const lim = limitsOf(bot, run)
  const spent = Number(run.spent_cents) || 0

  /* CANCELLED FIRST, always. A run is stopped between steps and at every tool boundary, so the
     check has to come before anything that would cost money or change the world. */
  if (run.cancel_at) return { do: 'stop', why: 'cancelled', say: null }
  if (['done', 'failed', 'cancelled'].includes(run.status)) return { do: 'stop', why: run.status, say: null }

  /* the three ways a run may be out of room. Each is checked BEFORE the call that would breach it,
     which is the difference between a budget and a receipt. */
  if (run.deadline_at && new Date(run.deadline_at).getTime() <= now) return { do: 'stop', why: 'time', say: null }
  if (spent >= lim.spend) return { do: 'stop', why: 'spend', say: null }
  const modelSteps = steps.filter((s) => s.kind === 'model').length
  if (modelSteps >= lim.steps) return { do: 'stop', why: 'steps', say: null }
  if (steps.filter((s) => s.kind === 'tool').length >= lim.tools) return { do: 'stop', why: 'tools', say: null }

  /* what the model last asked for — which is not always the last step, because a model may ask
     for two tools at once and they are run one per step */
  const lastModel = [...steps].reverse().find((s) => s.kind === 'model')
  if (lastModel) {
    const calls = callsOf(lastModel)
    if (calls.length) {
      /* one tool per step, so a run that dies mid-way has made exactly the calls it recorded and
         no others — and a call is matched by the id the model gave it, never by its name, since a
         model may ask for the same tool twice with different arguments */
      const answered = new Set(steps.filter((s) => s.kind === 'tool')
        .map((s) => s.response && s.response.call).filter(Boolean))
      const todo = calls.find((c) => !answered.has(c.call))
      if (todo) return { do: 'tool', name: todo.name, args: todo.args, call: todo.call }
      /* every tool has answered: the model thinks again with what they said */
      return { do: 'model', messages: messagesFor({ run, bot, steps }) }
    }
    /* it asked for nothing, so whatever it wrote is the answer */
    const text = textOf(lastModel)
    if (text) return { do: 'say', text }
    return { do: 'stop', why: 'nothing-said', say: null }
  }

  return { do: 'model', messages: messagesFor({ run, bot, steps }) }
}

/*
 * WHAT A BOT KNOWS IT COULD LOOK UP.
 *
 * Only the NAME and the one-line description of each skill, never a body. That is the whole idea:
 * a bot with twenty skills carries twenty lines into every call rather than twenty pages, and
 * opens the one it needs with a tool. Put the bodies here and the bot gets worse at everything as
 * you teach it more, which is the opposite of what a skill is for.
 */
export function skillsLine(bot = {}, allowed = null) {
  /* a skill the asker may not have is not NAMED, never refused on opening. A model told "you may
     not" spends steps arguing, apologising, or describing what it would have done — which leaks
     the thing the gate exists to hide. A model never offered simply answers with what it has. */
  const list = (bot.skills || []).filter((s) => s && s.name && s.description)
    .filter((s) => !allowed || allowed.has(s.name))
  if (!list.length) return ''
  return ['You can open these for instructions when they are relevant. Open one before answering '
    + 'anything it covers, and do not guess at what it says:',
    ...list.map((s) => `- ${s.name}: ${s.description}`)].join('\n')
}

/* which skills this run has already opened, read off its own steps — so a resumed run on another
   machine knows exactly what the one before it had open */
export function openedSkills(steps = []) {
  const out = new Set()
  for (const s of steps) {
    if (s && s.kind === 'tool' && s.name === 'open_skill' && !s.error) {
      const name = (s.request && s.request.args && s.request.args.name) || (s.response && s.response.result && s.response.result.skill)
      if (name) out.add(String(name))
    }
  }
  return out
}

/* the tool calls a model step asked for, in the shape every OpenAI-compatible provider returns */
export function callsOf(step) {
  const out = []
  const msg = step && step.response && (step.response.message || (step.response.choices || [])[0]?.message)
  for (const c of (msg && msg.tool_calls) || []) {
    let args = {}
    try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}) } catch { args = {} }
    out.push({ call: c.id, name: c.function?.name, args })
  }
  return out
}

/* what a model step actually wrote, where it wrote anything */
export function textOf(step) {
  const msg = step && step.response && (step.response.message || (step.response.choices || [])[0]?.message)
  const c = msg && msg.content
  if (typeof c === 'string') return c.trim()
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p.text || '')).join('').trim()
  return ''
}

/* ------------------------------------------------------------------ the conversation */

/*
 * The messages a model call is made of, rebuilt from the run's own rows every time. Nothing is
 * kept in the worker between steps, which is what makes a run resumable on any machine: the
 * conversation IS the steps, so a worker that has never seen this run before builds the same one.
 */
/*
 * WHAT A BOT REMEMBERS, as its file says.
 *
 *   none     the question and nothing else. For a bot that must not be steered by the room.
 *   thread   the conversation it is in — what the surface hands it. The default.
 *   person   and what this SUBJECT has asked before, across conversations.
 *   person+recall  and what they have TOLD this bot, across every conversation, found by meaning
 *                  rather than by recency. The only setting that writes anything down, which is
 *                  why it is its own word rather than a flag on `person`: remembering somebody is
 *                  a thing a file asks for on purpose, and a person can ask for it to be deleted.
 *
 * `person` is the subject's own history and never the asker's: on a desk, a bot recalling what the
 * support agent asked about other customers would be the same leak as looking up their orders.
 * That is why it is off unless a file says so, and why the recall is resolved from the run.
 */
export const MEMORIES = ['none', 'thread', 'person', 'person+recall']
/* both settings are given the subject's own history; only the second is given what they told it */
export const recalls = (bot = {}) => memoryOf(bot) === 'person+recall'
export const memoryOf = (bot = {}) => (MEMORIES.includes(bot.memory) ? bot.memory : 'thread')

export function messagesFor({ run = {}, bot = {}, steps = [] } = {}) {
  const out = []
  const mem = memoryOf(bot)
  const here = mem === 'none' ? '' : (run.state && run.state.context)
  const before = (mem === 'person' || mem === 'person+recall') ? beforeNow(run.state && run.state.before) : ''
  /*
   * THE SYSTEM MESSAGE IS THE SITE'S OWN WORDS AND NOTHING ELSE.
   *
   * The transcript used to be concatenated here, above the bot's conduct — and it arrived from the
   * client, so anyone who could summon a bot could write its instructions. Three forged lines made
   * the desk bot promise free two-day shipping to Japan in one step, against a prompt that tells it
   * never to state a delivery time it has not read from the site.
   *
   * It is now read from the tables by the server AND carried as a user turn, because both halves
   * matter: the first stops it being forged, the second stops what people genuinely said in a room
   * from reading as an instruction. A transcript is a record of what was said. It is evidence, not
   * orders, and it goes where the rest of the evidence goes.
   */
  const system = [bot.prompt, skillsLine(bot, run.allowed)].filter(Boolean).join('\n\n').trim()
  if (system) out.push({ role: 'system', content: system })
  const said = [before, here].filter(Boolean).join('\n\n').trim()
  if (said) out.push({ role: 'user', content: said })
  for (const m of (run.state && run.state.messages) || []) {
    if (m && m.role && m.content) out.push({ role: m.role, content: String(m.content) })
  }
  for (const s of steps) {
    if (s.kind === 'model') {
      const msg = s.response && (s.response.message || (s.response.choices || [])[0]?.message)
      if (msg) out.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) })
    } else if (s.kind === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: (s.response && s.response.call) || s.name,
        content: typeof s.response?.result === 'string' ? s.response.result : JSON.stringify(s.response?.result ?? s.error ?? null),
      })
    }
  }
  return out
}

/* earlier questions from the same subject, as one passage. Nothing here decides WHOSE they are —
   the database did that (agent_recall) — this only words them. */
export function beforeNow(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && (r.asked || r.said))
  if (!list.length) return ''
  return list.map((r) => [r.asked && 'Q: ' + String(r.asked).trim(), r.said && 'A: ' + String(r.said).trim()]
    .filter(Boolean).join('\n')).join('\n\n')
}

/* ------------------------------------------------------------------ how a run ends */

/* what a person is told when a run stops without an answer. A run that was cancelled says so
   where it was asked; one that ran out says what it ran out of, because "something went wrong"
   is the least useful sentence in software. */
export function endingOf(why, words = {}) {
  /* NO ENGLISH LIVES HERE. What a bot says when it stops is a reader-facing string like any other
     and is authored in markdown (`## bots / ### endings` in the spaces scope); the compile resolves
     it per bot — the theme's words, the site's over them, the bot's own `endings:` last — and
     writes it onto the bot the worker carries. With no words at all it says nothing, which is the
     right failure: a bot that has lost its words should go quiet, not start speaking English at
     somebody's customers. */
  return words[why] || words.failed || ''
}

/* whether a run may be picked up: queued, or running with a lease nobody is holding any more.
   A LEASE RATHER THAN A STATUS is what makes a dead worker a non-event — there is no stuck row to
   find, because the row says when somebody stopped being responsible for it. */
export function claimable(run = {}, now = Date.now()) {
  if (!run || run.cancel_at) return false
  if (!['queued', 'running'].includes(run.status)) return false
  if (!run.lease_until) return true
  return new Date(run.lease_until).getTime() < now
}
