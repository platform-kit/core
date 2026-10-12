/*
 * BOTS, TOOLS AND COMMANDS, compiled.
 *
 * All three are files, for the same reason everything else here is: if the database were deleted
 * and the repository redeployed, a bot should come back. What it has DONE is rows; what it IS is a
 * file, reviewable in a pull request like any other decision.
 *
 *   content/bots/<slug>.md      who it is, what it may do, who may summon it, what it may spend,
 *                               and — as the body — its prompt
 *   content/tools/<name>.md     an ability: an OpenAPI spec, or a module the site ships
 *   content/commands/<name>.md  a slash command: the arguments as FIELDS, and the prompt it runs
 *
 * Out of them:
 *   supabase/functions/_shared/bots.json   what the worker reads
 *   .velite/commands.json                  what the composer offers, gated
 *
 * The compile refuses what would fail at runtime rather than at three in the morning: a bot with no
 * prompt, a tool nothing declares, a surface that is not a surface, a spec that will not parse, an
 * argument of a kind no control can draw.
 */
import fs from 'node:fs'
import { MEMORIES } from '../src/lib/agents/loop.js'
import path from 'node:path'
import { asStore } from './store/index.mjs'
import matter from 'gray-matter'
import { DESK_BOT, extend } from '../supabase/functions/_shared/agents/desk-bot.js'
import { BUILTINS, fromOpenApi } from '../supabase/functions/_shared/agents/tools.js'
import { problems as repeatProblems } from '../src/lib/recurrence.js'
import { uiScope } from './strings-io.mjs'

export const OUT = 'supabase/functions/_shared/bots.json'
/* the worker's copy, WITH each command's prompt. The browser's copy (SITE_OUT) has everything but
   the prompt, on purpose: the composer needs to draw the form, and a client that carried the
   prompt could send any prompt it liked under a command's name. */
export const CMD_OUT = 'supabase/functions/_shared/commands.json'
/* NOT `.velite/commands.json`: velite owns a file per collection and there is a `commands`
   collection, so the two would take turns overwriting each other. These are the compiled records
   the composer draws a form from — the collection is the content's own view of the same files. */
export const SITE_OUT = '.velite/agent-commands.json'
/* what a SURFACE needs of a bot: the name to show, where it works, what wakes it and who may
   summon it. Never the prompt and never its tools — a browser has no use for either, and the
   less of a bot a client holds the less there is to go wrong when one is changed. (velite has a
   `bots` collection of its own, but that is the file's frontmatter as written; this is the
   compiled record, with the audience and the triggers in the shape everything else reads.) */
export const SITE_BOTS = '.velite/agents.json'
/* VOICE IS A SURFACE LIKE ANY OTHER — the same audience rule, tools, skills, memory and limits.
   What differs is only that the words arrive as speech and leave as speech, which is the listener's
   business and not this one's. */
export const SURFACES = ['spaces', 'support', 'coaching', 'voice', 'social']
/* what an argument may be, and therefore what control the composer draws for it. A kind nothing
   can draw is refused here rather than becoming a free-text box that teaches a syntax. */
export const ARG_KINDS = ['text', 'number', 'span', 'choice', 'person', 'channel', 'boolean']

/* the windows a spend ceiling may be given over. Rolling, not calendar: "you may ask again on the
   1st" is not a thing anybody wants to be told. A typo here is a ceiling that silently never
   applies, which is the worst way for a spend control to fail, so an unknown one is a build error. */
export const SPEND_WINDOWS = ['minute', 'hour', 'day', 'week', 'month']

/*
 * HOW A BOT IS OFFERED ON A DESK. Off unless a file says otherwise, because a bot that talks to
 * somebody's customers should not switch itself on because a feature shipped.
 *
 *   off      a staff tool: somebody presses Ask the bot and reads a draft before sending it.
 *   ask      the widget offers it and the person chooses. Nothing runs unless they press.
 *   always   it answers every message they send.
 *
 * `ask` is the one worth having by default in most shops: it costs nothing until somebody wants it,
 * it never surprises anybody, and the people who would rather wait for a human simply do not press.
 */
