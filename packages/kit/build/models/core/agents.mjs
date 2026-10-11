/*
 * Bots, skills, tools, commands and events as models of the registry — so a site with NO CHECKOUT
 * can change them.
 *
 * That sentence is the whole reason this file exists. A content type with a compile and no model
 * works perfectly on a developer's machine and is frozen solid in cloud mode: the rows are there,
 * the compile reads them, a publish would push them, and nothing can edit them short of writing
 * SQL. It is invisible from the place you build it, which is why build/content-kinds.mjs now
 * refuses a content directory that has no model.
 *
 * Each of these is drawn by the admin's default editor from the zod below (a field's .meta()
 * carries its label, widget and help), so there is no component to write. The grammars they are
 * checked against are build/bots.mjs and build/events.mjs — the same ones the compile uses.
 */
import { z } from 'zod'
import { EVENTS } from '../../spaces-io.mjs'
import matter from 'gray-matter'
import { DUMP, cleanData } from '../util.mjs'
import { uiScope } from '../../strings-io.mjs'

/* WHO GETS IT — chosen, never typed.
 *
 * This asked for `role:<slug>` and `bought:<sku>` in a help line under a text field, which is the
 * mistake the project has a rule about: people cannot be relied on to type structured text and must
 * not be asked to. The values are a closed list — the classes, plus whatever tiers, roles and
 * offers the site actually has — so the field offers them and writes the grammar itself.
 */
const audience = z.union([z.string(), z.array(z.string())])
  .meta({ label: 'Who gets it', widget: 'multiselect', options: 'audience',
    help: 'several means any of them; nothing chosen means anyone' })
  .optional()

const BOT_VOICE_FIELDS = [
  { key: 'by', label: 'Speech provider', kind: 'select', choices: [
    { value: 'browser', label: 'On this device' },
    { value: 'endpoint', label: 'Site speech endpoint' },
  ], help: 'leave empty to use the site endpoint when configured, otherwise the browser voice', rules: [{ rule: 'in', params: ['browser', 'endpoint'] }] },
  { key: 'say', label: 'Endpoint voice', kind: 'select', choices: [
    { value: 'alloy', label: 'Alloy' },
    { value: 'ash', label: 'Ash' },
    { value: 'coral', label: 'Coral' },
    { value: 'echo', label: 'Echo' },
    { value: 'fable', label: 'Fable' },
    { value: 'nova', label: 'Nova' },
    { value: 'onyx', label: 'Onyx' },
    { value: 'sage', label: 'Sage' },
    { value: 'shimmer', label: 'Shimmer' },
  ], rules: [{ rule: 'in', params: ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] }] },
  { key: 'voices', label: 'Voices readers may choose', kind: 'list' },
  { key: 'greeting', label: 'First sentence', kind: 'text' },
  { key: 'wait', label: 'Wait before the holding line (seconds)', kind: 'number', rules: [{ rule: 'between', params: [0, 10] }] },
  { key: 'visual', label: 'Visualizer', kind: 'select', choices: [
    { value: 'aura', label: 'Aura' },
    { value: 'wave', label: 'Wave' },
    { value: 'radial', label: 'Radial' },
    { value: 'grid', label: 'Grid' },
    { value: 'bar', label: 'Bar' },
  ], rules: [{ rule: 'in', params: ['aura', 'wave', 'radial', 'grid', 'bar'] }] },
  { key: 'steps', label: 'Engine steps', kind: 'number', rules: [{ rule: 'between', params: [1, 32] }] },
  { key: 'opening', label: 'Opening steps', kind: 'number', rules: [{ rule: 'between', params: [1, 32] }] },
  { key: 'words', label: 'Opening words', kind: 'number', rules: [{ rule: 'between', params: [1, 60] }] },
  { key: 'gap', label: 'Pause between pieces (seconds)', kind: 'number', rules: [{ rule: 'between', params: [0, 2] }] },
]

/* A LIST EITHER WAY, in the editor. The files write `for: anyone` as often as a list of two, and a
   chooser handed a string iterates it — "anyone" came back as six letters, each its own choice. So
   the grammar reads these two fields as a list and writes one back as a string where it holds one
   thing, which is how every file here is already written. */
