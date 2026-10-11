/*
 * WHAT A BOT CAN DO. A tool is a named thing with a described shape that a bot may ask for, and
 * there are exactly three kinds, because those are the three ways a site actually has an ability:
 *
 *   BUILTIN  — the kit's own, over what this site already knows: its docs and books, an order, a
 *              person's standing, what is on, a ticket. These are why a customer-service bot works
 *              out of the box rather than being an empty prompt.
 *   OPENAPI  — a spec, local or at a url, with an allow-list of operations. Anything with an API
 *              becomes a tool without a line of code.
 *   CODE     — a module the SITE ships (db/tools/*.js), exporting describe() and run(). The escape
 *              hatch, for the ability nobody could have anticipated.
 *
 * TWO RULES HOLD THE WHOLE THING UP.
 *
 * First, a tool ANSWERS FOR SOMEBODY. A tool that touches a person's own things is marked
 * `personal`, is told who it is answering for, and filters by them — and refuses outright when
 * nobody asked (a run a schedule woke). A bot is not a way around a policy: it can reach exactly
 * what the person who summoned it could reach, and the filtering is written out here rather than
 * left to a client pretending to be them, because there is no honest way to make that client.
 * Where a tool genuinely needs the desk's own reach it says so in `needs`, and it is only offered
 * on a surface where that is true.
 *
 * Second, a tool DESCRIBES ITSELF ONCE. The description the model reads and the check the runner
 * makes come from the same record, so a tool cannot drift into promising something it will refuse.
 */

/* ------------------------------------------------------------------ the kit's own */

/* Each builtin: what it is called, what it is for (the model reads this), the arguments it takes,
   what it needs of the asker, and how it is run. `db` is the ASKER's client — RLS and all — and
   `ctx` is where the run is happening. */
/* The library a bot may always search, as the ROW's kind rather than the collection's name: the
   rows are singular (a book, an article) while the collections are plural, and a site's own model
   is its own key. Crossing those two spellings makes every search return nothing, silently, which
   is how this was first written. */
export const SEARCHES = ['book', 'article', 'wiki', 'doc']

/* THE WORDS OF A QUESTION rather than of a thing, dropped before a phrase is searched by its
   words — without that, "what does it cost" matches whatever happens to have "what" in its
   title, and somebody asking about prices is shown paperbacks.

   They are words, so they are not written here: the theme says them (`## bots / ### words /
   asking` in the spaces scope), the site may say its own over the top, and a site in another
   language says that language’s. A list the kit compiled in would be English for everybody. */