export const OFFERS = ['off', 'ask', 'always']

/*
 * WHAT A BOT MAY SEARCH.
 *
 * The library by default and nothing else: books, articles, wiki pages, docs. Those are what a site
 * PUBLISHES for people to read, so a bot quoting them is quoting what the reader could already
 * find. Everything else is opt-in, by name, in the bot's own file.
 *
 * Landing pages and products are deliberately NOT in the default. A page is a sales surface with
 * variants and experiments running on it — a bot should not read a variant at somebody who is not
 * in it — and a product's prices belong to the catalog, which knows about currency and tiers, not
 * to a text search that would quote a price out of a paragraph.
 *
 * A site's own models are opt-in too, and may hide fields:
 *
 *   searches:
 *     - recipes
 *     - model: suppliers
 *       except: [cost, contact_email]
 */
export { SEARCHES } from '../supabase/functions/_shared/agents/tools.js'

export function searchesOf(v) {
  const out = []
  for (const s of Array.isArray(v) ? v : v ? [v] : []) {
    if (typeof s === 'string') { const k = lower(s); if (k) out.push({ model: k, except: [] }) }
    else if (s && s.model) out.push({ model: lower(s.model), except: (s.except || []).map(lower) })
  }
  return out
}

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase()

/* who may summon it — the same grammar as everything else that is gated here */
export function audienceOf(v) {
  if (v == null || v === '' || v === 'anyone') return []
  const one = (x) => {
    if (typeof x !== 'string') return x && typeof x === 'object' ? x : null
    const s = x.trim()
    if (!s || s === 'anyone') return null
    /* signed in, and nothing more. This used to be { entitlement: 'account' } — an entitlement
       nothing grants, so the setting matched nobody at all. */
    if (s === 'authenticated') return { signed_in: true }
    /* has bought something, anything: the class the ledger grants on every paid purchase */
    if (s === 'customer') return { paid: true }
    if (s === 'subscribed') return { entitlement: 'subscribed' }
    if (s.startsWith('tier:')) return { tier: s.slice(5) }
    if (s.startsWith('role:')) return { role: [s.slice(5)] }
    if (s.startsWith('bought:')) return { product: s.slice(7) }
    return { tier: s }
  }
  return (Array.isArray(v) ? v : [v]).map(one).filter(Boolean)
}

/* what wakes it without being asked */
export function hearsOf(v) {
  const out = []
  for (const h of Array.isArray(v) ? v : v ? [v] : []) {
    if (typeof h === 'string') { out.push({ kind: lower(h) }); continue }
    if (h && h.schedule) out.push({ kind: 'schedule', repeats: h.schedule, in: h.in || '', ask: h.ask || '' })
    else if (h && h.event) out.push({ kind: 'event', event: h.event, ask: h.ask || '' })
    else if (h && h.kind) out.push(h)
  }
  return out
}

/* ------------------------------------------------------------------ tools */