const AUDIENCE_FIELDS = ['for', 'serves']
/*
 * WHAT IT MAY SPEND, AS FIELDS. `limits` is a block in the file — steps, spend, minutes, tools, and
 * `per`, a ceiling per person over a rolling window. It was drawn in the admin as a text input
 * holding JSON.stringify of the block, which is the mistake this project has a rule against: people
 * cannot be relied on to type structured text and must never be asked to. So the block is taken
 * apart on the way in and put back on the way out, and the editor asks for each number with a
 * control that fits it.
 *
 * Only what differs from nothing is written back, so a file that says one thing keeps saying one
 * thing rather than growing every key with a default in it.
 */
/*
 * WHAT WAKES IT, in and out. The file says it three ways — a bare `mention`, a `schedule:` with a
 * repeat and where it speaks, an `event:` — and the editor asks one question (which kind) and then
 * only what that kind needs. These two functions are the whole of the translation, so the file can
 * never be bent out of shape by a row and a row can never be a grammar somebody typed.
 */
const hearsIn = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((h) => {
  if (typeof h === 'string') return { kind: h }
  if (h && h.schedule) return { kind: 'schedule', ...(h.schedule || {}), on: h.schedule.on == null ? undefined : [].concat(h.schedule.on), in: h.in || '', ask: h.ask || '' }
  if (h && h.event) return { kind: 'event', event: h.event, ask: h.ask || '' }
  return h && typeof h === 'object' ? { ...h } : { kind: String(h || '') }
}).filter((h) => h.kind)
const hearsOut = (rows) => (Array.isArray(rows) ? rows : []).map((r) => {
  const k = r && r.kind
  if (k === 'mention') return 'mention'
  if (k === 'schedule') {
    const rep = {}
    for (const key of ['every', 'at', 'zone', 'lasts', 'until', 'count']) if (r[key] != null && r[key] !== '') rep[key] = r[key]
    const on = [].concat(r.on || []).filter(Boolean)
    if (on.length) rep.on = on
    const out = { schedule: rep }
    if (r.in) out.in = r.in
    if (r.ask) out.ask = r.ask
    return out
  }
  if (k === 'event') { const out = { event: r.event }; if (r.ask) out.ask = r.ask; return out }
  return k ? { ...r } : null
}).filter(Boolean)

const LIMIT_KEYS = ['steps', 'spend', 'minutes', 'tools']
const PER_KEYS = ['minute', 'hour', 'day', 'week', 'month']
const num = (v) => (v === '' || v == null ? null : Number(v))

export const agentGrammar = {
  parse: (text) => {
    const fm = matter(text)
    const d = { ...(fm.data || {}) }
    for (const k of AUDIENCE_FIELDS) if (d[k] != null) d[k] = Array.isArray(d[k]) ? d[k] : [d[k]]
    d['skills-mode'] = d.skills === 'all' ? 'all' : Array.isArray(d.skills) && d.skills.length ? 'some' : 'none'
    if (d.skills === 'all') delete d.skills
    if (d.hears != null) d.hears = hearsIn(d.hears)
    const l = d.limits && typeof d.limits === 'object' ? d.limits : {}
    for (const k of LIMIT_KEYS) if (l[k] != null) d['limit-' + k] = l[k]
    const per = l.per && typeof l.per === 'object' ? l.per : {}
    for (const k of PER_KEYS) if (per[k] != null) d['per-' + k] = per[k]
    delete d.limits
    return { data: d, content: fm.content.replace(/^\n/, '') }
  },
  serialise: (rec) => {
    const d = { ...(rec.data || {}) }
    const mode = d['skills-mode']; delete d['skills-mode']
    if (mode === 'all') d.skills = 'all'
    else if (mode === 'none') delete d.skills
    else if (Array.isArray(d.skills) && !d.skills.length) delete d.skills
    if (d.hears != null) { const h = hearsOut(d.hears); if (h.length) d.hears = h; else delete d.hears }
    const limits = {}
    for (const k of LIMIT_KEYS) { const v = num(d['limit-' + k]); delete d['limit-' + k]; if (v != null && !Number.isNaN(v)) limits[k] = v }
    const per = {}
    for (const k of PER_KEYS) { const v = num(d['per-' + k]); delete d['per-' + k]; if (v != null && !Number.isNaN(v)) per[k] = v }
    if (Object.keys(per).length) limits.per = per
    if (Object.keys(limits).length) d.limits = limits; else delete d.limits
    for (const k of AUDIENCE_FIELDS) {
      if (!Array.isArray(d[k])) continue
      const l = d[k].filter((x) => x !== '' && x != null)
      if (!l.length) delete d[k]
      else d[k] = l.length === 1 ? l[0] : l
    }
    return matter.stringify('\n' + String(rec.content || '').replace(/^\n+/, ''), cleanData(d), DUMP)
  },
}

