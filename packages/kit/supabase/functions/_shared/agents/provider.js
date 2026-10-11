/*
 * WHERE THE THINKING IS BOUGHT. One shape — OpenAI's chat completions, with tools — because it is
 * the shape everything speaks: OpenAI itself, Azure, Groq, Together, Fireworks, OpenRouter, vLLM,
 * llama.cpp, LM Studio and Ollama all answer it, and Anthropic sits behind a two-line adapter.
 * A site changes a base url and a key and keeps its bots.
 *
 * Nothing here knows what a bot is or how a run works. It takes messages and tools and gives back
 * one message and what it cost, or it throws. The loop decides everything else (lib/agents/loop.js).
 *
 * `maxTokens` is the one thing a CALLER may set, and it exists because of the enrichment. Anthropic
 * requires a ceiling and this seam sent 4096 — right for a bot's reply, and a silent truncation
 * mid-JSON for a stage that asks for sixty thousand. It would have failed its schema, been asked
 * again, failed again, and thrown, on a paid call, with nothing saying why. A bot passes nothing
 * and gets exactly what it got before.
 *
 * THE MOCK IS NOT A STUB. With no key, or with PLATFORMKIT_AGENT_MOCK=1, the provider answers from
 * a script the run itself carries — so the whole loop, the worker, the tool calls, the resuming and
 * the cancelling are exercised end to end, deterministically, for nothing. That is how this is
 * tested and how a site tries a bot out before it has an account anywhere.
 */

import { toAnthropic, fromAnthropic, VERSION, MAX_TOKENS } from './anthropic.js'

/* every model the kit knows a price for, per million tokens. A model that is not here still runs;
   it simply is not counted against a budget, and the run says so. */
export const PRICES = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1': { in: 2, out: 8 },
  'o4-mini': { in: 1.1, out: 4.4 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}
export const priceOf = (model) => PRICES[model] || PRICES[String(model || '').replace(/-\d{8}$/, '')] || {}

export const DEFAULT_MODEL = 'gpt-4o-mini'
export const DEFAULT_BASE = 'https://api.openai.com/v1'
export const ANTHROPIC_BASE = 'https://api.anthropic.com'
export const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

/*
 * WHICH FAILURES ARE WORTH TRYING SOMEBODY ELSE FOR.
 *
 * A failure about the PROVIDER — no credits, a bad key, a rate limit, their server down, the
 * network — is one the next provider may well answer. A failure about the REQUEST is not: a
 * malformed call fails identically everywhere, and trying again is two bills and twice the wait
 * for the same error. So 400 and 422 stop here; everything else moves on.
 *
 * 404 counts as the provider's, because a model one provider has is not a model another has.
 */
export const worthAnother = (status) => !(status === 400 || status === 422)

/*
 * WHERE THINKING MAY BE BOUGHT, in the order it is tried.
 *
 * More than one, because a provider with no credits is not a reason for a site to stop working:
 * the first is asked, and if it fails for a reason that is ITS OWN (see worthAnother) the next is
 * asked instead. What answered is written on the step, so a bill and a fallback are both a matter
 * of record rather than a surprise.
 *
 * Each carries its own model, and a fallback uses ITS OWN — a bot's `model:` names a model for
 * the provider it was written for, and sending `gpt-4o-mini` to Anthropic is not a fallback, it
 * is a second failure. `AGENT_PROVIDERS` sets the order by name where a site wants one.
 *
 * BUYING IS OPT-IN, AND A KEY IS NOT CONSENT. A key in the environment means somebody once needed
 * one for something; it does not mean this site has agreed to spend money on bots. So the kit
 * thinks for nothing until AGENTS_LIVE=1 is set — deliberately, once, by whoever pays the bill.
 * Until then every bot works, end to end, on the mock, and there is no path through this file that
 * reaches a vendor. The difference between "we meant not to spend anything" and "we could not
 * have" is one line, and this is the line.
 */