export async function readTools(st) {
  const names = await st.list('content/tools')
  const out = {}
  const faults = []
  for (const name of names) {
    const parsed = matter(String((await st.read(`content/tools/${name}.md`)) || ''))
    const d = parsed.data || {}
    const where = `tools/${name}.md`
    if (BUILTINS[name]) { faults.push(`${where}: "${name}" is one of the kit's own tools — give this one another name.`); continue }
    const rec = {
      name, kind: d.openapi ? 'openapi' : d.module ? 'code' : null,
      description: d.description || String(parsed.content || '').trim().split('\n')[0] || name,
      audience: audienceOf(d.for),
      auth: d.auth || null,
    }
    if (!rec.kind) { faults.push(`${where}: a tool is an \`openapi:\` spec or a \`module:\` the site ships.`); continue }
    if (rec.kind === 'openapi') {
      let spec = null
      if (/^https?:\/\//.test(String(d.openapi))) {
        /* a url is read at compile time so the build is the thing that fails, never a run */
        try { spec = await (await fetch(d.openapi)).json() } catch (e) { faults.push(`${where}: could not read ${d.openapi} — ${e.message}`); continue }
      } else {
        const text = await st.read(String(d.openapi).replace(/^\.?\//, ''))
        if (!text) { faults.push(`${where}: no spec at ${d.openapi}.`); continue }
        try { spec = JSON.parse(text) } catch { faults.push(`${where}: ${d.openapi} is not JSON. (A YAML spec is converted once, by hand, and committed.)`); continue }
      }
      const headers = d.headers && typeof d.headers === 'object' && !Array.isArray(d.headers) ? d.headers : {}
      for (const [header, value] of Object.entries(headers)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) || typeof value !== 'string' || /[\r\n]/.test(value)) {
          faults.push(`${where}: invalid static HTTP header "${header}".`)
        }
      }
      rec.tools = fromOpenApi(spec, { only: d.operations || [], name, base: d.base || '', headers })
      if (!rec.tools.length) faults.push(`${where}: the spec gave no operations${d.operations ? ' matching `operations:`' : ''}.`)
    } else {
      rec.module = String(d.module)
      rec.parameters = d.parameters || { type: 'object', properties: {} }
    }
    out[name] = rec
  }
  return { tools: out, faults }
}

/* ------------------------------------------------------------------ skills */

/*
 * A SKILL IS SOMETHING A BOT KNOWS; A TOOL IS SOMETHING IT CAN DO.
 *
 * The distinction matters because of how a skill reaches the model. Its DESCRIPTION is in the
 * system prompt from the start — one line, so the bot can tell whether it is relevant — and its
 * BODY is not: the bot opens it with a tool when it decides it needs it. A bot with twenty skills
 * therefore carries twenty lines, not twenty pages, which is the whole point. Put them all in the
 * prompt and the bot gets worse at everything as you teach it more.
 *
 * A skill may also bring TOOLS, which are offered only once it has been opened — so a refund
 * skill can carry the refund tool, and a bot that never opens it is never offered it.
 */
/*
 * THE THEME'S SKILLS ARE THE DEFAULTS, and the site's are its own.
 *
 * The line between them is what the skill is FOR. A skill that stops a bot doing harm — quoting a
 * price it made up, confirming whether a stranger has an account, telling somebody it understands
 * how they feel — is the same for every business, and shipping it means a site gets it without
 * knowing it needed it. A skill that encodes POLICY — what this business refunds, how long it
 * takes, what it will and will not do — belongs to the site, because the kit would only be
 * guessing.
 *
 * A site's skill REPLACES a default of the same name rather than merging with it: a skill is a
 * piece of prose telling somebody how to behave, and half of one person's advice spliced into half
 * of another's is worse than either.
 */
export async function readSkills(st, { theme, themeSkills } = {}) {
  const siteNames = await st.list('content/skills')
  /* THE THEME'S DEFAULTS COME IN AS DATA WHERE THERE IS NO DISK. In a checkout `theme` is the
     package's skills directory and is read from it; inside the Edge Function there is no package
     directory, so the assembler bundles the same files as pipe/theme-skills.json and the caller
     hands them in — the arrangement the theme's STRINGS already have, and for the same reason. */
  const given = themeSkills && typeof themeSkills === 'object' ? themeSkills : null
  const themeDir = given ? Object.keys(given)
    : theme && fs.existsSync(theme) ? fs.readdirSync(theme).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)) : []
  const read = async (name, fromTheme) => (fromTheme
    ? (given ? String(given[name] || '') : fs.readFileSync(path.join(theme, name + '.md'), 'utf8'))
    : String((await st.read(`content/skills/${name}.md`)) || ''))
  const out = {}
  const faults = []
  const all = [...themeDir.filter((n) => !siteNames.includes(n)).map((n) => [n, true]), ...siteNames.map((n) => [n, false])]
  for (const [name, fromTheme] of all) {
    const parsed = matter(await read(name, fromTheme))
    const d = parsed.data || {}
    const where = fromTheme ? `the theme's skills/${name}.md` : `skills/${name}.md`
    const body = String(parsed.content || '').trim()
    const rec = {
      name, title: d.name || d.title || name,
      description: String(d.description || '').trim(),
      audience: audienceOf(d.for), tools: d.tools || [],
      body, published: d.published !== false,
    }
    /* THE DESCRIPTION IS THE WHOLE INTERFACE: it is what the bot reads to decide whether to open
       this at all, so a skill without one is a skill that is never used. */
    if (!rec.description) faults.push(`${where}: a skill needs a one-line \`description\` — it is what the bot reads to decide whether to open it.`)
    if (!rec.body) faults.push(`${where}: a skill's body is what it teaches, and this one has none.`)
    out[name] = rec
  }
  return { skills: out, faults }
}