/* the closed part of that list: the classes anybody may be in. The tiers, the roles and the offers
   are the site's own and are added to it below. */
/* what the platform already knows, worded for a person; the list itself is spaces-io's one copy */
const EVENT_WORDS = {
  'purchase.paid': 'Somebody pays for something',
  'subscription.started': 'Somebody takes out a membership',
  'print.failed': 'A print order fails',
  'account.new': 'Somebody makes an account',
  'support.escalated': 'A support thread is escalated',
}
const EVENT_CHOICES = EVENTS.map((e) => ({ value: e, label: EVENT_WORDS[e] || e }))

const AUDIENCE_CLASSES = [
  { value: 'anyone', label: 'Anyone' },
  { value: 'authenticated', label: 'Signed in' },
  { value: 'customer', label: 'Has bought something' },
  { value: 'subscribed', label: 'Has a live membership' },
]

export const bots = {
  grammar: agentGrammar,
  key: 'bots', name: 'Bots', dir: 'content/bots', title: 'name', module: 'bots',
  after: async (rec, ctx) => { await onBotWrite(ctx) },
  afterRemove: async (name, ctx) => { await onBotWrite(ctx) },
  projected: projectedBots,
  body: true, bodyLabel: 'What it is, and how it behaves (its prompt)', creates: true,
  fields: z.object({
    name: z.string().min(1).meta({ label: 'Name', grid: true, help: 'what people see it called, and what they type after @' }),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    surfaces: z.array(z.enum(['spaces', 'support', 'coaching', 'social'])).meta({ label: 'Where it works', grid: true, widget: 'multiselect', options: 'surfaces' }).optional(),
    answers: z.enum(['draft', 'directly']).meta({ label: 'How it answers', widget: 'select', choices: [{ value: 'draft', label: 'Writes a draft for a person to send' }, { value: 'directly', label: 'Answers the person itself' }], help: 'in a room a bot always speaks as itself; this is about the desk and a coaching thread, where it would be speaking in somebody else\'s name' }).optional(),
    for: audience,
    model: z.string().meta({ label: 'Model', help: 'blank uses the site\'s default; a fallback provider always uses its own' }).optional(),
    /*
     * WHAT IT KNOWS IT COULD LOOK UP. `all` is a real answer and not a shorthand for today's list:
     * it means every published skill, including the one somebody writes next month. So it is a
     * question of its own rather than a value hidden among the names — a multiselect handed 'all'
     * drew the word "null", which is what a control shows when it is asked to display something it
     * has no option for.
     */
    'skills-mode': z.enum(['none', 'all', 'some']).meta({ label: 'Skills', widget: 'select', choices: [
      { value: 'none', label: 'None' },
      { value: 'all', label: 'Everything published, including what is written next' },
      { value: 'some', label: 'Only the ones chosen' },
    ], help: 'what it knows it could look up. Only the one-line description is in its prompt; it opens the rest when it needs it' }).optional(),
    skills: z.array(z.string()).meta({ label: 'Which skills', widget: 'multiselect', options: 'skills', shown: { field: 'skills-mode', is: 'is', value: 'some' } }).optional(),
    tools: z.array(z.string()).meta({ label: 'Tools', widget: 'multiselect', options: 'tools', help: 'what it can do, always available' }).optional(),
    voice: z.object({
      by: z.enum(['browser', 'endpoint']).optional(),
      say: z.string().optional(),
      voices: z.array(z.string()).optional(),
      greeting: z.string().optional(),
      wait: z.number().min(0).max(10).optional(),
      visual: z.enum(['aura', 'wave', 'radial', 'grid', 'bar']).optional(),
      steps: z.number().min(1).max(32).optional(),
      opening: z.number().min(1).max(32).optional(),
      words: z.number().min(1).max(60).optional(),
      gap: z.number().min(0).max(2).optional(),
    }).meta({
      label: 'Voice',
      widget: 'group',
      kind: 'group',
      fields: BOT_VOICE_FIELDS,
    }).optional(),
    /*
     * WHAT WAKES IT — rows, never the grammar. This was a textarea whose placeholder said "JSON",
     * which is the mistake this project has a rule against: people cannot be relied on to type
     * structured text and must never be asked to. Each row is a kind picked from a list and the
     * controls that kind needs, and the file's shape is written back by the grammar below.
     */
    hears: z.array(z.record(z.string(), z.any())).meta({
      label: 'What wakes it', widget: 'rows', kind: 'list', of: 'group',
      help: 'leave it empty and it answers only when somebody asks it',
      fields: [
        { key: 'kind', label: 'When', required: true, kind: 'select', choices: [
          { value: 'mention', label: 'Somebody names it in a room' },
          { value: 'schedule', label: 'On a schedule' },
          { value: 'event', label: 'Something happens on the site' },
        ] },
        { key: 'event', label: 'What happens', required: true, kind: 'select', shown: { field: 'kind', is: 'is', value: 'event' },
          choices: EVENT_CHOICES },
        { key: 'every', label: 'How often', required: true, kind: 'select', shown: { field: 'kind', is: 'is', value: 'schedule' },
          choices: [{ value: 'day', label: 'Every day' }, { value: 'week', label: 'Every week' }, { value: 'month', label: 'Every month' }] },
        { key: 'on', label: 'On', kind: 'multi-select', shown: { field: 'kind', is: 'is', value: 'schedule' },
          help: 'which days — leave it empty for every one',
          choices: [{"value":"monday","label":"Monday"},{"value":"tuesday","label":"Tuesday"},{"value":"wednesday","label":"Wednesday"},{"value":"thursday","label":"Thursday"},{"value":"friday","label":"Friday"},{"value":"saturday","label":"Saturday"},{"value":"sunday","label":"Sunday"}] },
        { key: 'at', label: 'At', kind: 'text', shown: { field: 'kind', is: 'is', value: 'schedule' }, help: 'a wall clock in its own zone, like 08:00' },
        { key: 'in', label: 'Where it speaks', required: true, kind: 'text', shown: { field: 'kind', is: 'is', value: 'schedule' }, help: 'space/channel — a schedule with nowhere to speak is a run that goes nowhere' },
        { key: 'ask', label: 'What it wakes up to do', required: true, kind: 'long-text', shown: [{ field: 'kind', is: 'not-empty' }, { field: 'kind', is: 'is-not', value: 'mention' }],
          help: 'nobody is asking, so this is the whole of what it is for' },
      ],
    }).optional(),
    /* WHAT ONE RUN MAY SPEND OF ITSELF */
    'limit-steps': z.number().int().positive().meta({ label: 'Steps', grid: false, half: true, help: 'how many turns one answer may take' }).optional(),
    'limit-spend': z.number().positive().meta({ label: 'Spend, one run', half: true, help: 'in whole money — a run that would go over stops BEFORE the call' }).optional(),
    'limit-minutes': z.number().int().positive().meta({ label: 'Minutes', half: true, help: 'how long one answer may take' }).optional(),
    'limit-tools': z.number().int().positive().meta({ label: 'Tool calls', half: true, help: 'how many things it may do in one answer' }).optional(),
    /* AND WHAT ONE PERSON MAY SPEND OF IT. A per-run budget does nothing about the same person
       asking two hundred times; these are rolling windows, and every one given must hold. */
    'per-minute': z.number().positive().meta({ label: 'A minute', half: true, help: 'per person, rolling' }).optional(),
    'per-hour': z.number().positive().meta({ label: 'An hour', half: true }).optional(),
    'per-day': z.number().positive().meta({ label: 'A day', half: true }).optional(),
    'per-week': z.number().positive().meta({ label: 'A week', half: true }).optional(),
    'per-month': z.number().positive().meta({ label: 'A month', half: true, help: 'required when this bot offers itself: a per-run budget is no defence against one person in a loop' }).optional(),
    extends: z.string().meta({ label: 'Starts from', help: 'the kit\'s own desk bot ("desk"): its conduct and tools first, this one\'s words after' }).optional(),
  }),
  options: {
    surfaces: async ({ root, theme }) => {
      const words = await uiScope('spaces', root || process.cwd(), { theme })
      const labels = words.bots?.surfaces || {}
      return ['spaces', 'support', 'coaching', 'social'].map((value) => ({ value, label: labels[value] || value }))
    },
    /* WHO A BOT, A SKILL OR A TOOL IS FOR: the classes anybody may be in, and then this site's own
       membership tiers, its roles and the things it sells — so the field offers what can actually
       be chosen and nobody types a grammar. */
    audience: async ({ root, store }) => {
      const out = [...AUDIENCE_CLASSES]
      for (const r of ['admin', 'provider', 'editor', 'support', 'analyst']) out.push({ value: 'role:' + r, label: 'Runs the site: ' + r, group: 'Roles' })
      try {
        const raw = await store.read('supabase/functions/_shared/catalog.json')
        const cat = raw ? JSON.parse(raw) : {}
        const tiers = new Set(), skus = []
        for (const [sku, o] of Object.entries(cat.offers || {})) {
          if (o.kind === 'membership' && o.tier) tiers.add(o.tier)
          else skus.push({ value: 'bought:' + sku, label: o.title || sku, group: 'Bought' })
        }
        for (const t of [...tiers].sort()) out.push({ value: 'tier:' + t, label: 'Members of ' + t, group: 'Tiers' })
        out.push(...skus.sort((a, b) => a.label.localeCompare(b.label)))
      } catch { /* a site with no catalog offers the classes and the roles, which is right */ }
      return out
    },
  },
}