export function providersFrom(env = {}) {
  const asked = env.PLATFORMKIT_AGENT_MOCK === '1'
  const live = env.AGENTS_LIVE === '1'
  const all = []
  const openaiKey = env.AGENT_API_KEY || env.OPENAI_API_KEY || ''
  if (openaiKey) {
    all.push({
      id: 'openai', kind: 'openai',
      base: (env.AGENT_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
      key: openaiKey,
      model: env.AGENT_MODEL || DEFAULT_MODEL,
    })
  }
  if (env.ANTHROPIC_API_KEY) {
    all.push({
      id: 'anthropic', kind: 'anthropic',
      base: (env.ANTHROPIC_API_BASE || ANTHROPIC_BASE).replace(/\/+$/, ''),
      key: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL || ANTHROPIC_MODEL,
      maxTokens: Number(env.AGENT_MAX_TOKENS) || 0,
    })
  }
  /* the site's own order, where it has one; anything it does not name is left out */
  const wanted = String(env.AGENT_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const list = wanted.length ? wanted.map((id) => all.find((p) => p.id === id)).filter(Boolean) : all
  return {
    mock: asked || !live || !list.length,
    why: asked ? 'asked for' : !list.length ? 'no key' : !live ? 'not switched on (AGENTS_LIVE)' : '',
    list,
  }
}

/* one provider, for anything that wants the first without knowing about the rest */
export function providerFrom(env = {}) {
  const p = providersFrom(env)
  return { ...(p.list[0] || { base: DEFAULT_BASE, key: '', model: DEFAULT_MODEL, kind: 'openai' }), mock: p.mock, why: p.why }
}

/* ------------------------------------------------------------------ asking */

/*
 * One turn. Returns { message, usage: { in, out }, model } where message is the assistant's, in
 * the shape the loop stores and replays — including tool_calls, untouched, because the ids in them
 * are how a tool's answer is tied back to what asked for it.
 */
/* providers that have just refused in a way that will not have changed a second later. Per isolate,
   never persisted: a worker is short-lived, so this forgets on its own. */
const SORE = new Set()
/* 401 and 403 are keys; 402 and 429 are money and rate. A 5xx is the provider having a moment and
   is worth asking again, since the next step may be a minute later. */
const SORE_STATUS = (s) => s === 401 || s === 402 || s === 403 || s === 429

/*
 * A SHAPE THE REPLY MUST HAVE, rather than a sentence asking for one.
 *
 * A stage that needs JSON used to say "JSON only" in its prompt and parse what came back, with one
 * retry. That is a coin toss on every call, and it lost one: fifty-three paid calls into an
 * enrichment, the write stage returned an object with no `chapters` key twice and the run died.
 *
 * Both providers can guarantee the shape and both already speak the mechanism this layer has: a
 * TOOL with a JSON-Schema signature, and a `tool_choice` that says it must be called. One mechanism
 * for both — OpenAI's forced function call and Anthropic's forced tool are the same idea, and their
 * replies already come back through the same `tool_calls` shape (anthropic.js translates it). The
 * alternative, OpenAI's `response_format: json_schema`, has no Anthropic counterpart and would mean
 * two paths to keep in step.
 *
 * `schema` is { name, description, parameters } where parameters is JSON Schema. Given one, the
 * reply's text IS the arguments the model called with, so a caller that parses text needs no change.
 */
export async function ask({ provider, providers, model, messages, tools = [], schema = null, temperature, signal, maxTokens = 0 } = {}) {
  const where = providers || { mock: provider?.mock, why: provider?.why, list: provider ? [provider] : [] }
  /* A SCRIPTED RUN IS NEVER BOUGHT. If the conversation carries a script, this is a rehearsal —
     a test, a dry run, a site trying a bot out — and it is answered from the script whatever keys
     happen to be lying about in the environment. Putting the rule here rather than in a variable
     is the difference between "we meant not to spend anything" and "we could not have". */
  if (where.mock || hasScript(messages)) {
    return mockAsk({ messages, tools, schema, model: model || where.list[0]?.model, why: where.why })
  }

  /*
   * Each in turn, while the failure is one somebody else might not have. The FIRST provider gets
   * the model asked for; a fallback uses its own, because a model is a provider's own word.
   *
   * A provider that has just failed THIS WAY is stepped over for the rest of the isolate's short
   * life (see SORE). An account out of credit refuses every call in the same breath, and paying a
   * round trip to be told so again before every single step of a run is latency for nothing — a
   * bot that has fallen back to its second provider should stay there while it finishes answering.
   * The memory is per isolate and dies with it, so a key that is topped up is tried again within
   * moments and nothing has to be cleared by hand.
   */
  const order = where.list.filter((p) => !SORE.has(p.id))
  const list = order.length ? order : where.list   /* all sore: try them all again rather than give up */
  let last = null
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    /* the bot's own model belongs to the provider it was written for — which is the first one the
       SITE declares, not whichever one this call happens to start with once a sore one is skipped */
    const first = p.id === where.list[0].id
    try {
      const out = p.kind === 'anthropic'
        ? await askAnthropic({ p, model: first ? (model || p.model) : p.model, messages, tools, schema, signal, maxTokens })
        : await askOpenAI({ p, model: first ? (model || p.model) : p.model, messages, tools, schema, temperature, signal, maxTokens })
      SORE.delete(p.id)
      return { ...out, provider: p.id, ...(p.id !== where.list[0].id ? { fellBackFrom: where.list[0].id } : {}) }
    } catch (e) {
      last = e
      if (!worthAnother(e.status)) throw e
      /* out of credit, rate-limited, or simply down: worth another provider, not worth asking this
         one again on the next step of the same run */
      if (SORE_STATUS(e.status)) SORE.add(p.id)
    }
  }
  throw last || new Error('no provider answered')
}

async function askOpenAI({ p, model, messages, tools = [], schema = null, temperature, signal, maxTokens = 0 }) {
  const all = schema ? [...tools, schema] : tools
  const body = {
    model: model || p.model || DEFAULT_MODEL,
    messages,
    /* `max_completion_tokens`, not `max_tokens`: the newer models refuse the old name outright, and
       build/llm.mjs has always sent the new one. Sent only when a caller asks — a bot never does. */
    ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
    ...(all.length ? { tools: all.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } } })) } : {}),
    ...(schema ? { tool_choice: { type: 'function', function: { name: schema.name } } } : {}),
    ...(temperature != null ? { temperature } : {}),
  }
  const r = await fetch(p.base + '/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.key },
    body: JSON.stringify(body),
  }).catch((e) => { throw Object.assign(new Error('could not reach the model: ' + (e.message || e)), { status: 0 }) })
  if (!r.ok) {
    const said = await r.text().catch(() => '')
    throw Object.assign(new Error(`the model answered ${r.status}${said ? ': ' + said.slice(0, 300) : ''}`), { status: r.status })
  }
  const data = await r.json()
  const choice = (data.choices || [])[0] || {}
  return {
    ...asReply({ message: choice.message || { role: 'assistant', content: '' } }, schema),
    usage: { in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 },
    model: data.model || body.model,
  }
}

