/*
 * One way for the generators to call a model, with a preference order and
 * fallbacks. Gemini 3.5 Flash on Replicate is first: a one-million-token window
 * and a 65k-token reply for a fraction of a cent, so a whole book goes in one
 * call. OpenAI is second, Anthropic third; each is used only when its key is
 * present, and a provider that fails outright (a bad key, no credit, an
 * unknown model, a dead connection after retries) hands the call to the next.
 * Thinking is off unless asked for. On Anthropic the system prompt is cached.
 *
 *   --model <id>     google/gemini-3.5-flash (default) · gpt-5-mini · claude-sonnet-5 · …
 *                    the provider follows the name; the others stay as fallbacks
 *   --thinking [high] turn reasoning on where the provider supports it (low, or high)
 *   REPLICATE_API_TOKEN / OPENAI_API_KEY / ANTHROPIC_API_KEY from the environment or .env
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

try {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env */ }

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
/* --thinking turns reasoning on at its low level; --thinking high asks for the full level where a provider has one */
const thinkArg = (() => { const i = argv.indexOf('--thinking'); if (i < 0) return process.env.COMPANION_THINKING || ''; const v = argv[i + 1]; return v === 'high' || v === 'low' ? v : 'low' })()
export const THINKING = !!thinkArg && thinkArg !== 'off'
export const THINKING_LEVEL = THINKING ? thinkArg : 'none'

const DEFAULTS = { replicate: 'google/gemini-3.5-flash', openai: 'gpt-5-mini', anthropic: 'claude-sonnet-5' }
const KEYS = { replicate: 'REPLICATE_API_TOKEN', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }
const providerOf = (model) => (/^claude/i.test(model) ? 'anthropic' : /^(gpt|o\d|text-)/i.test(model) ? 'openai' : 'replicate')
const asked = opt('--model', process.env.COMPANION_MODEL || '')
/* the chain: the asked-for model's provider first, then the rest in preference order, keys permitting */
const ORDER = ['replicate', 'openai', 'anthropic']
const first = asked ? providerOf(asked) : ORDER.find((p) => process.env[KEYS[p]]) || 'replicate'
export const CHAIN = [first, ...ORDER.filter((p) => p !== first)].filter((p) => process.env[KEYS[p]]).map((p) => ({ provider: p, model: p === first && asked ? asked : DEFAULTS[p] }))
export const MODEL = CHAIN.length ? CHAIN[0].model : (asked || DEFAULTS[first])
export const PROVIDER = CHAIN.length ? CHAIN[0].provider : first
export const ready = () => CHAIN.length > 0
export const missingKey = () => KEYS[first]

/* rough list prices per million tokens for the running estimate — check the real sheets */
const PRICES = {
  'google/gemini-3.5-flash': [0.3, 2.5], 'google/gemini-3-pro': [2, 12], 'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2], 'gpt-5-nano': [0.05, 0.4],
  'claude-opus-5': [15, 75], 'claude-sonnet-5': [3, 15], 'claude-haiku-4-5-20251001': [1, 5],
}
export const spent = {}   /* model → { calls, input, output, cached } */
/* the running estimate in dollars, at the list prices above; a model with no price on file counts as zero, so the guard is only as good as the table */
export function spentUsd() {
  return Object.entries(spent).reduce((sum, [m, s]) => { const p = PRICES[m] || PRICES[Object.keys(PRICES).find((k) => m.startsWith(k))]; return sum + (p ? ((s.input - s.cached) * p[0] + s.cached * p[0] / 10 + s.output * p[1]) / 1e6 : 0) }, 0)
}
export function costLine() {
  return Object.entries(spent).map(([m, s]) => {
    const p = PRICES[m] || PRICES[Object.keys(PRICES).find((k) => m.startsWith(k))]
    const usd = p ? ((s.input - s.cached) * p[0] + s.cached * p[0] / 10 + s.output * p[1]) / 1e6 : null
    return `${m}: ${s.calls} calls · ${s.input} in (${s.cached} cached) · ${s.output} out · ${usd == null ? 'no price on file' : '≈ $' + usd.toFixed(3) + ' at list price'}`
  }).join('\n') || 'no calls'
}
const tally = (model, u) => { const s = spent[model] || (spent[model] = { calls: 0, input: 0, output: 0, cached: 0 }); s.calls++; s.input += u.input_tokens; s.output += u.output_tokens; s.cached += u.cached }
const approxTokens = (t) => Math.round(String(t || '').length / 4)