export const skills = {
  grammar: agentGrammar,
  key: 'skills', name: 'Skills', dir: 'content/skills', title: 'name', module: 'bots',
  body: true, bodyLabel: 'What it teaches (the instructions a bot reads when it opens this)', creates: true,
  fields: z.object({
    name: z.string().min(1).meta({ label: 'Name', grid: true }),
    description: z.string().min(1).meta({ label: 'One line', grid: true, help: 'THE WHOLE INTERFACE: this is all a bot sees until it opens the skill, and what it decides on. Say when to use it, not what it says.' }),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    tools: z.array(z.string()).meta({ label: 'Tools it brings', widget: 'multiselect', options: 'tools', help: 'offered only once the skill is opened' }).optional(),
    for: audience,
  }),
}

export const tools = {
  grammar: agentGrammar,
  key: 'tools', name: 'Tools', dir: 'content/tools', title: 'slug', module: 'bots',
  body: true, bodyLabel: 'What it is for', creates: true,
  fields: z.object({
    description: z.string().meta({ label: 'What it does', grid: true, help: 'the model reads this to decide when to use it' }).optional(),
    openapi: z.string().meta({ label: 'OpenAPI spec', help: 'a url, or a path in this site — read when the site builds, so a bad one fails the build rather than a run' }).optional(),
    operations: z.array(z.string()).meta({ label: 'Operations', help: 'which of the spec\'s operations to offer; blank is all of them' }).optional(),
    base: z.string().meta({ label: 'Base url', help: 'where the spec says nothing' }).optional(),
    headers: z.record(z.string(), z.string()).meta({ label: 'Static headers', help: 'non-secret headers required by this API, such as User-Agent' }).optional(),
    module: z.string().meta({ label: 'Module', help: 'for a tool this site ships as code instead' }).optional(),
    auth: z.record(z.string(), z.any()).meta({ label: 'Authorisation', help: 'header, env (the variable a secret is in) and prefix — never the secret itself' }).optional(),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    for: audience,
  }),
}