/* Anthropic speaks its own shape, and the translation both ways is ./anthropic.js — pure, so the
   awkward part (replaying a history that began on another provider) is tested rather than hoped for */
async function askAnthropic({ p, model, messages, tools = [], schema = null, signal, maxTokens = 0 }) {
  const shaped = toAnthropic(messages, schema ? [...tools, schema] : tools)
  const r = await fetch(p.base + '/v1/messages', {
    method: 'POST', signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': p.key,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || p.maxTokens || MAX_TOKENS,
      ...(shaped.system ? { system: shaped.system } : {}),
      messages: shaped.messages,
      ...(shaped.tools.length ? { tools: shaped.tools } : {}),
      ...(schema ? { tool_choice: { type: 'tool', name: schema.name } } : {}),
    }),
  }).catch((e) => { throw Object.assign(new Error('could not reach the model: ' + (e.message || e)), { status: 0 }) })
  if (!r.ok) {
    const said = await r.text().catch(() => '')
    throw Object.assign(new Error(`the model answered ${r.status}${said ? ': ' + said.slice(0, 300) : ''}`), { status: r.status })
  }
  const out = fromAnthropic(await r.json())
  return { ...asReply(out, schema), model: out.model || model }
}

/*
 * A FORCED CALL'S ARGUMENTS ARE THE REPLY. The model was made to call one tool, so what it "said"
 * is the JSON it called with; putting that in `content` means every caller that parses the text
 * keeps working and none of them has to know how the shape was guaranteed.
 */