export const askingWords = (words) => new Set(String((words && words.asking) || '')
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
export const BUILTINS = {
  /*
   * OPENING A SKILL. The bot has seen its name and one line; this hands over the rest. It is a
   * tool rather than a slice of the prompt because that is what makes a skill scale: the cost of
   * knowing a thing is one line until the moment it is needed.
   */
  open_skill: {
    description: 'Open one of the skills listed above and read its instructions. Do this before answering anything a skill covers.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'the skill to open, by name' } },
      required: ['name'],
    },
    async run({ bot, args }) {
      const want = String(args.name || '').trim()
      const found = (bot?.skills || []).find((s) => s.name === want)
      if (!found) {
        const had = (bot?.skills || []).map((s) => s.name)
        return { error: had.length ? `no skill called "${want}" — there is ${had.join(', ')}` : 'this bot has no skills' }
      }
      return { skill: found.name, instructions: found.body }
    },
  },
  search_site: {
    description: 'Search everything this site has published — articles, books, documentation and wiki pages. Use this before answering anything about what the site says.',
    parameters: {
      type: 'object',
      properties: { q: { type: 'string', description: 'what to look for' }, limit: { type: 'number', description: 'how many, at most 10' } },
      required: ['q'],
    },
    /*
     * WHAT THIS BOT MAY SEARCH, FOR THIS PERSON.
     *
     * Two narrowings, and neither is the bot's to decide. The KINDS are its own file's `searches:`
     * — the library by default, a site's own models by name — and the CLASS is the rung the person
     * being answered stands on, so a members-only article is never quoted at a guest. The record's
     * own `canAccess` is the bar; there is no second gate invented for bots to disagree with the
     * reader's own page.
     */
    async run({ admin, args, bot, run }) {
      const kinds = [...SEARCHES, ...((bot && bot.searches) || []).map((s) => s.model)]
      const { data: cls } = await admin.rpc('agent_class', { p_run: run })
      const { data, error } = await admin.rpc('search_content', {
        p_q: String(args.q || ''), p_limit: Math.min(Number(args.limit) || 5, 10),
        p_kinds: kinds, p_class: cls || 'guest',
      })
      if (error) return { error: error.message }
      return data || []
    },
  },

  /*
   * THE PERSONAL TOOLS NAME THE RUN, NOT A PERSON.
   *
   * There is no identity in scope here to get wrong. The database resolves whose data a run is about
   * (agent_subject: the asker in a room, the other party on a one-to-one surface) and answers with
   * that person's rows or with nothing. So a tool cannot look up the support agent who pressed the
   * button instead of the customer they are answering — which is what all three of these did.
   *
   * null from the function means there is nobody to ask about (a guest with no account); an empty
   * result means this person has none. The two are different answers to the person waiting.
   */
  /*
   * EVERYTHING ABOUT THE PERSON BEING ANSWERED, in one call.
   *
   * This was three tools — my_orders, my_membership, my_tickets — over one subject. Three round
   * trips for "tell me about this person", three descriptions for a model to choose between, and
   * three places for the same mistake: all three filtered on the asker rather than the subject, and
   * all three were wrong in exactly the same way.
   *
   * It still names the RUN and nothing else. The database resolves whose data that is and answers
   * through the same functions the reader's own client calls, so there is no identity here to get
   * wrong and no second opinion about what somebody may see.
   */
  about_me: {
    description: "Everything this site knows about the person you are talking to: what they have bought and where any parcel has got to, what their membership entitles them to right now, and the support tickets they have open. Use this before answering anything about their account, their orders or what they are entitled to.",
    parameters: { type: 'object', properties: {} },
    personal: true,
    async run({ admin, run, words }) {
      const [orders, membership, tickets] = await Promise.all([
        admin.rpc('agent_orders', { p_run: run }),
        admin.rpc('agent_membership', { p_run: run }),
        admin.rpc('agent_tickets', { p_run: run }),
      ])
      const err = orders.error || membership.error || tickets.error
      if (err) return { error: err.message }
      /* null from the functions means there is nobody to ask about — a guest with no account —
         which is a different answer from "they have none", and the difference matters to whoever
         is waiting */
      if (orders.data === null && membership.data === null) return { error: words.nobody }
      return {
        ...(orders.data || { purchases: [], parcels: [] }),
        membership: membership.data || null,
        tickets: tickets.data || [],
      }
    },
  },

  get_events: {
    description: 'Events coming up on this site — calls, sittings, anything with a date — with when each one starts and where it is. Use this for any question about what is happening or when something next runs.',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'how far ahead to look, in days' } } },
    async run({ admin, args }) {
      /* what is on is not private — an event says who it is for, and the audience is checked when
         somebody tries to come, not when they are told it exists */
      const days = Math.min(Number(args.days) || 30, 180)
      const { data, error } = await admin.from('calendar_occurrences')
        .select('starts_at, ends_at, cancelled_at, calendar_events!inner(title, sub, slug, place, published)')
        .gte('starts_at', new Date().toISOString())
        .lt('starts_at', new Date(Date.now() + days * 86400000).toISOString())
        .order('starts_at').limit(20)
      if (error) return { error: error.message }
      return (data || []).filter((o) => o.calendar_events?.published)
    },
  },

  raise_ticket: {
    description: 'Raise a support ticket when something needs a person to follow it up — a lost parcel, a refund, a fault. Say what happened in the body. Only do this once you have enough to write a title somebody could act on.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'a line somebody could find this by later' },
        body: { type: 'string', description: 'what happened, in full' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      },
      required: ['title'],
    },
    /* a ticket is raised for the run's SUBJECT by a function that resolves them itself. It used to
       pass ctx.contact, which read run.state.contact, which nothing anywhere ever set — so every
       ticket a bot raised belonged to no contact at all, and my_tickets, which finds tickets BY
       contact, could never find one. */
    needs: 'desk',
    async run({ admin, args, run }) {
      const { data, error } = await admin.rpc('agent_raise_ticket', {
        p_run: run,
        p_title: String(args.title || '').slice(0, 200),
        p_body: String(args.body || ''),
        p_priority: ['low', 'normal', 'high', 'urgent'].includes(args.priority) ? args.priority : 'normal',
      })
      if (error) return { error: error.message }
      return data || {}
    },
  },

  catalog: {
    description: "Everything this site sells and what it costs — books in each format, memberships and their tiers, sessions, downloads. Give a word or two of what is being asked about ('membership', 'the Kybalion', 'a session'), or nothing at all for the whole list. Use this for any question about price, what is on sale, or what a tier includes.",
    parameters: { type: 'object', properties: { what: { type: 'string', description: 'a word or two for what is being asked about; omit for everything' } } },
    /*
     * The catalog is the whole compiled file — offers, tiers, sessions — and its offers are keyed
     * BY SKU rather than listed. This read `(catalog || []).filter(…)`, which throws on an object,
     * so every call to it failed and the bot fell back to reading a price off a page. It also read
     * `price`, where an offer carries `unit_amount` in cents.
     *
     * And it matched on sku and title alone, so "membership" — the word anybody would actually use
     * — matched nothing, because the offers are called Chat-Only Support and Group Coaching. The
     * kind and the tier are part of what a thing IS, so they are part of what it is found by.
     */
    async run({ catalog, args, words }) {
      const want = String(args.what || '').toLowerCase().trim()
      const all = Object.values((catalog && catalog.offers) || {})
      const says = (o) => `${o.sku} ${o.title || ''} ${o.kind || ''} ${o.tier || ''}`.toLowerCase()
      const out = (o) => ({
        sku: o.sku, title: o.title, kind: o.kind,
        price: (Number(o.unit_amount) || 0) / 100, currency: (o.currency || 'usd').toUpperCase(),
        ...(o.period ? { per: o.period } : {}), ...(o.tier ? { tier: o.tier } : {}),
      })
      if (!want) return all.map(out)
      let hits = all.filter((o) => says(o).includes(want))
      /* Nothing matched the phrase: try its words, so "what do memberships cost" still finds the
         memberships rather than answering that the site sells nothing.
         The words of the QUESTION are dropped first — without that, "what" matches a book called
         "The Silence: What It Is and How To Use It" and somebody asking about prices is shown
         paperbacks. And a plural is tried singular, because people write "memberships". */
      if (!hits.length) {
        const asking = askingWords(words)
        const said = [...new Set(want.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !asking.has(w)))]
        const forms = said.flatMap((w) => (w.endsWith('s') ? [w, w.slice(0, -1)] : [w]))
        hits = all.filter((o) => forms.some((w) => says(o).includes(w)))
      }
      return hits.slice(0, 12).map(out)
    },
  },
}