export const commands = {
  grammar: agentGrammar,
  key: 'commands', name: 'Commands', dir: 'content/commands', title: 'name', module: 'bots',
  body: true, bodyLabel: 'What it asks the bot ({name} fills in an argument)', creates: true,
  fields: z.object({
    name: z.string().min(1).meta({ label: 'Name', grid: true, help: 'what people type after the slash: letters, digits and hyphens' }),
    hint: z.string().meta({ label: 'One line', grid: true, help: 'shown beside it in the picker' }).optional(),
    bot: z.string().meta({ label: 'Asks', grid: true, widget: 'select', options: 'bots' }).optional(),
    run: z.string().meta({ label: 'Or runs the tool', widget: 'select', options: 'tools', help: 'a command either asks a bot or runs a tool' }).optional(),
    surfaces: z.array(z.enum(['spaces', 'support', 'coaching'])).meta({ label: 'Where', widget: 'multiselect', choices: [{ value: 'spaces', label: 'Rooms' }, { value: 'support', label: 'The support desk' }, { value: 'coaching', label: 'A coaching thread' }] }).optional(),
    for: audience,
    args: z.array(z.object({
      name: z.string().meta({ label: 'Name' }),
      kind: z.enum(['text', 'number', 'span', 'choice', 'person', 'channel', 'boolean']).meta({ label: 'Kind', widget: 'select' }),
      label: z.string().meta({ label: 'Label' }).optional(),
      default: z.string().meta({ label: 'Default' }).optional(),
      choices: z.array(z.string()).meta({ label: 'Choices', help: 'for a choice' }).optional(),
    })).meta({ label: 'Arguments', help: 'each is drawn as a control, never typed as a syntax' }).optional(),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
  }),
}