/* ------------------------------------------------------------------ bots */

export async function readBots(st, { tools = {}, skills = {}, sealed = null } = {}) {
  const names = await st.list('content/bots')
  const usageOfferKeys = new Set()
  for (const name of await st.list('content/store/products')) {
    const parsed = matter(String((await st.read(`content/store/products/${name}.md`)) || ''))
    if (parsed.data?.published !== false && parsed.data?.usage && /^[0-9a-f]{8}$/.test(String(parsed.data?.key || ''))) {
      usageOfferKeys.add(parsed.data.key)
    }
  }
  const out = []
  const faults = []
  /* what a bot says when it stops: the theme's words with the site's merged over them, and each
     bot's own `endings:` over those. Read through uiScope, never a file — the same way every
     build script reads a word. */
  let endings = {}
  let words = {}
  let context = {}
  let events = {}
  try {
    const bots = ((await uiScope('spaces')) || {}).bots || {}
    endings = bots.endings || {}
    /* what a TOOL says when it cannot answer — distinct from what a RUN says when it stops. Today
       that is one line: there is no account behind this conversation to look anything up against. */
    words = bots.words || {}
    /* how the transcript is introduced, and how a platform line is worded — the worker builds the
       prose now, so it needs the same records the surface draws a line with */
    context = bots.context || {}
    events = ((await uiScope('spaces')) || {}).events || {}
  } catch (e) { endings = {}; words = {}; context = {}; events = {} }
  for (const slug of names) {
    const parsed = matter(String((await st.read(`content/bots/${slug}.md`)) || ''))
    const d = parsed.data || {}
    const where = `bots/${slug}.md`
    const prompt = String(parsed.content || '').trim()
    let bot = {
      slug, name: d.name || slug, avatar: d.avatar || null, model: d.model || null,
      ...(d.billing ? { billing: lower(d.billing) } : {}),
      surfaces: (Array.isArray(d.surfaces) ? d.surfaces : d.surfaces ? [d.surfaces] : ['spaces']).map(lower),
      ...(d.voice ? { voice: d.voice } : {}),
      audience: audienceOf(d.for), serves: audienceOf(d.serves), spaces: d.spaces || [],
      offer: lower(d.offer) || 'off',
      /* the library, plus whatever this bot's file opts into */
      searches: searchesOf(d.searches),
      hears: hearsOf(d.hears), tools: d.tools || [],
      limits: d.limits || {}, memory: lower(d.memory) || 'thread',
      /* draft (the default) or directly: see the note over post() in the agent-run function */
      answers: lower(d.answers) || 'draft',
      extends: d.extends || null, prompt, published: d.published !== false,
      endings: { ...endings, ...(d.endings || {}) },
      words: { ...words, ...(d.words || {}) },
      context: { ...context, ...(d.context || {}) },
      events,
      /* `skills: all` is every published one, which is what a single-bot site wants */
      skills: d.skills === 'all' ? Object.keys(skills).filter((k) => skills[k].published) : (d.skills || []),
    }
    /*
     * BEING OFFERED TO PEOPLE MEANS ANSWERING THEM.
     *
     * `answers` is about a desk bot's default caution: it writes a draft and a human sends it. That
     * is right for a staff tool and absurd for a bot somebody just pressed a button to ask — the
     * answer would go to the staff composer and the person who asked would watch nothing happen.
     * So an offered bot answers directly, and `answers` keeps its meaning for the `off` case.
     */
    if (bot.offer !== 'off') bot.answers = 'directly'
    /* THE OFFER IS THE EAR — one way of saying a thing, not two that could disagree. 'always'
       hears every message; 'ask' hears only the press of the button, which the widget sends as its
       own event so that nothing a person merely TYPES can start a run on an opt-in bot. */
    /* an `ask` bot hears BOTH: the button that chooses it, and — once chosen — what they write
       next. Which of those actually starts a run is the database's call (agent_hear), because only
       it knows whether this conversation has chosen the bot. */
    const ears = bot.offer === 'always' ? ['support-message'] : bot.offer === 'ask' ? ['support-asked', 'support-message'] : []
    for (const e of ears) {
      if (!bot.hears.some((h) => h.kind === 'event' && h.event === e)) bot.hears = [...bot.hears, { kind: 'event', event: e, ask: '' }]
    }
    if (bot.extends === DESK_BOT.slug) bot = extend({ ...bot, prompt }, DESK_BOT)
    if (!bot.prompt) faults.push(`${where}: a bot's body is its prompt, and this one has none.`)
    if (bot.billing && !/^[0-9a-f]{8}$/.test(bot.billing)) {
      faults.push(`${where}: billing must be the stable eight-hex key of a published usage offer.`)
    } else if (bot.billing && !usageOfferKeys.has(bot.billing)) {
      faults.push(`${where}: billing key "${bot.billing}" does not name a published usage offer.`)
    }
    for (const s of bot.surfaces) if (!SURFACES.includes(s)) faults.push(`${where}: "${s}" is not a surface — ${SURFACES.join(', ')}.`)
    /* A VOICE WITH NOWHERE TO SPEAK is a file somebody wrote half of — the same fault as a
       schedule with no room, and refused the same way rather than ignored. */
    if (bot.voice && !bot.surfaces.includes('voice')) {
      faults.push(`${where}: this declares how it sounds but not the voice surface — add \`surfaces: [voice]\`, or take the \`voice:\` block out.`)
    }
    for (const t of bot.tools) if (!BUILTINS[t] && !tools[t]) faults.push(`${where}: no tool called "${t}".`)
    for (const s of bot.skills) if (!skills[s]) faults.push(`${where}: no skill called "${s}".`)
    for (const h of bot.hears) {
      if (h.kind === 'schedule') {
        for (const p of repeatProblems(h.repeats)) faults.push(`${where}: ${p}`)
        /* a bot that wakes on a clock has to know where to speak and what it is waking up to do.
           Without either it is a run that happens every Monday and goes nowhere. */
        if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(String(h.in || ''))) {
          faults.push(`${where}: a schedule says where it speaks — \`in: <space>/<channel>\`.`)
        } else if (sealed && sealed.has(String(h.in))) {
          /* A BOT CANNOT BE PUT IN A SEALED ROOM. It would have to read the room to answer in it,
             and nothing on this side can — the ciphertext is the only copy the site has. Refused
             here rather than left to a run that wakes every Monday and says nothing. */
          faults.push(`${where}: ${h.in} is an end-to-end encrypted room, and a bot cannot read one — it would have to in order to answer. Point the schedule at an open room, or take the seal off that one.`)
        }
        if (!String(h.ask || '').trim()) faults.push(`${where}: a schedule says what it is waking up to do — \`ask:\`.`)
      }
      if (h.kind === 'event' && !String(h.event || '').trim()) faults.push(`${where}: an event trigger says which event.`)
      else if (!['mention', 'event', 'schedule'].includes(h.kind)) faults.push(`${where}: nothing called "${h.kind}" can wake a bot.`)
    }
    /* the shared module's list, never a second copy of it — two lists of the same decided set is
       how one of them silently falls behind, which is exactly what happened when voice was added */
    if (!MEMORIES.includes(bot.memory)) faults.push(`${where}: memory is ${MEMORIES.join(', ')}.`)
    if (!['draft', 'directly'].includes(bot.answers)) faults.push(`${where}: answers is draft or directly — "${bot.answers}" is neither.`)
    if (!OFFERS.includes(bot.offer)) faults.push(`${where}: offer is ${OFFERS.join(', ')} — "${bot.offer}" is none of them.`)
    /* a bot that answers people directly and has no ceiling is a bill waiting to happen */
    if (bot.offer !== 'off' && !Object.keys((bot.limits && bot.limits.per) || {}).length) {
      faults.push(`${where}: a bot offered to people needs limits.per — a per-run budget does not stop one person asking two hundred times. ${SPEND_WINDOWS.join(', ')}.`)
    }
    for (const [k, v] of Object.entries((bot.limits && bot.limits.per) || {})) {
      if (!SPEND_WINDOWS.includes(k)) faults.push(`${where}: limits.per has no window called "${k}" — it is ${SPEND_WINDOWS.join(', ')}.`)
      else if (!(Number(v) > 0)) faults.push(`${where}: limits.per.${k} is money per person, so it must be a number above zero.`)
    }
    /* what the worker needs of the tools this bot names, carried with it so one read is enough */
    /* the skills it carries, whole: the worker needs the body to hand when one is opened, and a
       file the function loads once is not a prompt — the progressive part is what reaches the MODEL */
    bot.skills = bot.skills.filter((s) => skills[s]).map((s) => {
      const { published, ...rest } = skills[s]
      return rest
    })
    /* a skill's tools are declared alongside the bot's own, so they RESOLVE; whether they are
       OFFERED depends on the skill having been opened (toolsFor) */
    const withSkills = [...bot.tools, ...bot.skills.flatMap((s) => s.tools || [])]
    bot.declared = Object.fromEntries(withSkills.filter((t) => tools[t]).map((t) => [t, tools[t]]))
    out.push(bot)
  }
  return { bots: out, faults }
}