/* ------------------------------------------------------------------ a spec, turned into tools */

/* An OpenAPI document becomes one tool per allowed operation. The description the model reads is
   the operation's own summary, which is what a spec is for; the parameters are its parameters. */
export function fromOpenApi(spec, { only = [], name = 'api', base = '', headers = {} } = {}) {
  const out = []
  const paths = (spec && spec.paths) || {}
  const server = base || ((spec.servers || [])[0] || {}).url || ''
  const resolve = (value) => {
    let current = value
    while (current && current.$ref) {
      if (!current.$ref.startsWith('#/')) throw new Error(`unsupported OpenAPI reference: ${current.$ref}`)
      const target = current.$ref.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        .reduce((node, part) => node?.[part], spec)
      if (!target) throw new Error(`unresolved OpenAPI reference: ${current.$ref}`)
      current = target
    }
    return current
  }
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item || {})) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const id = op.operationId || `${method}_${path.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}`
      if (only.length && !only.includes(id)) continue
      const props = {}
      const required = []
      const parameters = new Map()
      for (const raw of [...(item.parameters || []), ...(op.parameters || [])]) {
        const p = resolve(raw)
        parameters.set(`${p.in}:${p.name}`, p)
      }
      for (const raw of parameters.values()) {
        const p = resolve(raw)
        const schema = resolve(p.schema || {})
        props[p.name] = { type: schema.type || 'string', description: p.description || '' }
        if (p.required) required.push(p.name)
      }
      const body = op.requestBody && op.requestBody.content && op.requestBody.content['application/json']
      if (body && body.schema && body.schema.properties) {
        for (const [k, v] of Object.entries(body.schema.properties)) props[k] = { type: v.type || 'string', description: v.description || '' }
        for (const k of body.schema.required || []) required.push(k)
      }
      out.push({
        name: `${name}_${id}`.replace(/[^\w]/g, '_').slice(0, 60),
        description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
        parameters: { type: 'object', properties: props, ...(required.length ? { required } : {}) },
        http: { method, path, server, headers },
      })
    }
  }
  return out
}