/* the same for the bots: a save on a checkout pushes, a save over rows is a draft */
async function onBotWrite(ctx) {
  if (ctx.store && ctx.store.kind === 'rows') return
  await ctx.script('bots-push.mjs').catch((e) => console.warn('bots: not projected — ' + e.message))
}

/* the bots' declaration, made real — the surface's half of it, which needs a database and not a
   disk, so it runs in the Edge Function on a publish rather than waiting for a deploy a cloud-only
   deployment never has. The theme's default skills come in as data (themeSkills), since there is no
   package directory to read them from there. */
async function projectedBots(ctx) {
  const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
  if (!db) return
  const { compileBots } = await import('../../bots.mjs')
  const { projectBots } = await import('../../bots-db.mjs')
  const { bots } = await compileBots({ store: ctx.store, write: false, themeSkills: ctx.themeSkills || null })
  await projectBots({ bots, db })
}

/* over a checkout a write IS the file, so the script runs then; over rows a write is a draft and
   nothing is projected until it is published — see `projected` below */
async function onEventWrite(ctx) {
  if (ctx.store && ctx.store.kind === 'rows') return
  await ctx.script('events-push.mjs').catch((e) => console.warn('events: not projected — ' + e.message))
}

export const events = {
  key: 'events', name: 'Events', dir: 'content/events', title: 'title', module: 'events',
  body: true, bodyLabel: 'What it is', creates: true,
  assets: { dir: 'content/uploads/events' },
  fields: z.object({
    title: z.string().min(1).meta({ label: 'Title', grid: true }),
    sub: z.string().meta({ label: 'One line', grid: true }).optional(),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    space: z.string().meta({ label: 'Space', grid: true, help: 'the community it belongs to, by slug' }).optional(),
    channel: z.string().meta({ label: 'Channel', help: 'where it is announced, by slug' }).optional(),
    for: audience,
    host: z.string().meta({ label: 'Host' }).optional(),
    where: z.string().meta({ label: 'Where it happens', help: 'room · a link · a place' }).optional(),
    starts: z.string().meta({ label: 'Starts', help: 'a one-off: a date and time' }).optional(),
    repeats: z.record(z.string(), z.any()).meta({ label: 'Repeats', help: 'every · on · at · zone · lasts · interval · until · count · except' }).optional(),
    rsvp: z.boolean().meta({ label: 'Takes an RSVP' }).optional(),
    capacity: z.number().int().meta({ label: 'Places', help: '0 is no limit' }).optional(),
    order: z.number().int().meta({ label: 'Order' }).optional(),
  }),
  /*
   * THE PROJECTION RUNS WHEREVER IT CAN, and that is not only on a machine.
   *
   * On a checkout the script does it — the compile refuses a malformed declaration and the push
   * writes the calendar. Over rows there is no machine: ctx.script() answers "the deploy runs it",
   * and a deployment with git out of the cycle and no deploy hook never has one, so an event saved
   * there would never become an event. The writes are a handful of upserts and an expansion of each
   * repeat, which need a database and not a disk, and the store is holding one.
   *
   * A SAVE OVER ROWS IS A DRAFT and must move nothing: readers have not been shown it. The act is
   * the publish, which is what calls `projected`.
   */
  after: async (rec, ctx) => { await onEventWrite(ctx) },
  afterRemove: async (name, ctx) => { await onEventWrite(ctx) },
  projected: async (ctx) => {
    const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
    if (!db) return
    const { compileEvents } = await import('../../events.mjs')
    const { projectEvents } = await import('../../events-db.mjs')
    const { events, rows } = await compileEvents({ store: ctx.store, write: false })
    await projectEvents({ events, rows, db })
  },
}

export const AGENT_MODELS = [bots, skills, tools, commands, events]