/* ------------------------------------------------------------------ commands */

export async function readCommands(st, { bots = [], tools = {} } = {}) {
  const names = await st.list('content/commands')
  const out = []
  const faults = []
  for (const name of names) {
    const parsed = matter(String((await st.read(`content/commands/${name}.md`)) || ''))
    const d = parsed.data || {}
    const where = `commands/${name}.md`
    const cmd = {
      name: lower(d.name || name), hint: d.hint || '',
      args: (d.args || []).map((a) => ({
        name: lower(a.name), kind: lower(a.kind) || 'text', label: a.label || a.name,
        required: a.required !== false && a.default == null, default: a.default ?? null,
        choices: a.choices || null,
      })),
      audience: audienceOf(d.for), bot: d.bot || null, tool: d.run || null,
      surfaces: (Array.isArray(d.surfaces) ? d.surfaces : ['spaces']).map(lower),
      prompt: String(parsed.content || '').trim(),
    }
    if (!/^[a-z][a-z0-9-]*$/.test(cmd.name)) faults.push(`${where}: a command's name is a word — letters, digits and dashes.`)
    for (const a of cmd.args) {
      if (!ARG_KINDS.includes(a.kind)) faults.push(`${where}: "${a.kind}" is not a kind of argument — ${ARG_KINDS.join(', ')}.`)
      if (a.kind === 'choice' && !(a.choices || []).length) faults.push(`${where}: the argument "${a.name}" is a choice and names none.`)
    }
    if (cmd.bot && !bots.some((b) => b.slug === cmd.bot)) faults.push(`${where}: no bot called "${cmd.bot}".`)
    /* a command offered where its bot does not work is a button that can only ever fail */
    const its = bots.find((b) => b.slug === cmd.bot)
    if (its) for (const s of cmd.surfaces) {
      if (!its.surfaces.includes(s)) faults.push(`${where}: this runs on "${s}" but "${cmd.bot}" only works on ${its.surfaces.join(", ")}.`)
    }
    if (cmd.tool && !BUILTINS[cmd.tool] && !tools[cmd.tool]) faults.push(`${where}: no tool called "${cmd.tool}".`)
    if (!cmd.bot && !cmd.tool) faults.push(`${where}: a command either asks a bot or runs a tool.`)
    if (cmd.bot && !cmd.prompt) faults.push(`${where}: a command that asks a bot says what to ask it.`)
    out.push(cmd)
  }
  return { commands: out, faults }
}

