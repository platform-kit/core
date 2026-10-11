/*
 * THE ENRICHMENT'S MODEL LAYER, WHERE THERE IS NO MACHINE.
 *
 * The pipeline (build/enrich/pipeline.mjs) asks for six things and does not care where they come
 * from: MODEL, THINKING_LEVEL, complete, ready, missingKey, spentUsd. On a machine that is
 * build/llm.mjs, which reads argv and process.env and keeps its own running total. Here it is this,
 * over the agent worker's own provider seam.
 *
 * THERE WERE TWO LAYERS AND ONLY ONE COULD WIN, and it had to be this one. A run has a budget, a
 * receipt and a step per call, and a job whose model calls are not counted against `spent_cents` is
 * a job with no budget at all — the guard would read zero and let it spend until something else
 * stopped it. So every call goes through here, every call writes its `agent_steps` row, and
 * `spentUsd` answers what THIS RUN has spent rather than what this isolate happens to remember.
 *
 * The pipeline's own `maxSpend` guard then works on the same number the run's budget does, which is
 * the point: two guards reading two different totals is worse than one guard.
 *
 * ONE MESSAGE IN, ONE MESSAGE OUT. The stages are not a conversation — each is a system prompt and
 * a user prompt answered in one go, no tools, no history — so the shape `ask` wants is two messages
 * and an empty tool list, and what comes back is the assistant's text. Nothing about runs reaches
 * the provider, and nothing about providers reaches the stages.
 */
import { ask, priceOf } from '../agents/provider.js'
import { costOf } from '../agents/loop.js'

/* the top-level keys of a reply that is JSON, and nothing of what it says: the one fact that tells a
   schema failure apart from a transport one, kept small and free of anybody's words */
const topKeys = (text) => {
  const t = String(text || '').trim().replace(/^\u0060{3}(?:json)?/i, '').replace(/\u0060{3}$/, '').trim()
  const i = t.indexOf('{')
  if (i < 0) return null
  try { const o = JSON.parse(t.slice(i)); return o && typeof o === 'object' ? Object.keys(o).slice(0, 12) : null } catch { return 'unparseable' }
}

/* how the pipeline says "think a little" against what a provider wants; today only Anthropic's
   models take it, and the seam does not carry it, so it is recorded and not sent */
const THINK = { low: 'low', high: 'high', none: 'none' }

/*
 * `run`        the agent_runs row, for its id, its budget and its spend so far
 * `providers`  providersFrom(env), the same list the bots use
 * `model`      what the job asked for, or the first provider's own
 * `admin`      the service-role client, for the step rows and the run's total
 * `step`       what number the next step is (the job's own count), and a way to move it on
 */
export function runLlm({ run, providers, model, admin, think = 'low', onSpend = null, mock = null }) {
  const first = providers.list[0] || {}
  const MODEL = model || first.model || ''
  /* cents, kept here so the guard does not read the row back for every call; the row is still the
     record and is written on every call */
  let cents = Number(run.spent_cents) || 0
  let n = Number(run.step) || 0
  let calls = 0   /* this invocation's own count, for the scripted case */

  return {
    MODEL,
    THINKING_LEVEL: THINK[think] || 'none',
    /* a run with no provider at all is a run that cannot start; the mock counts as one, because the
       whole point of it is that everything below this line is exercised for nothing */
    ready: () => !!(providers.mock || providers.list.length),
    missingKey: () => (providers.list.length ? '' : 'a provider: none of the site\'s model keys is set'),
    /* dollars, because that is what the pipeline's guard is written in */
    spentUsd: () => cents / 100,

    async complete({ system, user, maxTokens, label, model: want, temperature, schema }) {
      const began = Date.now()
      const nth = calls++
      const asked = want || MODEL
      let messages = [{ role: 'system', content: String(system || '') }, { role: 'user', content: String(user || '') }]
      /*
       * A SCRIPTED RUN, so the whole branch — the claim, the stages, the cache, the step rows, the
       * resuming — can be exercised end to end for nothing, which is how the bots' loop is tested
       * and how this one has to be, given what a real run costs.
       *
       * The script is handed ONE STEP AT A TIME rather than whole, because the provider's mock
       * picks its step by counting assistant turns and a stage is a fresh two-message conversation
       * with none: every call would otherwise be answered with the first reply in the list.
       */
      if (mock) {
        const say = mock[nth] != null ? mock[nth] : ''
        messages = [{ ...messages[0], content: `${messages[0].content}\n<<mock:${JSON.stringify([{ say }])}>>` }, messages[1]]
      }
      try {
        const out = await ask({ providers, model: asked, messages, tools: [], schema, temperature, maxTokens })
        /* COSTED ON WHAT ANSWERED, not on what was asked: a fallback is a different model at a
           different price, and a bill that says otherwise is a bill nobody can check */
        const answered = out.model || asked
        const cost = costOf({ tokensIn: out.usage.in, tokensOut: out.usage.out }, priceOf(answered))
        cents += cost
        const row = {
          run_id: run.id, n: n++, kind: 'model', name: answered,
          request: { stage: label || '', messages: messages.length, ...(out.provider ? { provider: out.provider } : {}), ...(out.fellBackFrom ? { fell_back_from: out.fellBackFrom } : {}) },
          /*
           * WHAT SHAPE CAME BACK, not only how long it was. A step recorded the reply's length and
           * nothing else, so a run that died on a reply the schema refused left no way to tell what
           * the model had actually returned — which is the whole question. The keys are the answer
           * to it: a stage that asks for { chapters: [...] } and receives an object keyed by chapter
           * title is diagnosed by them at a glance. Not the reply's words: a step belongs to a bot
           * answering a person as often as to a job, and that is their conversation.
           */          response: { chars: String(out.message?.content || '').length, keys: topKeys(out.message?.content) },
          tokens_in: out.usage.in, tokens_out: out.usage.out, cost_cents: cost, ms: Date.now() - began,
        }
        await admin.from('agent_steps').insert(row)
        await admin.from('agent_runs').update({ step: n, spent_cents: cents, updated_at: new Date().toISOString() }).eq('id', run.id)
        if (onSpend) await onSpend({ cents, cost, step: n, label: label || '' })
        /* the stages read `.text`, which is llm.mjs's word for it */
        return { text: String(out.message?.content || ''), usage: { input_tokens: out.usage.in, output_tokens: out.usage.out }, model: answered }
      } catch (e) {
        /* a failed call is a step too: a run that says only "failed" leaves nobody able to see which
           stage it died in or what it had already paid for */
        await admin.from('agent_steps').insert({
          run_id: run.id, n: n++, kind: 'model', name: asked, error: String(e.message || e), ms: Date.now() - began,
          request: { stage: label || '', providers: providers.list.map((p) => p.id) },
        })
        throw e
      }
    },
  }
}