/* ---- providers ---- */
async function replicateCall({ model, system, user, maxTokens, temperature, think }) {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.REPLICATE_API_TOKEN, prefer: 'wait=60' }
  const input = { prompt: user, system_instruction: system, max_output_tokens: Math.min(maxTokens, 65535), temperature: temperature ?? 0.7 }
  if (/gemini-3/.test(model)) input.thinking_level = think || THINKING_LEVEL
  let r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, { method: 'POST', headers, body: JSON.stringify({ input }) })
  let j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.detail || j.error || ('Replicate ' + r.status))
  /* a long reply outlives the wait: poll until it settles */
  while (j.status === 'starting' || j.status === 'processing') {
    await new Promise((res) => setTimeout(res, 3000))
    r = await fetch(j.urls.get, { headers: { authorization: headers.authorization } }); j = await r.json()
  }
  if (j.status !== 'succeeded') throw new Error('Replicate ' + j.status + ': ' + (j.error || 'no output'))
  const text = Array.isArray(j.output) ? j.output.join('') : String(j.output || '')
  const m = j.metrics || {}
  return { text, usage: { input_tokens: m.input_token_count || approxTokens(system + user), output_tokens: m.output_token_count || approxTokens(text), cached: 0 } }
}

async function openaiCall({ model, system, user, maxTokens, temperature }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model, max_completion_tokens: maxTokens, ...(temperature != null ? { temperature } : {}), response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j.error && j.error.message) || ('OpenAI ' + r.status))
  const u = j.usage || {}
  return { text: ((j.choices || [])[0] || {}).message?.content || '', usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0, cached: (u.prompt_tokens_details || {}).cached_tokens || 0 } }
}

let anthropic = null
async function anthropicCall({ model, system, user, maxTokens, temperature, think }) {
  if (!anthropic) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); anthropic = new Anthropic() }
  const req = { model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] }
  if (think ? think !== 'none' : THINKING) req.thinking = { type: 'adaptive' }
  else if (temperature != null) req.temperature = temperature
  const msg = await anthropic.messages.stream(req).finalMessage()
  const u = msg.usage || {}
  return { text: msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
    usage: { input_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output_tokens: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 } }
}
const CALL = { replicate: replicateCall, openai: openaiCall, anthropic: anthropicCall }
const FATAL = /invalid|authentication|permission|not_found|unknown model|does not exist|credits|billing|quota|insufficient|payment|40[0-4]|422/i

/* one call: the first provider in the chain, retried on dropped connections; a provider that fails outright hands over to the next */
export async function complete({ system, user, maxTokens, label, model: want, temperature, think }) {
  let lastErr = null
  /* a stage may ask for a particular model: its provider goes first, the rest stay as fallbacks */
  const chain = want ? [{ provider: providerOf(want), model: want }, ...CHAIN.filter((c) => c.provider !== providerOf(want))].filter((c) => process.env[KEYS[c.provider]]) : CHAIN
  for (const { provider, model } of chain) {
    for (let net = 0; net < 4; net++) {
      try {
        const out = await CALL[provider]({ model, system, user, maxTokens, temperature, think })
        tally(model, out.usage)
        return { ...out, model }
      } catch (e) {
        lastErr = e
        const m = (e && e.message) || String(e)
        if (FATAL.test(m) || net === 3) { console.log(`  ${label}: ${model} failed (${m.slice(0, 80)})${chain.indexOf(chain.find((c) => c.provider === provider)) < chain.length - 1 ? ' — falling back' : ''}`); break }
        console.log(`  ${label}: connection dropped (${m.slice(0, 60)}) — retrying in ${(net + 1) * 5}s`)
        await new Promise((r) => setTimeout(r, (net + 1) * 5000))
      }
    }
  }
  throw lastErr || new Error('no provider available')
}