/* ------------------------------------------------------------------ the compile */

export async function compileBots({ root = process.cwd(), store, check = false, write = true, on = true, themeSkills = null } = {}) {
  const st = asStore(store || root)
  const { tools, faults: tf } = await readTools(st)
  /* the theme's defaults, under the site's own — resolved here because this is where the site is
     known; a checkout has a theme, the Edge Function does not and simply gets the site's */
  let themeDirPath = null
  if (!themeSkills) {
    try {
      const { loadSite } = await import('./site.mjs')
      const { loadTheme } = await import('./theme.mjs')
      const t = await loadTheme(await loadSite(st.root || root))
      themeDirPath = t && t.skills ? t.skills : null
    } catch (e) { /* no theme package to read from here — the caller hands the defaults in instead */ }
  }
  const { skills, faults: sf } = await readSkills(st, { theme: themeDirPath, themeSkills })
  /* which rooms are sealed, so a schedule cannot point a bot into one. Read through the same store
     as everything else, so it works over rows as well as files; a site with no spaces at all has
     none, which is the empty set and refuses nothing. */
  let sealed = new Set()
  try {
    const { readSpaces, sealedRooms } = await import('./spaces-io.mjs')
    sealed = sealedRooms(await readSpaces(st))
  } catch (e) { /* no spaces to read: nothing is sealed, and nothing is refused */ }
  const { bots, faults: bf } = await readBots(st, { tools, skills, sealed })
  const { commands, faults: cf } = await readCommands(st, { bots, tools })
  /* a skill's own tools must exist too, or opening it offers a tool nothing can run */
  for (const [name, s] of Object.entries(skills)) {
    for (const t of s.tools || []) if (!BUILTINS[t] && !tools[t]) sf.push(`skills/${name}.md: no tool called "${t}".`)
  }
  const faults = [...tf, ...sf, ...bf, ...cf]
  if (faults.length) {
    for (const f of faults) console.log('  ! ' + f)
    throw new Error(`bots: ${faults.length} fault(s)`)
  }
  const live = bots.filter((b) => b.published)
  if (write && !check && on) {
    await st.write(OUT, JSON.stringify(live, null, 2))
    await st.write(CMD_OUT, JSON.stringify(commands, null, 2))
    await st.write(SITE_OUT, JSON.stringify(commands.map(({ prompt, ...c }) => c), null, 2))
    await st.write(SITE_BOTS, JSON.stringify(live.map((b) => ({
      slug: b.slug, name: b.name, avatar: b.avatar, surfaces: b.surfaces,
      audience: b.audience, hears: b.hears, answers: b.answers, ...(b.billing ? { billing: b.billing } : {}),
    })), null, 2))
  }
  return { bots: live, tools, skills, commands, faults }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  const { bots, tools, skills, commands } = await compileBots({ check })
  console.log(`bots: ${bots.length} bot(s), ${Object.keys(tools).length} tool(s), ${Object.keys(skills).length} skill(s), ${commands.length} command(s)`)
  for (const b of bots) console.log(`  ${b.slug} — ${b.surfaces.join(', ')}${b.tools.length ? ` · ${b.tools.join(', ')}` : ''}${b.skills.length ? ` · knows ${b.skills.map((s) => s.name).join(', ')}` : ''}`)
  for (const c of commands) console.log(`  /${c.name} — ${c.hint || (c.bot ? 'asks ' + c.bot : 'runs ' + c.tool)}`)
}
