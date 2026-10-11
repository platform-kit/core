/* The translation between the shape the loop speaks and Anthropic's — both ways, and especially a
   history that BEGAN on another provider, which is what a fallback mid-conversation replays.
   Pure: no network, no environment. `npm test` runs it. */
import { toAnthropic, fromAnthropic } from '../supabase/functions/_shared/agents/anthropic.js'
import { providersFrom, worthAnother, ask, hasScript } from '../supabase/functions/_shared/agents/provider.js'
import { toolsFor, BUILTINS } from '../supabase/functions/_shared/agents/tools.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---- out: our messages become theirs ---- */
{
  const said = toAnthropic([
    { role: 'system', content: 'You help.' },
    { role: 'user', content: 'what is on?' },
  ], [{ name: 'get_events', description: 'what is on', parameters: { type: 'object', properties: {} } }])
  ok('the system prompt is a field, not a turn', said.system === 'You help.' && said.messages.length === 1)
  ok('a tool keeps its name and its schema under another word',
    said.tools[0].name === 'get_events' && !!said.tools[0].input_schema)

  /* THE HARD CASE: a model asked for two tools at once, and both answers come back. Anthropic
     wants ONE user turn holding both results — two consecutive user turns are refused. */
  const mid = toAnthropic([
    { role: 'system', content: 'S' },
    { role: 'user', content: 'go' },
    { role: 'assistant', content: null, tool_calls: [
      { id: 'a', type: 'function', function: { name: 'one', arguments: '{"x":1}' } },
      { id: 'b', type: 'function', function: { name: 'two', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'a', content: '[]' },
    { role: 'tool', tool_call_id: 'b', content: '{}' },
  ])
  ok('the turns alternate', eq(mid.messages.map((m) => m.role), ['user', 'assistant', 'user']))
  ok('two calls are two blocks of one assistant turn', mid.messages[1].content.length === 2)
  ok('…and their answers two blocks of one user turn',
    mid.messages[2].content.length === 2 && mid.messages[2].content.every((c) => c.type === 'tool_result'))
  ok('a result is tied to the call that asked for it', mid.messages[2].content[0].tool_use_id === 'a')
  ok('arguments arrive parsed, not as a string', eq(mid.messages[1].content[0].input, { x: 1 }))
  ok('unparseable arguments are an empty object, never a crash',
    eq(toAnthropic([{ role: 'user', content: 'x' }, { role: 'assistant', tool_calls: [{ id: 'z', function: { name: 'n', arguments: '{oh' } }] }])
      .messages[1].content[0].input, {}))

  /* it will not take a conversation that does not begin with the person */
  ok('a history starting with the assistant is trimmed to one that starts with the person',
    toAnthropic([{ role: 'assistant', content: 'hello' }, { role: 'user', content: 'hi' }]).messages[0].role === 'user')
  ok('nothing at all is no turns', toAnthropic([]).messages.length === 0)
}

/* ---- back: their answer becomes the one shape the loop stores ---- */
{
  const plain = fromAnthropic({ content: [{ type: 'text', text: 'Yes — Tuesdays.' }], usage: { input_tokens: 10, output_tokens: 4 }, model: 'claude-x' })
  ok('what it wrote is the content', plain.message.content === 'Yes — Tuesdays.' && !plain.message.tool_calls)
  ok('and what it cost is counted', plain.usage.in === 10 && plain.usage.out === 4)

  const asked = fromAnthropic({ content: [{ type: 'text', text: 'One moment' }, { type: 'tool_use', id: 'z', name: 'get_events', input: { days: 30 } }] })
  ok('a tool_use block becomes a tool_call the loop already knows how to replay',
    asked.message.tool_calls[0].id === 'z' && asked.message.tool_calls[0].function.name === 'get_events')
  ok('…with its arguments as the string every other provider sends',
    asked.message.tool_calls[0].function.arguments === '{"days":30}')
  ok('an answer with only a tool call has no words', fromAnthropic({ content: [{ type: 'tool_use', id: 'q', name: 'n', input: {} }] }).message.content === null)
  ok('nothing is not a crash', fromAnthropic({}).message.role === 'assistant')
}

/* ---- which provider, in which order, and when the next one is worth asking ---- */
{
  const both = { AGENTS_LIVE: '1', OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-b' }
  ok('the default order is the default provider, then the other',
    eq(providersFrom(both).list.map((p) => p.id), ['openai', 'anthropic']))
  ok('each carries its OWN model, because a model is a provider\'s own word',
    providersFrom(both).list[0].model !== providersFrom(both).list[1].model)
  ok('a site may say the order', eq(providersFrom({ ...both, AGENT_PROVIDERS: 'anthropic,openai' }).list.map((p) => p.id), ['anthropic', 'openai']))
  ok('…and leave one out', eq(providersFrom({ ...both, AGENT_PROVIDERS: 'anthropic' }).list.map((p) => p.id), ['anthropic']))
  ok('one key is one provider', providersFrom({ AGENTS_LIVE: '1', ANTHROPIC_API_KEY: 'sk-b' }).list.length === 1)

  /* THE RULE THAT MATTERS MOST still holds over the whole list */
  ok('keys without AGENTS_LIVE buy nothing at all', providersFrom({ ...both, AGENTS_LIVE: '' }).mock === true)
  ok('…and it says why', /AGENTS_LIVE/.test(providersFrom({ ...both, AGENTS_LIVE: '' }).why))
  ok('asking for the mock beats every key', providersFrom({ ...both, PLATFORMKIT_AGENT_MOCK: '1' }).mock === true)
  ok('no keys is the mock too', providersFrom({ AGENTS_LIVE: '1' }).mock === true)

  /* a failure about the PROVIDER is worth trying somebody else for; one about the REQUEST is not */
  ok('no credits is worth another', worthAnother(429))
  ok('a bad key is worth another', worthAnother(401) && worthAnother(403))
  ok('their server falling over is worth another', worthAnother(500) && worthAnother(503))
  ok('a model they do not have is worth another', worthAnother(404))
  ok('not reaching them at all is worth another', worthAnother(0))
  ok('a malformed request is NOT — it fails the same way everywhere', !worthAnother(400) && !worthAnother(422))
}

/* ---- and the fallback itself, with the network stubbed ---- */
{
  const real = globalThis.fetch
  const answer = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
  const seen = []
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    if (String(url).includes('openai')) return answer(429, { error: { message: 'You have no credits remaining.' } })
    return answer(200, { content: [{ type: 'text', text: 'Anthropic answered.' }], usage: { input_tokens: 3, output_tokens: 2 }, model: 'claude-x' })
  }
  try {
    const out = await ask({
      providers: providersFrom({ AGENTS_LIVE: '1', OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-b' }),
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    })
    ok('the first is asked first', /openai/.test(seen[0]))
    ok('…and when it has no credits the next is asked', seen.length === 2 && /anthropic/.test(seen[1]))
    ok('the answer comes back in the one shape the loop stores', out.message.content === 'Anthropic answered.')
    ok('it says who answered', out.provider === 'anthropic')
    ok('…and that it was a fallback, because a second vendor quietly billing is a thing to notice',
      out.fellBackFrom === 'openai')
    ok('the fallback used ITS OWN model, not the one asked for', out.model === 'claude-x')

    /* a malformed request stops at the first: trying again is two bills for one error */
    seen.length = 0
    globalThis.fetch = async (url) => { seen.push(String(url)); return answer(400, { error: { message: 'bad request' } }) }
    let threw = null
    try {
      await ask({ providers: providersFrom({ AGENTS_LIVE: '1', OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-b' }), messages: [{ role: 'user', content: 'x' }] })
    } catch (e) { threw = e }
    ok('a malformed request is not tried twice', seen.length === 1 && !!threw)

    /* and the rule that outranks all of it */
    seen.length = 0
    const script = [{ role: 'system', content: 'x <<mock:[{"say":"from the script"}]>>' }, { role: 'user', content: 'hi' }]
    const rehearsal = await ask({ providers: providersFrom({ AGENTS_LIVE: '1', OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-b' }), messages: script })
    ok('a scripted run reaches no vendor at all', seen.length === 0 && hasScript(script) && rehearsal.message.content === 'from the script')
  } finally { globalThis.fetch = real }
}

/* ---- a skill's tools arrive WITH the skill ---- */
{
  const bot = {
    tools: ['search_site'],
    skills: [{ name: 'refunds', description: 'd', body: 'b', tools: ['issue_refund'] }],
  }
  const declared = { issue_refund: { kind: 'code', module: './x.js', description: 'refund one' } }
  const shut = toolsFor({ bot, declared, surface: 'support', opened: new Set() }).map((t) => t.name)
  const open = toolsFor({ bot, declared, surface: 'support', opened: new Set(['refunds']) }).map((t) => t.name)
  ok('a bot with skills is offered the way to open one', shut.includes('open_skill'))
  /* THE POINT: a bot that never opens the refunds skill is never offered the refund tool */
  ok('a skill\'s tool is not offered before the skill is opened', !shut.includes('issue_refund'))
  ok('…and is once it has been', open.includes('issue_refund'))
  ok('its own tools are there throughout', shut.includes('search_site') && open.includes('search_site'))
  ok('a bot with no skills is not offered open_skill', !toolsFor({ bot: { tools: ['search_site'] }, declared: {}, surface: 'spaces' }).map((t) => t.name).includes('open_skill'))

  /* opening one hands over the body, and only for a skill this bot has */
  const got = await BUILTINS.open_skill.run({ bot, args: { name: 'refunds' } })
  ok('opening it returns the instructions', got.instructions === 'b' && got.skill === 'refunds')
  const nope = await BUILTINS.open_skill.run({ bot, args: { name: 'somebody-elses' } })
  ok('a skill it does not have is refused, and it is told which it has', /no skill called/.test(nope.error) && /refunds/.test(nope.error))
}

console.log('\nanthropic: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
