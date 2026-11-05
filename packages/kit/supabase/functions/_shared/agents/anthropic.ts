/*
 * ANTHROPIC, IN THE SHAPE THE LOOP SPEAKS.
 *
 * The loop stores and replays OpenAI-shaped messages — an assistant message with `tool_calls`, a
 * `role: 'tool'` message carrying a result — because that is the shape nearly everything answers
 * in. Anthropic's Messages API is a different shape: the system prompt is a field rather than a
 * message, a tool call is a content block, and a tool's answer comes back as a *user* message.
 *
 * So this is a translation both ways, and it is pure — no fetch, no environment — because the
 * awkward part is the shape, not the network: a run that began on one provider and finished on
 * another has to replay its own history in the other's grammar, and that is a thing to test rather
 * than to find out about at three in the morning. Pinned by build/anthropic.test.mjs.
 */

export const VERSION = '2023-06-01'
export const MAX_TOKENS = 4096

/* ------------------------------------------------------------------ on the way out */

/*
 * Our messages → { system, messages }. Two things to get right:
 *
 *   · consecutive messages of one role are MERGED. A model that asked for two tools leaves two
 *     `role: 'tool'` messages behind, and Anthropic wants one user turn holding both results.
 *   · a tool's answer is a user turn, not a tool turn. There is no tool role.
 */
export function toAnthropic(messages = [], tools = []) {
  const system = messages.filter((m: any) => m && m.role === 'system').map((m: any) => String(m.content || '')).join('\n\n').trim()
  const out: any = []
  const push = (role: any, block: any) => {
    const last: any = out[out.length - 1]
    if (last && last.role === role) last.content.push(block)
    else out.push({ role, content: [block] })
  }
  for (const m of messages) {
    if (!m || (m as any).role === 'system') continue
    if ((m as any).role === 'tool') {
      push('user', {
        type: 'tool_result',
        tool_use_id: String((m as any).tool_call_id || ''),
        content: typeof (m as any).content === 'string' ? (m as any).content : JSON.stringify((m as any).content ?? null),
      })
      continue
    }
    if ((m as any).role === 'assistant') {
      const said = typeof (m as any).content === 'string' ? (m as any).content.trim() : ''
      if (said) push('assistant', { type: 'text', text: said })
      for (const c of (m as any).tool_calls || []) {
        let input = {}
        try { input = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}) } catch { input = {} }
        push('assistant', { type: 'tool_use', id: String(c.id || ''), name: String(c.function?.name || ''), input })
      }
      continue
    }
    const said = typeof (m as any).content === 'string' ? (m as any).content : JSON.stringify((m as any).content ?? '')
    if (said) push('user', { type: 'text', text: said })
  }
  /* it will not take an empty first turn, nor one that does not begin with the person */
  while (out.length && out[0].role !== 'user') out.shift()
  return {
    system,
    messages: out,
    tools: (tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {} },
    })),
  }
}

/* ------------------------------------------------------------------ on the way back */

/* its answer → the one message shape the loop stores, replays and reads a tool call out of */
export function fromAnthropic(body: any = {}) {
  const blocks = Array.isArray(body.content) ? body.content : []
  const text = blocks.filter((b: any) => b && b.type === 'text').map((b: any) => String(b.text || '')).join('').trim()
  const calls = blocks.filter((b: any) => b && b.type === 'tool_use').map((b: any) => ({
    id: String(b.id || ''),
    type: 'function',
    function: { name: String(b.name || ''), arguments: JSON.stringify(b.input ?? {}) },
  }))
  return {
    message: {
      role: 'assistant',
      content: text || null,
      ...(calls.length ? { tool_calls: calls } : {}),
    },
    usage: { in: Number(body.usage?.input_tokens) || 0, out: Number(body.usage?.output_tokens) || 0 },
    model: String(body.model || ''),
  }
}