function asReply(out, schema) {
  if (!schema || !out || !out.message) return out
  const call = (out.message.tool_calls || []).find((c) => c.function && c.function.name === schema.name)
  if (!call) return out
  return { ...out, message: { ...out.message, content: String(call.function.arguments || ''), tool_calls: undefined } }
}

/* ------------------------------------------------------------------ the mock */

/*
 * A scripted provider. The script rides on the run's own state (`state.mock`), so a test writes
 * exactly what the model "says" and the whole machine runs for real around it:
 *
 *   state.mock = [
 *     { tool: 'lookup_order', args: { ref: '1042' } },   // ask for a tool
 *     { say: 'It shipped on Tuesday.' },                 // then answer
 *   ]
 *
 * With no script it answers plainly, which is what a site sees when it tries a bot with no key: the
 * bot works, says it is not really thinking, and costs nothing.
 */
export function mockAsk({ messages = [], tools = [], schema = null, model = 'mock', why = '' } = {}) {
  const script = scriptFrom(messages)
  /*
   * A forced shape is answered in that shape, so a mocked run walks the same path a paid one does.
   * A script says its reply either way — `args` (what a tool was called with) or `say` (the words,
   * which for a forced stage ARE the JSON) — and both are the reply's content here. Reading only
   * `args` made every enrichment stage receive {} and the job walk its first stage twice.
   */
  if (schema) {
    const step = script[countTurns(messages)] || {}
    const content = step.args !== undefined ? JSON.stringify(step.args) : step.say !== undefined ? String(step.say) : '{}'
    return { message: { role: 'assistant', content }, usage: { in: JSON.stringify(messages).length / 4 | 0, out: 20 }, model }
  }
  const turn = countTurns(messages)
  const step = script[turn]
  const usage = { in: JSON.stringify(messages).length / 4 | 0, out: 20 }
  if (step && step.tool) {
    return {
      message: {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'mock-' + turn, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args || {}) } }],
      },
      usage, model,
    }
  }
  if (step && step.say != null) return { message: { role: 'assistant', content: String(step.say) }, usage, model }
  if (step && step.fail) throw new Error(String(step.fail))
  const asked = [...messages].reverse().find((m) => m.role === 'user')
  const heard = asked ? String(asked.content).slice(0, 120) : ''
  /* not reader-facing copy: a site never ships with this showing. It is the machine saying which
     of the several reasons it is not thinking, where the person who can fix it will read it. */
  const stood = why === 'not switched on (AGENTS_LIVE)'
    ? '(the model is not switched on for this site — set AGENTS_LIVE=1 — so this is a stand-in answer)'
    : '(no model is configured, so this is a stand-in answer)'
  return {
    message: { role: 'assistant', content: `${stood}${heard ? ` You asked: ${heard}` : ''}` },
    usage, model,
  }
}

export const hasScript = (messages = []) => scriptFrom(messages).length > 0

/* the script is carried in the system message, because that is the one thing the loop always
   rebuilds from the run — nothing in the provider has to know about runs to find it */
function scriptFrom(messages) {
  const system = messages.find((m) => m.role === 'system')
  const m = /<<mock:(\[[\s\S]*?\])>>/.exec(String((system && system.content) || ''))
  if (!m) return []
  try { return JSON.parse(m[1]) } catch { return [] }
}
/* which turn this is: one per assistant message already in the conversation */
const countTurns = (messages) => messages.filter((m) => m.role === 'assistant').length