/* calling one of those: the arguments go where the spec says they go */
export async function callHttp(tool, args = {}, { headers = {}, signal, fetchImpl = fetch } = {}) {
  const { method, path, server } = tool.http
  let url = server.replace(/\/+$/, '') + path
  const body = {}
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(args)) {
    if (url.includes(`{${k}}`)) { url = url.replace(`{${k}}`, encodeURIComponent(String(v))); continue }
    if (method === 'get' || method === 'delete') query.set(k, String(v))
    else body[k] = v
  }
  const qs = query.toString()
  const r = await fetchImpl(url + (qs ? (url.includes('?') ? '&' : '?') + qs : ''), {
    method: method.toUpperCase(), signal,
    headers: { ...tool.http.headers, 'content-type': 'application/json', ...headers },
    ...(method === 'get' || method === 'delete' ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  let data = text
  try { data = JSON.parse(text) } catch { /* not json, and that is allowed */ }
  if (!r.ok) return { error: `the API answered ${r.status}`, body: typeof data === 'string' ? data.slice(0, 500) : data }
  return data
}

/* ------------------------------------------------------------------ putting the set together */

/*
 * The tools one run may use: the ones its bot names, minus any the asker could not have used
 * themselves. A bot that names a tool the site does not have is not an error — the tool is simply
 * not offered, and the bot works without it, because a site removing a tool should not break every
 * bot that mentioned it.
 */
export function toolsFor({ bot = {}, declared = {}, surface = 'spaces', opened = new Set(), allowed = null } = {}) {
  /* the bot's own, plus `open_skill` when it has any, plus the tools of the skills it has OPENED
     — a skill's tools arrive with the skill and not before, so a bot that never opens the refunds
     skill is never offered the refund tool */
  /* WITHHELD, NEVER REFUSED. A tool the asker may not use is absent from the list the model is
     given, so it is never asked for and never declined — see the note on skillsLine. `allowed` is
     the set the database permitted for this run (agent_permits); null means no gating was asked
     for, which is what a bot with no audiences on anything gets. */
  const may = (n) => !allowed || allowed.has(n)
  const skills = (bot.skills || []).filter((s) => may(s.name))
  const fromSkills = skills.filter((s) => opened.has(s.name)).flatMap((s) => s.tools || [])
  const want = [...(bot.tools || []).filter(may), ...(skills.length ? ['open_skill'] : []), ...fromSkills.filter(may)]
  const out = []
  for (const name of want) {
    const builtin = BUILTINS[name]
    if (builtin) {
      if (builtin.needs === 'desk' && surface !== 'support') continue
      out.push({ name, description: builtin.description, parameters: builtin.parameters, kind: 'builtin' })
      continue
    }
    const d = declared[name]
    if (!d) continue
    if (d.kind === 'openapi') out.push(...(d.tools || []).map((t) => ({ ...t, kind: 'openapi', tool: name })))
    else out.push({ name, description: d.description || name, parameters: d.parameters || { type: 'object', properties: {} }, kind: d.kind, tool: name })
  }
  /* a name is a name: two tools with one name would make a model's answer ambiguous */
  const seen = new Set()
  return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
}
