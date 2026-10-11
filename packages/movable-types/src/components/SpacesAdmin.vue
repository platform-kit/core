<script setup>
/*
 * Spaces, from the admin. Four views over one space at a time, and they are two different KINDS of
 * thing, which is the whole shape of this screen:
 *
 *   Rooms  — the DECLARATION. What rooms this site has, who is let into them, what roles it invents
 *            and what those roles may do is part of what the site IS, so it is a file
 *            (content/spaces/<slug>.md and content/spaces/<slug>/<channel>.md) and it goes through
 *            the content pipe like every other file: a save in cloud mode is a draft until it is
 *            published, and publishing pushes it to the repository. Nothing here writes a table.
 *   Members, Moderation, Voice — the ACTS. Who joined, who holds which role, what somebody said and
 *            who was handed a capability by hand name a PERSON, so they are rows, and they are
 *            written the way they always were (an administrator's policies, and two definer
 *            functions for a hand grant, because the grants table takes no write from a browser).
 *
 * The editor never shows the file's own shape: a fill rule is a select, a role is a row with a
 * colour and a rank, a grant is a capability and a target chosen from lists, what a room hears is a
 * set of switches. Two things it deliberately cannot do: read or moderate a direct message (two
 * people writing to each other are not moderated, they are spied on, and the policy refuses it
 * outright), and hand anybody a capability by any route but a grant, which is a row anyone can read
 * off the page.
 *
 * Words from spaces.md (## admin).
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { session } from '@platform-kit/kit/lib/auth.js'
import { encryptedOf } from '@platform-kit/kit/lib/spaces/model.js'
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { products, sessions } from '#content'
import pipe from '../lib/admin/api.js'
import SpaceAvatar from './spaces/SpaceAvatar.vue'
import SpaceIcon from './spaces/SpaceIcon.vue'
import AdminHead from './admin/AdminHead.vue'

const W = computed(() => us('spaces').admin.main)
const NW = computed(() => us('spaces').notify.main)
const me = computed(() => (session.value && session.value.user && session.value.user.id) || '')

const VIEWS = ['rooms', 'members', 'moderation', 'voice']
const view = ref('rooms')
const KINDS = ['staff', 'community', 'server']
/* a feed only where the network module is on: the build refuses one otherwise */
const MODES = ['stream', 'forum', ...(moduleOn('network') ? ['feed'] : [])]
const VISIBILITIES = ['open', 'private']
const CAPABILITIES = ['voice', 'file', 'mention-channel', 'moderate', 'invite', 'announce']
const EVENTS = ['purchase.paid', 'subscription.started', 'print.failed', 'account.new', 'support.escalated']

/* the declaration, through the pipe */
const files = ref([])          /* every record of the spaces model: a space, or <space>/<channel> */
const doc = ref(null)          /* the open space's own file, as the editor holds it */
const rooms = ref([])          /* its channels, each { name, data, content } */
/* the state, from the database */
const rows = ref([])           /* public.spaces, so the acts have an id to hang off */
const dbChannels = ref([])
const members = ref([])
const held = ref({})           /* user id → the role ids they hold here */
const dbRoles = ref([])        /* the projected roles, for their ids */
const people = ref({})
const said = ref([])
const grants = ref([])

const slug = ref('')
const busy = ref(false)
const err = ref('')
const note = ref('')
const dirty = ref(false)

const spaces = computed(() => files.value.filter((f) => f.kind === 'space'))
const space = computed(() => (doc.value ? doc.value.data : null))
/* the words a sealed room is marked with, and the ONE reading of whether a room is one: the
   channel's own answer where it gives one, the space's otherwise — the same `encryptedOf` the
   build and the Matrix surface ask, so the admin cannot show a different answer from the room */
const EN = computed(() => us('spaces').encryption)
const sealed = (c) => encryptedOf((c && c.data) || {}, space.value || {})
const row = computed(() => rows.value.find((r) => r.slug === slug.value) || null)
const tiers = computed(() => [...new Set(products.filter((p) => p.kind === 'membership' && p.tier).map((p) => p.tier))])
const offers = computed(() => products.filter((p) => p.sku).map((p) => ({ sku: p.sku, key: p.key, title: p.title || p.sku })))
/* the booking types a room's rule may hang a window on — the only way in that looks FORWARD */
const bookables = computed(() => (sessions || []).filter((s) => s.published !== false).map((s) => ({ slug: s.slug, title: s.title || s.slug })))

const say = (m) => { note.value = m; setTimeout(() => { if (note.value === m) note.value = '' }, 2600) }
async function run(fn, done) {
  busy.value = true; err.value = ''
  try { await fn(); if (done) say(done) } catch (e) { err.value = e.message || String(e) } finally { busy.value = false }
}

/* ------------------------------------------------------------------ reading */

async function loadFiles() {
  files.value = await pipe.items('spaces')
  if (!slug.value && spaces.value.length) slug.value = spaces.value[0].name
}
async function openSpace(name) {
  if (!name) { doc.value = null; rooms.value = []; return }
  doc.value = await pipe.read('spaces', name)
  const mine = files.value.filter((f) => f.kind === 'channel' && f.space === name)
  rooms.value = await Promise.all(mine.map((f) => pipe.read('spaces', f.name)))
  rooms.value.sort((a, b) => ((a.data.order ?? 99) - (b.data.order ?? 99)) || a.name.localeCompare(b.name))
  dirty.value = false
}
async function loadRows() {
  const [s, c] = await Promise.all([
    supabase.from('spaces').select('*').order('name'),
    supabase.from('channels').select('*').order('name'),
  ])
  rows.value = s.data || []
  dbChannels.value = c.data || []
}
async function loadMembers() {
  if (!row.value) { members.value = []; dbRoles.value = []; held.value = {}; return }
  const [m, r, h] = await Promise.all([
    supabase.from('space_members').select('*').eq('space_id', row.value.id),
    supabase.from('space_roles').select('*').eq('space_id', row.value.id).order('rank', { ascending: false }),
    supabase.from('space_member_roles').select('user_id, role_id').eq('space_id', row.value.id),
  ])
  members.value = m.data || []
  dbRoles.value = r.data || []
  const by = {}
  for (const x of h.data || []) (by[x.user_id] = by[x.user_id] || []).push(x.role_id)
  held.value = by
  await namesFor(members.value.map((m2) => m2.user_id))
}
async function loadSaid() {
  const ids = dbChannels.value.filter((c) => c.kind !== 'dm' && (!row.value || c.space_id === row.value.id)).map((c) => c.id)
  if (!ids.length) { said.value = []; return }
  const { data } = await supabase.from('space_messages').select('id, channel_id, author_id, kind, body, title, created_at, deleted_at')
    .in('channel_id', ids).order('created_at', { ascending: false }).limit(60)
  said.value = data || []
  await namesFor(said.value.map((m) => m.author_id))
}
async function loadGrants() {
  const { data } = await supabase.from('space_grants').select('*').order('created_at', { ascending: false })
  grants.value = data || []
  await namesFor(grants.value.map((g) => g.user_id))
}
/* a name for every id on screen, asked once each — profiles are self-select, so this is the door */
async function namesFor(ids) {
  const want = [...new Set(ids.filter((i) => i && !people.value[i]))]
  if (!want.length) return
  for (const id of want) people.value[id] = { name: '…', email: '' }
  const { data } = await supabase.rpc('space_people_named', { p_ids: want })
  for (const r of data || []) people.value[r.id] = { name: r.name, email: r.email }
  for (const id of want) if (people.value[id].name === '…') people.value[id] = { name: W.value.someone, email: '' }
}
const nameOf = (id) => (people.value[id] || {}).name || W.value.someone

async function loadAll() {
  await Promise.all([loadFiles(), loadRows(), loadGrants()])
  await openSpace(slug.value)
  await Promise.all([loadMembers(), loadSaid()])
}
onMounted(() => run(loadAll))
watch(slug, async (s) => { await run(async () => { await openSpace(s); await Promise.all([loadMembers(), loadSaid()]) }) })

/* ------------------------------------------------------------------ the declaration */

const slugged = (v) => String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const touch = () => { dirty.value = true }

/* the ways a space fills itself, said in words rather than as the rule's own shape */
const FILLS = computed(() => [
  /* the staff is anybody holding any role at all, so the preset names every one of them */
  { key: 'role:staff', word: W.value['fill-staff'], rule: { role: ['admin', 'provider', 'editor', 'support', 'analyst'] } },
  { key: 'role:any', word: W.value['fill-everyone'], rule: { role: ['user', 'admin', 'support'] } },
  /* any live membership, whatever tier — the commonest way a community is filled, and it had no
     word of its own, so a space using it read as 'a rule of its own' */
  { key: 'entitlement:subscribed', word: W.value['fill-subscribed'], rule: { entitlement: 'subscribed' } },
  ...tiers.value.map((t) => ({ key: 'tier:' + t, word: (W.value['fill-tier'] || '').replace('{tier}', t), rule: { tier: t } })),
  ...offers.value.map((o) => ({ key: 'bought:' + o.sku, word: (W.value['fill-bought'] || '').replace('{name}', o.title), rule: { bought: o.sku } })),
  { key: 'none', word: W.value['fill-invite'], rule: {} },
])
const sameRule = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})
/* ALTERNATIVES, AS ROWS. A space may be filled more than one way — a live membership, OR anyone on
   staff — so this is a list of the same worded rules it always offered, and any one of them is
   enough. One row writes a mapping, exactly what every space had before this existed. */
const fillRows = computed(() => {
  const f = space.value && space.value.fill
  const sets = Array.isArray(f) ? f : f && Object.keys(f).length ? [f] : []
  return sets.length ? sets : [{}]
})
const keyOfRule = (rule) => (FILLS.value.find((f) => sameRule(f.rule, rule)) || { key: 'custom' }).key
function writeFill(sets) {
  const kept = sets.filter((s) => s && Object.keys(s).length)
  space.value.fill = kept.length > 1 ? kept : kept[0] || {}
  touch()
}
function setFillAt(i, key) {
  const f = FILLS.value.find((x) => x.key === key)
  if (!f || !space.value) return
  const sets = fillRows.value.map((s) => ({ ...s }))
  sets[i] = { ...f.rule }
  writeFill(sets)
}
/* a new row takes the first way in this space does not already have: two alternatives saying the
   same thing are refused by the compile, so offering one as the default is offering a save that
   will fail */
function addFill() {
  const had = fillRows.value.map((s) => keyOfRule(s))
  const next = FILLS.value.find((f) => f.key !== 'none' && Object.keys(f.rule).length && !had.includes(f.key))
  writeFill([...fillRows.value.map((s) => ({ ...s })), { ...(next ? next.rule : {}) }])
}
const dropFill = (i) => writeFill(fillRows.value.filter((_, j) => j !== i).map((s) => ({ ...s })))

/* ------------------------------------------------------------------ a room's own rule */

/* WHO IS IN THIS ROOM, in the same worded ways a space offers — plus the bookings, which only a
   room ever wants: "anybody with a call in the next week" is a room, not a community. A room's rule
   is narrower than its space's and never wider, so nothing here can let anybody into the space. */
const ROOM_FILLS = computed(() => [
  { key: 'none', word: W.value['room-fill-none'], rule: {} },
  ...FILLS.value.filter((f) => f.key !== 'none'),
  ...bookables.value.map((b) => ({ key: 'booking:' + b.slug, word: (W.value['fill-booking'] || '').replace('{name}', b.title || b.slug), rule: { booking: b.slug } })),
])
/* WHICH WAYS IN CAN CARRY A WINDOW, and which way it may face. A tier, a role and an entitlement
   expire by themselves, so a window on one would be a second clock disagreeing with the first; and
   a purchase has no future, so only a booking may look forward. */
const canWindow = (rule) => !!(rule && (rule.bought || rule.booking))
const canLookForward = (rule) => !!(rule && rule.booking)

/* a span as the file writes it (`7d`) ↔ the two controls a person is given */
const UNITS = ['m', 'h', 'd', 'w']
const spanParts = (v) => { const m = /^(\d+)\s*([mhdw])$/.exec(String(v || '')); return m ? { n: Number(m[1]), unit: m[2] } : { n: 7, unit: 'd' } }
const spanOf = (n, unit) => Math.max(1, Math.round(Number(n) || 1)) + (UNITS.includes(unit) ? unit : 'd')

const keyOfRoomRule = (rule) => {
  /* a window is a qualifier and not a way in, so it is not part of what the select is showing */
  const bare = { ...(rule || {}) }
  delete bare.withinLast; delete bare.withinNext
  return (ROOM_FILLS.value.find((f) => sameRule(f.rule, bare)) || { key: 'custom' }).key
}
const roomRows = (c) => {
  const f = c.data && c.data.fill
  const sets = Array.isArray(f) ? f : f && Object.keys(f).length ? [f] : []
  return sets.length ? sets : [{}]
}
function writeRoomFill(c, sets) {
  const kept = sets.filter((s) => s && Object.keys(s).length)
  c.data.fill = kept.length > 1 ? kept : kept[0] || {}
  touch()
}
function setRoomFillAt(c, i, key) {
  const f = ROOM_FILLS.value.find((x) => x.key === key)
  if (!f) return
  const sets = roomRows(c).map((s) => ({ ...s }))
  sets[i] = { ...f.rule }
  writeRoomFill(c, sets)
}
/* the window, as three controls: whether there is one, which way it faces, and how long. Turning it
   on picks the direction the way in can actually face — forward for a booking, back for a purchase. */
function setRoomWindow(c, i, { on, dir, n, unit }) {
  const sets = roomRows(c).map((s) => ({ ...s }))
  const set = sets[i] || {}
  const had = set.withinLast || set.withinNext
  const parts = spanParts(had)
  delete set.withinLast; delete set.withinNext
  if (on === false) { sets[i] = set; writeRoomFill(c, sets); return }
  const way = dir || (set.withinNext ? 'withinNext' : had ? 'withinLast' : (canLookForward(set) ? 'withinNext' : 'withinLast'))
  const key = way === 'withinNext' && canLookForward(set) ? 'withinNext' : 'withinLast'
  set[key] = spanOf(n == null ? parts.n : n, unit == null ? parts.unit : unit)
  sets[i] = set
  writeRoomFill(c, sets)
}
const roomWindow = (set) => {
  const dir = set.withinNext ? 'withinNext' : set.withinLast ? 'withinLast' : ''
  return dir ? { dir, ...spanParts(set[dir]) } : null
}
function addRoomFill(c) { writeRoomFill(c, [...roomRows(c).map((s) => ({ ...s })), { ...((ROOM_FILLS.value[1] || {}).rule || {}) }]) }
const dropRoomFill = (c, i) => writeRoomFill(c, roomRows(c).filter((_, j) => j !== i).map((s) => ({ ...s })))

/* a role is a row with a colour, a rank and what holding it lets somebody do */
function addRole() {
  space.value.roles = [...(space.value.roles || []), { slug: '', name: '', colour: '', rank: 0, can: [] }]
  touch()
}
function dropRole(i) { space.value.roles = space.value.roles.filter((_, j) => j !== i); touch() }
function roleCan(r, cap, on) { r.can = on ? [...new Set([...(r.can || []), cap])] : (r.can || []).filter((c) => c !== cap); touch() }

/* a grant is a capability and a target, on the space or on one room */
const TARGETS = computed(() => [
  { value: 'everyone', label: W.value['to-everyone'] },
  ...(space.value ? (space.value.roles || []).filter((r) => r.slug).map((r) => ({ value: 'role:' + r.slug, label: (W.value['to-role'] || '').replace('{name}', r.name || r.slug) })) : []),
  ...tiers.value.map((t) => ({ value: 'tier:' + t, label: (W.value['to-tier'] || '').replace('{tier}', t) })),
  ...offers.value.map((o) => ({ value: 'bought:' + o.sku, label: (W.value['to-bought'] || '').replace('{name}', o.title) })),
])
function addGrantTo(holder) { holder.grants = [...(holder.grants || []), { capability: 'voice', to: 'everyone' }]; touch() }
function dropGrantFrom(holder, i) { holder.grants = holder.grants.filter((_, j) => j !== i); touch() }
const isBought = (g) => /^bought:/.test(String(g.to || ''))

/* a room hears what its own file says it hears */
function hears(c, e, on) { c.data.hears = on ? [...new Set([...(c.data.hears || []), e])] : (c.data.hears || []).filter((x) => x !== e); touch() }

async function saveAll() {
  await run(async () => {
    await pipe.save('spaces', doc.value.name, { data: space.value, content: doc.value.content })
    for (const c of rooms.value) await pipe.save('spaces', c.name, { data: c.data, content: c.content })
    await loadAll()
  }, W.value.saved)
}

const newSpace = ref({ open: false, name: '', kind: 'community', fill: 'role:staff' })
async function makeSpace() {
  const name = newSpace.value.name.trim()
  if (!name) return
  const s = slugged(name)
  const fill = (FILLS.value.find((f) => f.key === newSpace.value.fill) || FILLS.value[0]).rule
  await run(async () => {
    /* the usual three roles, so a new space has somebody in charge and somebody merely in it —
       written INTO the file, where they can be renamed, recoloured or taken out */
    await pipe.save('spaces', s, {
      data: {
        name, kind: newSpace.value.kind, published: true, fill: { ...fill },
        roles: [
          { slug: 'member', name: 'Member', rank: 0 },
          { slug: 'moderator', name: 'Moderator', colour: '#3d7369', rank: 50, can: ['mention-channel'] },
          { slug: 'owner', name: 'Owner', colour: '#86613c', rank: 100, can: ['mention-channel', 'voice'] },
        ],
        grants: [],
      },
      content: '',
    }, { create: true })
    await pipe.save('spaces', s + '/general', { data: { name: 'General', topic: '', mode: 'stream', visibility: 'open', published: true, order: 1, hears: [], grants: [] }, content: '' }, { create: true })
    newSpace.value = { open: false, name: '', kind: 'community', fill: 'role:staff' }
    await loadFiles()
    slug.value = s
  }, W.value['space-made'])
}
async function dropSpace() {
  if (!window.confirm((W.value['space-drop-sure'] || '').replace('{name}', space.value.name))) return
  await run(async () => {
    for (const c of rooms.value) await pipe.remove('spaces', c.name)
    await pipe.remove('spaces', doc.value.name)
    slug.value = ''
    await loadAll()
  }, W.value['space-dropped'])
}

const newRoom = ref({ open: false, name: '', mode: 'stream', visibility: 'open', topic: '' })
async function makeRoom() {
  const name = newRoom.value.name.trim()
  if (!name || !doc.value) return
  await run(async () => {
    await pipe.save('spaces', `${doc.value.name}/${slugged(name)}`, {
      data: {
        name, topic: newRoom.value.topic.trim(), mode: newRoom.value.mode, visibility: newRoom.value.visibility,
        published: true, order: rooms.value.length + 1, hears: [], grants: [],
      },
      content: '',
    }, { create: true })
    newRoom.value = { open: false, name: '', mode: 'stream', visibility: 'open', topic: '' }
    await loadFiles()
    await openSpace(slug.value)
  }, W.value['room-made'])
}
async function dropRoom(c) {
  if (!window.confirm((W.value['room-drop-sure'] || '').replace('{name}', c.data.name))) return
  await run(async () => { await pipe.remove('spaces', c.name); await loadFiles(); await openSpace(slug.value) }, W.value['room-dropped'])
}

/* ------------------------------------------------------------------ the members */

const finding = ref('')
const found = ref([])
let findTimer = null
watch(finding, (q) => {
  clearTimeout(findTimer)
  if (q.trim().length < 2) { found.value = []; return }
  findTimer = setTimeout(async () => {
    const { data } = await supabase.rpc('space_find_people', { q: q.trim(), lim: 12 })
    const have = new Set(members.value.map((m) => m.user_id))
    found.value = (data || []).filter((p) => !have.has(p.id))
  }, 250)
})
async function addMember(p) {
  await run(async () => {
    const { error } = await supabase.from('space_members').insert({ space_id: row.value.id, user_id: p.id, source: 'invite' })
    if (error) throw error
    /* an open channel of the space is theirs to be in from the start */
    const open = dbChannels.value.filter((c) => c.space_id === row.value.id && c.kind !== 'dm' && c.visibility === 'open')
    if (open.length) await supabase.from('channel_members').insert(open.map((c) => ({ channel_id: c.id, user_id: p.id })))
    finding.value = ''
    found.value = []
    await loadMembers()
  }, W.value['member-added'])
}
/* A role is given or taken away one at a time, because a person holds several. The names are the
   space's own — there is no list of them in this file — and 'member' is what being in the space
   means, so it is given with the membership and never taken off. */
const givable = computed(() => dbRoles.value.filter((r) => r.slug !== 'member'))
const holds = (m, role) => (held.value[m.user_id] || []).includes(role.id)
async function toggleRole(m, role) {
  if (role.slug === 'member') return
  await run(async () => {
    const q = holds(m, role)
      ? supabase.from('space_member_roles').delete().eq('space_id', m.space_id).eq('user_id', m.user_id).eq('role_id', role.id)
      : supabase.from('space_member_roles').insert({ space_id: m.space_id, user_id: m.user_id, role_id: role.id, given_by: me.value })
    const { error } = await q
    if (error) throw error
    await loadMembers()
  })
}
async function removeMember(m) {
  await run(async () => {
    const ids = dbChannels.value.filter((c) => c.space_id === m.space_id).map((c) => c.id)
    if (ids.length) await supabase.from('channel_members').delete().eq('user_id', m.user_id).in('channel_id', ids)
    const { error } = await supabase.from('space_members').delete().eq('space_id', m.space_id).eq('user_id', m.user_id)
    if (error) throw error
    await loadMembers()
  }, W.value['member-removed'])
}

/* ------------------------------------------------------------------ moderation */

async function withdraw(m) {
  if (!window.confirm(W.value['withdraw-sure'])) return
  await run(async () => {
    const { error } = await supabase.from('space_messages').update({ deleted_at: new Date().toISOString() }).eq('id', m.id)
    if (error) throw error
    await loadSaid()
  }, W.value.withdrawn)
}
const roomName = (id) => (dbChannels.value.find((c) => c.id === id) || {}).name || ''

/* ------------------------------------------------------------------ voice */

/* What a site SELLS or gives by standing is declared (the space's or the room's file) and shows here
   read-only, with the file that gives it. What is left is the one-off: a capability given to ONE
   PERSON, which names somebody and is therefore an act — written through space_grant_person, which
   marks it 'hand' so the projection never touches it. */
const declaredGrants = computed(() => grants.value.filter((g) => g.source === 'file'))
const handGrants = computed(() => grants.value.filter((g) => g.source !== 'file'))
const newGrant = ref({ capability: 'voice', user_id: '', space_id: '', channel_id: '', days: '', note: '' })
const grantFinding = ref('')
const grantFound = ref([])
let grantTimer = null
watch(grantFinding, (q) => {
  clearTimeout(grantTimer)
  if (q.trim().length < 2) { grantFound.value = []; return }
  grantTimer = setTimeout(async () => {
    const { data } = await supabase.rpc('space_find_people', { q: q.trim(), lim: 12 })
    grantFound.value = data || []
  }, 250)
})
async function addGrant() {
  const g = newGrant.value
  await run(async () => {
    const { error } = await supabase.rpc('space_grant_person', {
      p_user: g.user_id, p_capability: g.capability,
      p_space: g.space_id || null, p_channel: g.channel_id || null,
      p_days: g.days ? Number(g.days) : null, p_note: g.note.trim() || null,
    })
    if (error) throw error
    newGrant.value = { capability: 'voice', user_id: '', space_id: '', channel_id: '', days: '', note: '' }
    grantFinding.value = ''
    grantFound.value = []
    await loadGrants()
  }, W.value['grant-added'])
}
async function dropGrant(g) {
  await run(async () => { const { error } = await supabase.rpc('space_ungrant', { p_id: g.id }); if (error) throw error; await loadGrants() }, W.value['grant-dropped'])
}
/* a grant said back in words, because a row of ids tells nobody anything */
function grantSays(g) {
  const w = W.value
  const cap = w['cap-' + g.capability] || g.capability
  const where = g.channel_id ? (w['says-channel'] || '').replace('{name}', roomName(g.channel_id) || '—')
    : g.space_id ? (w['says-space'] || '').replace('{name}', (rows.value.find((s) => s.id === g.space_id) || {}).name || '—')
      : w['says-site']
  const who = g.scope === 'user' ? (w['says-user'] || '').replace('{name}', nameOf(g.user_id))
    : g.scope === 'tier' ? (w['says-tier'] || '').replace('{tier}', g.tier)
      : g.scope === 'role' ? (w['says-role'] || '').replace('{name}', (dbRoles.value.find((r) => r.id === g.role_id) || {}).name || '—')
        : g.scope === 'product' ? (g.days
          ? (w['says-product-days'] || '').replace('{name}', (offers.value.find((o) => o.key === g.product_key) || {}).title || g.product_key).replace('{n}', g.days)
          : (w['says-product'] || '').replace('{name}', (offers.value.find((o) => o.key === g.product_key) || {}).title || g.product_key))
          : w['says-anyone']
  return (w['says-line'] || '{cap} · {who} · {where}').replace('{cap}', cap).replace('{who}', who).replace('{where}', where)
}
</script>

<template>
  <div class="ui-page sa">
    <AdminHead :title="W.title" :sub="W.line">
      <template #actions>
        <nav class="sa-seg">
          <button v-for="v in VIEWS" :key="v" type="button" :class="{ on: view === v }" @click="view = v">{{ W['view-' + v] }}</button>
        </nav>
      </template>
    </AdminHead>

    <p v-if="err" class="sa-err">{{ err }}</p>
    <p v-if="note" class="sa-note">{{ note }}</p>

    <div class="sa-body">
      <aside class="sa-side">
        <h2>{{ W.spaces }}</h2>
        <ul>
          <li v-for="s in spaces" :key="s.name">
            <button type="button" :class="{ on: s.name === slug, off: s.data.published === false }" @click="slug = s.name">
              <b>{{ s.data.name || s.name }}</b>
              <i>{{ files.filter((f) => f.kind === 'channel' && f.space === s.name).length }}</i>
            </button>
          </li>
          <li v-if="!spaces.length" class="sa-none">{{ W['no-spaces'] }}</li>
        </ul>
        <button type="button" class="sa-add" @click="newSpace.open = !newSpace.open">
          <SpaceIcon name="plus" :size="13" />{{ W['new-space'] }}
        </button>
        <form v-if="newSpace.open" class="sa-new" @submit.prevent="makeSpace">
          <label>{{ W['space-name'] }}<input v-model="newSpace.name" type="text" /></label>
          <label>{{ W['space-kind'] }}
            <select v-model="newSpace.kind">
              <option v-for="k in KINDS" :key="k" :value="k">{{ W['kind-' + k] }}</option>
            </select>
          </label>
          <label>{{ W['space-fill'] }}
            <select v-model="newSpace.fill">
              <option v-for="f in FILLS" :key="f.key" :value="f.key">{{ f.word }}</option>
            </select>
          </label>
          <button type="submit" class="sa-go" :disabled="busy || !newSpace.name.trim()">{{ W.create }}</button>
        </form>
      </aside>

      <section class="sa-main">
        <p v-if="!space" class="sa-none">{{ W['pick-space'] }}</p>

        <!-- the rooms: the declaration, edited as its parts and saved as a file -->
        <template v-else-if="view === 'rooms'">
          <p class="sa-hint sa-said-file">{{ W['declared-hint'] }}</p>

          <div class="sa-card">
            <h3>{{ space.name || doc.name }}</h3>
            <div class="sa-fields">
              <label>{{ W['space-name'] }}<input v-model="space.name" type="text" @input="touch" /></label>
              <label>{{ W['space-kind'] }}
                <select v-model="space.kind" @change="touch"><option v-for="k in KINDS" :key="k" :value="k">{{ W['kind-' + k] }}</option></select>
              </label>
              <div class="sa-fill sa-wide">
                <span class="sa-fill-head">{{ fillRows.length > 1 ? W['space-fill-any'] : W['space-fill'] }}</span>
                <div v-for="(row, i) in fillRows" :key="i" class="sa-fill-row">
                  <select :value="keyOfRule(row)" @change="setFillAt(i, $event.target.value)">
                    <option v-for="f in FILLS" :key="f.key" :value="f.key">{{ f.word }}</option>
                    <option v-if="keyOfRule(row) === 'custom'" value="custom">{{ W['fill-custom'] }}</option>
                  </select>
                  <button
                    v-if="fillRows.length > 1" type="button" class="sa-x"
                    :aria-label="W['fill-drop']" :title="W['fill-drop']" @click="dropFill(i)">×</button>
                </div>
                <button type="button" class="sa-addfill" @click="addFill">+ {{ W['fill-add'] }}</button>
              </div>
              <!-- where the space sits in everybody's column: the heading it is gathered under and its
                   place among the others. Both the site's own arrangement, not a person's. -->
              <label>{{ W['space-group'] }}<input v-model="space.group" type="text" :placeholder="W['space-group-none']" @input="touch" /></label>
              <label>{{ W['space-position'] }}<input v-model.number="space.position" type="number" min="0" @input="touch" /></label>
              <label class="sa-switch">
                <input v-model="space.published" type="checkbox" @change="touch" /><span>{{ W.published }}</span>
              </label>
              <!-- WHETHER THIS SPACE HAS DIRECT MESSAGES AT ALL. The space's own decision and the
                   same for everybody in it, staff included. Whether one PERSON wants to be written
                   to is theirs and is set where their own things are, never here. -->
              <label class="sa-switch">
                <input :checked="space.dms !== false" type="checkbox" @change="space.dms = $event.target.checked; touch()" /><span>{{ W['dms-on'] }}</span>
              </label>
              <span class="sa-stat">{{ W.slug }}: <code>{{ doc.name }}</code></span>
            </div>
            <label class="sa-wide">{{ W.about }}<textarea v-model="doc.content" rows="3" @input="touch"></textarea></label>
            <div class="sa-acts">
              <button type="button" class="sa-danger" @click="dropSpace">{{ W.delete }}</button>
            </div>
          </div>

          <div class="sa-card">
            <h3>{{ W.roles }}</h3>
            <p class="sa-hint">{{ W['roles-hint'] }}</p>
            <ul class="sa-list">
              <li v-for="(r, i) in space.roles" :key="i" class="sa-role-row">
                <input v-model="r.name" type="text" class="sa-r-name" :placeholder="W['role-name']" @input="touch" />
                <input v-model="r.slug" type="text" class="sa-r-slug" :placeholder="W['role-slug']" @input="touch" />
                <input v-model="r.colour" type="color" class="sa-r-colour" :title="W['role-colour']" @input="touch" />
                <input v-model.number="r.rank" type="number" class="sa-r-rank" :title="W['role-rank']" @input="touch" />
                <span class="sa-roles">
                  <button
                    v-for="cap in CAPABILITIES" :key="cap" type="button" class="sa-role"
                    :class="{ 'is-on': (r.can || []).includes(cap) }" :aria-pressed="(r.can || []).includes(cap)"
                    @click="roleCan(r, cap, !(r.can || []).includes(cap))">{{ W['cap-' + cap] }}</button>
                </span>
                <button type="button" class="sa-danger sa-drop" @click="dropRole(i)">{{ W.remove }}</button>
              </li>
              <li v-if="!space.roles.length" class="sa-none">{{ W['no-roles'] }}</li>
            </ul>
            <button type="button" class="sa-add" @click="addRole"><SpaceIcon name="plus" :size="13" />{{ W['new-role'] }}</button>
          </div>

          <div class="sa-card">
            <h3>{{ W['space-grants'] }}</h3>
            <p class="sa-hint">{{ W['space-grants-hint'] }}</p>
            <ul class="sa-list">
              <li v-for="(g, i) in space.grants" :key="i" class="sa-grant-row">
                <select v-model="g.capability" @change="touch"><option v-for="c in CAPABILITIES" :key="c" :value="c">{{ W['cap-' + c] }}</option></select>
                <select v-model="g.to" @change="touch"><option v-for="t in TARGETS" :key="t.value" :value="t.value">{{ t.label }}</option></select>
                <label v-if="isBought(g)" class="sa-inline-field">{{ W['grant-days'] }}
                  <input v-model.number="g.days" type="number" min="1" :placeholder="W['grant-forever']" @input="touch" />
                </label>
                <button type="button" class="sa-danger sa-drop" @click="dropGrantFrom(space, i)">{{ W.remove }}</button>
              </li>
              <li v-if="!space.grants.length" class="sa-none">{{ W['no-grants'] }}</li>
            </ul>
            <button type="button" class="sa-add" @click="addGrantTo(space)"><SpaceIcon name="plus" :size="13" />{{ W['new-grant'] }}</button>
          </div>

          <div class="sa-card" v-for="c in rooms" :key="c.name">
            <h3>
              #{{ c.data.name || c.name }}
              <!-- SHOWN, NEVER SET HERE. The seal is one-way once the room has used it — the
                   database refuses to take it off — so a switch in a form would be a control that
                   silently stops working. It is `encrypted:` in the channel's own file, or in the
                   space's to seal every room under it, and this says which rooms are. -->
              <span v-if="sealed(c)" class="sa-sealed" role="img" :title="EN.room.sealed" :aria-label="EN.room.sealed">
                <SpaceIcon name="shield" :size="13" />
              </span>
            </h3>
            <div class="sa-fields">
              <label>{{ W['room-name'] }}<input v-model="c.data.name" type="text" @input="touch" /></label>
              <label>{{ W.topic }}<input v-model="c.data.topic" type="text" :placeholder="W['topic-none']" @input="touch" /></label>
              <label>{{ W.mode }}
                <select v-model="c.data.mode" @change="touch"><option v-for="m in MODES" :key="m" :value="m">{{ W['mode-' + m] }}</option></select>
              </label>
              <label>{{ W.visibility }}
                <select v-model="c.data.visibility" @change="touch"><option v-for="v in VISIBILITIES" :key="v" :value="v">{{ W['vis-' + v] }}</option></select>
              </label>
              <label>{{ W.order }}<input v-model.number="c.data.order" type="number" min="1" @input="touch" /></label>
              <label class="sa-switch"><input v-model="c.data.published" type="checkbox" @change="touch" /><span>{{ W.published }}</span></label>
            </div>
            <!-- WHO IS IN THIS ROOM. The same worded ways in the space offers, plus the bookings,
                 and a window said as a direction and a span rather than as `withinLast: 7d`. A room
                 saying nothing is open to the space, exactly as every room was before this. -->
            <div class="sa-sub">
              <b>{{ W['room-fill'] }}</b>
              <p class="sa-hint">{{ W['room-fill-hint'] }}</p>
              <ul class="sa-list">
                <li v-for="(set, i) in roomRows(c)" :key="i" class="sa-fill-row">
                  <select :value="keyOfRoomRule(set)" @change="setRoomFillAt(c, i, $event.target.value)">
                    <option v-for="f in ROOM_FILLS" :key="f.key" :value="f.key">{{ f.word }}</option>
                    <option v-if="keyOfRoomRule(set) === 'custom'" value="custom">{{ W['fill-custom'] }}</option>
                  </select>
                  <template v-if="canWindow(set)">
                    <label class="sa-switch sa-inline-field">
                      <input type="checkbox" :checked="!!roomWindow(set)" @change="setRoomWindow(c, i, { on: $event.target.checked })" />
                      <span>{{ W['room-window'] }}</span>
                    </label>
                    <template v-if="roomWindow(set)">
                      <select :value="roomWindow(set).dir" @change="setRoomWindow(c, i, { dir: $event.target.value })">
                        <option value="withinLast">{{ W['window-last'] }}</option>
                        <option v-if="canLookForward(set)" value="withinNext">{{ W['window-next'] }}</option>
                      </select>
                      <input class="sa-num" type="number" min="1" :value="roomWindow(set).n" @input="setRoomWindow(c, i, { n: $event.target.value })" />
                      <select :value="roomWindow(set).unit" @change="setRoomWindow(c, i, { unit: $event.target.value })">
                        <option v-for="u in UNITS" :key="u" :value="u">{{ W['unit-' + u] }}</option>
                      </select>
                    </template>
                  </template>
                  <button v-if="roomRows(c).length > 1 || Object.keys(set).length" type="button" class="sa-danger sa-drop" @click="dropRoomFill(c, i)">{{ W.remove }}</button>
                </li>
              </ul>
              <button type="button" class="sa-add" @click="addRoomFill(c)"><SpaceIcon name="plus" :size="13" />{{ W['room-fill-add'] }}</button>
            </div>
            <div class="sa-sub">
              <b>{{ NW['hooks-title'] }}</b>
              <span class="sa-roles">
                <button
                  v-for="e in EVENTS" :key="e" type="button" class="sa-role"
                  :class="{ 'is-on': (c.data.hears || []).includes(e) }" :aria-pressed="(c.data.hears || []).includes(e)"
                  @click="hears(c, e, !(c.data.hears || []).includes(e))">{{ NW['hook-' + e] }}</button>
              </span>
            </div>
            <div class="sa-sub">
              <b>{{ W['room-grants'] }}</b>
              <ul class="sa-list">
                <li v-for="(g, i) in c.data.grants" :key="i" class="sa-grant-row">
                  <select v-model="g.capability" @change="touch"><option v-for="cap in CAPABILITIES" :key="cap" :value="cap">{{ W['cap-' + cap] }}</option></select>
                  <select v-model="g.to" @change="touch"><option v-for="t in TARGETS" :key="t.value" :value="t.value">{{ t.label }}</option></select>
                  <label v-if="isBought(g)" class="sa-inline-field">{{ W['grant-days'] }}
                    <input v-model.number="g.days" type="number" min="1" :placeholder="W['grant-forever']" @input="touch" />
                  </label>
                  <button type="button" class="sa-danger sa-drop" @click="dropGrantFrom(c.data, i)">{{ W.remove }}</button>
                </li>
              </ul>
              <button type="button" class="sa-add" @click="addGrantTo(c.data)"><SpaceIcon name="plus" :size="13" />{{ W['new-grant'] }}</button>
            </div>
            <div class="sa-acts">
              <button type="button" class="sa-danger" @click="dropRoom(c)">{{ W.delete }}</button>
            </div>
          </div>

          <div class="sa-card">
            <button type="button" class="sa-add" @click="newRoom.open = !newRoom.open">
              <SpaceIcon name="plus" :size="13" />{{ W['new-room'] }}
            </button>
            <form v-if="newRoom.open" class="sa-new sa-row" @submit.prevent="makeRoom">
              <label>{{ W['room-name'] }}<input v-model="newRoom.name" type="text" /></label>
              <label>{{ W.topic }}<input v-model="newRoom.topic" type="text" /></label>
              <label>{{ W.mode }}
                <select v-model="newRoom.mode"><option v-for="m in MODES" :key="m" :value="m">{{ W['mode-' + m] }}</option></select>
              </label>
              <label>{{ W.visibility }}
                <select v-model="newRoom.visibility"><option v-for="v in VISIBILITIES" :key="v" :value="v">{{ W['vis-' + v] }}</option></select>
              </label>
              <button type="submit" class="sa-go" :disabled="busy || !newRoom.name.trim()">{{ W.create }}</button>
            </form>
          </div>

          <div class="sa-bar" :class="{ on: dirty }">
            <span>{{ dirty ? W['unsaved'] : W['all-saved'] }}</span>
            <button type="button" class="sa-go" :disabled="busy || !dirty" @click="saveAll">{{ W.save }}</button>
          </div>
        </template>

        <!-- who is in it -->
        <template v-else-if="view === 'members'">
          <div class="sa-card">
            <h3>{{ W.members }}</h3>
            <p class="sa-hint">{{ W['members-hint'] }}</p>
            <!-- a list and not a table: a person holds however many roles fit, and a row of chips
                 that must be able to wrap is not a thing a table column will do for you -->
            <ul class="sa-list">
              <li v-for="m in members" :key="m.user_id" class="sa-person">
                <span class="sa-who">
                  <SpaceAvatar :name="nameOf(m.user_id)" :size="26" />
                  <b>{{ nameOf(m.user_id) }}</b>
                  <span class="sa-pill">{{ m.source === 'fill' ? W['how-filled'] : W['how-invited'] }}</span>
                </span>
                <span class="sa-roles" :aria-label="W.role">
                  <button
                    v-for="r in givable" :key="r.id" type="button" class="sa-role"
                    :class="{ 'is-on': holds(m, r) }"
                    :style="holds(m, r) && r.colour ? { background: r.colour, borderColor: r.colour, color: '#fff' } : null"
                    :aria-pressed="holds(m, r)" @click="toggleRole(m, r)">{{ r.name }}</button>
                  <span v-if="!givable.length" class="sa-none">{{ W['no-roles'] }}</span>
                </span>
                <button type="button" class="sa-danger sa-drop" @click="removeMember(m)">{{ W.remove }}</button>
              </li>
              <li v-if="!members.length" class="sa-none">{{ W['no-members'] }}</li>
            </ul>
          </div>
          <div class="sa-card">
            <h3>{{ W['add-member'] }}</h3>
            <input v-model="finding" type="search" class="sa-find" :placeholder="W['find-person']" />
            <ul v-if="found.length" class="sa-found">
              <li v-for="p in found" :key="p.id">
                <button type="button" @click="addMember(p)">
                  <SpaceAvatar :name="p.name" :size="24" /><b>{{ p.name }}</b><i>{{ p.email }}</i>
                </button>
              </li>
            </ul>
            <p v-else-if="finding.trim().length >= 2" class="sa-none">{{ W['find-none'] }}</p>
          </div>
        </template>

        <!-- what was said -->
        <template v-else-if="view === 'moderation'">
          <div class="sa-card">
            <h3>{{ W.moderation }}</h3>
            <p class="sa-hint">{{ W['moderation-hint'] }}</p>
            <ul class="sa-said">
              <li v-for="m in said" :key="m.id" :class="{ gone: !!m.deleted_at }">
                <SpaceAvatar :name="nameOf(m.author_id)" :size="26" />
                <div>
                  <span class="sa-meta"><b>{{ m.kind === 'system' ? W.platform : nameOf(m.author_id) }}</b>
                    <i>#{{ roomName(m.channel_id) }}</i>
                    <u>{{ new Date(m.created_at).toLocaleString() }}</u></span>
                  <p v-if="m.deleted_at">{{ W.withdrawn }}</p>
                  <p v-else-if="m.kind === 'voice'">{{ W['a-voice'] }}</p>
                  <p v-else>{{ m.title ? m.title + ' — ' : '' }}{{ m.body }}</p>
                </div>
                <button v-if="!m.deleted_at && m.kind !== 'system'" type="button" class="sa-danger" @click="withdraw(m)">{{ W.withdraw }}</button>
              </li>
              <li v-if="!said.length" class="sa-none">{{ W['no-said'] }}</li>
            </ul>
          </div>
        </template>

        <!-- who may speak with a voice -->
        <template v-else>
          <div class="sa-card">
            <h3>{{ W['declared-grants'] }}</h3>
            <p class="sa-hint">{{ W['declared-grants-hint'] }}</p>
            <ul class="sa-grants">
              <li v-for="g in declaredGrants" :key="g.id">
                <SpaceIcon name="mic" :size="15" />
                <div><b>{{ grantSays(g) }}</b><i v-if="g.note">{{ g.note }}</i></div>
                <span class="sa-pill">{{ W['from-file'] }}</span>
              </li>
              <li v-if="!declaredGrants.length" class="sa-none">{{ W['no-declared-grants'] }}</li>
            </ul>
          </div>
          <div class="sa-card">
            <h3>{{ W.voice }}</h3>
            <p class="sa-hint">{{ W['voice-hint'] }}</p>
            <ul class="sa-grants">
              <li v-for="g in handGrants" :key="g.id">
                <SpaceIcon name="mic" :size="15" />
                <div><b>{{ grantSays(g) }}</b><i v-if="g.note">{{ g.note }}</i></div>
                <button type="button" class="sa-danger" @click="dropGrant(g)">{{ W.remove }}</button>
              </li>
              <li v-if="!handGrants.length" class="sa-none">{{ W['no-grants'] }}</li>
            </ul>
          </div>
          <div class="sa-card">
            <h3>{{ W['add-grant'] }}</h3>
            <form class="sa-new sa-row" @submit.prevent="addGrant">
              <label>{{ W.capability }}
                <select v-model="newGrant.capability"><option v-for="c in CAPABILITIES" :key="c" :value="c">{{ W['cap-' + c] }}</option></select>
              </label>
              <label>{{ W.space }}
                <select v-model="newGrant.space_id"><option value="">{{ W.anywhere }}</option><option v-for="s in rows" :key="s.id" :value="s.id">{{ s.name }}</option></select>
              </label>
              <label v-if="newGrant.space_id">{{ W.room }}
                <select v-model="newGrant.channel_id"><option value="">{{ W['whole-space'] }}</option>
                  <option v-for="c in dbChannels.filter((x) => x.kind !== 'dm' && x.space_id === newGrant.space_id)" :key="c.id" :value="c.id">{{ c.name }}</option></select>
              </label>
              <label>{{ W['grant-days'] }}<input v-model="newGrant.days" type="number" min="1" :placeholder="W['grant-forever']" /></label>
              <label class="sa-wide">{{ W.person }}
                <input v-model="grantFinding" type="search" :placeholder="W['find-person']" />
                <ul v-if="grantFound.length" class="sa-found sa-inline">
                  <li v-for="p in grantFound" :key="p.id">
                    <button type="button" :class="{ on: newGrant.user_id === p.id }" @click="newGrant.user_id = p.id; grantFinding = p.name">
                      <SpaceAvatar :name="p.name" :size="22" /><b>{{ p.name }}</b><i>{{ p.email }}</i>
                    </button>
                  </li>
                </ul>
              </label>
              <label class="sa-wide">{{ W['grant-note'] }}<input v-model="newGrant.note" type="text" /></label>
              <button type="submit" class="sa-go" :disabled="busy || !newGrant.user_id">{{ W.grant }}</button>
            </form>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
.sa { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); gap: 0; min-height: 0 }
.sa-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap;
  margin: 0; padding: 0 0 14px; border: 0 }
.sa-head h1 { margin: 0 0 3px; font-size: 22px; font-weight: 800; letter-spacing: -.015em; color: var(--ink) }
.sa-head p { margin: 0; max-width: 70ch; font-size: 13.5px; color: var(--ink3) }
.sa-seg { display: flex; gap: 2px; padding: 3px; background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 9px }
.sa-seg button { font: inherit; font-size: 13px; font-weight: 600; color: var(--ink2); background: transparent;
  border: 0; border-radius: 7px; padding: 5px 12px; cursor: pointer }
.sa-seg button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent) }
.sa-err { margin: 0 0 10px; max-width: none; font-size: 13px; color: #fff; background: #c8382f; border-radius: 8px; padding: 8px 11px }
.sa-note { margin: 0 0 10px; max-width: none; font-size: 13px; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 8px; padding: 8px 11px }
.sa-body { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; align-items: start }
.sa-side h2 { margin: 0 0 7px; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.sa-side ul { list-style: none; margin: 0 0 8px; padding: 0 }
.sa-side ul button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
  text-align: left; font: inherit; font-size: 14px; color: var(--ink2); background: transparent; border: 0;
  border-radius: 7px; padding: 6px 9px; cursor: pointer }
.sa-side ul button:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.sa-side ul button.on { color: var(--ink); background: color-mix(in srgb, var(--ink) 9%, transparent); font-weight: 700 }
.sa-side ul button.off b { opacity: .55; text-decoration: line-through }
.sa-side i { font-style: normal; font-family: var(--m); font-size: 11px; color: var(--ink3) }
.sa-add { display: flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--ink2); background: transparent; border: 1px dashed var(--hair); border-radius: 8px;
  padding: 6px 10px; cursor: pointer; margin-top: 4px }
.sa-add:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sa-card { min-width: 0; overflow-x: auto; margin: 0 0 16px; padding: 15px 16px; background: var(--paper); border: 1px solid var(--hair); border-radius: 12px }
.sa-card h3 { margin: 0 0 8px; font-size: 15px; font-weight: 800; color: var(--ink); display: flex; align-items: center; gap: 6px }
/* the seal beside a room's name here, as it is beside the room's own name in the surface */
.sa-sealed { display: inline-flex; align-items: center; color: var(--ink3) }
.sa-hint { margin: -4px 0 12px; max-width: 78ch; font-size: 12.5px; line-height: 1.5; color: var(--ink3) }
.sa-fields { display: flex; flex-wrap: wrap; align-items: end; gap: 14px; margin-bottom: 10px }
.sa-stat { font-size: 12px; color: var(--ink3) }
.sa-stat code { font-family: var(--m); font-size: 11.5px; color: var(--ink2) }
.sa-acts { display: flex; gap: 7px }
/* every quiet button of this screen wears one face — a row’s Remove is not a browser default */
.sa-acts button, .sa-right button, .sa-drop, .sa-grants button, .sa-said button { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink2);
  background: transparent; border: 1px solid var(--hair); border-radius: 7px; padding: 4px 10px; cursor: pointer }
.sa-acts button:hover, .sa-right button:hover, .sa-drop:hover, .sa-grants button:hover, .sa-said button:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sa-danger:hover { color: #c8382f !important; border-color: color-mix(in srgb, #c8382f 45%, transparent) !important }
.sa-table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 13.5px }
.sa-table th { text-align: left; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  color: var(--ink3); padding: 0 8px 6px; border-bottom: 1px solid var(--hair) }
.sa-table td { padding: 6px 8px; border-bottom: 1px solid var(--hair); color: var(--ink) }
.sa-table tr.off td { opacity: .55 }
.sa-right { text-align: right; white-space: nowrap }
.sa-right button + button { margin-left: 5px }
.sa-who { display: flex; align-items: center; gap: 8px }
.sa-pill { font-size: 11px; font-weight: 700; color: var(--ink3); background: color-mix(in srgb, var(--ink) 7%, transparent);
  border-radius: 999px; padding: 2px 8px }
/* several at a time, because a person is several things: each one is on or off on its own, and
   'member' is what being here means and is never off */
.sa-list { list-style: none; margin: 0; padding: 0 }
.sa-person { display: grid; grid-template-columns: minmax(0, 15rem) minmax(0, 1fr) auto; gap: 10px 14px;
  align-items: center; padding: 9px 2px; border-bottom: 1px solid var(--hair) }
.sa-person .sa-who { min-width: 0; display: flex; align-items: center; gap: 8px }
.sa-person .sa-who b { font-size: 14px; font-weight: 600; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sa-roles { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0 }
.sa-drop { justify-self: end }
@media (max-width: 1100px) {
  .sa-person { grid-template-columns: minmax(0, 1fr) auto; }
  .sa-person .sa-roles { grid-column: 1 / -1 }
}
.sa-role { font: inherit; font-size: 11.5px; font-weight: 600; color: var(--ink3); background: transparent;
  border: 1px solid var(--hair); border-radius: 999px; padding: 2px 9px; cursor: pointer;
  transition: color .14s ease, background .14s ease, border-color .14s ease }
.sa-role:hover { color: var(--ink2); border-color: color-mix(in srgb, var(--ink) 28%, transparent) }
.sa-role.is-on { color: var(--paper); background: var(--ink); border-color: var(--ink) }
span.sa-role { cursor: default; opacity: .75 }
.sa-new { display: grid; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--hair) }
.sa-row { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); align-items: end }
.sa-wide { grid-column: 1 / -1 }
.sa label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ink2) }
.sa input, .sa select { font: inherit; font-size: 13.5px; font-weight: 400; color: var(--ink); background: var(--paper);
  border: 1px solid var(--hair); border-radius: 7px; padding: 6px 9px; width: 100% }
.sa input:focus, .sa select:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 40%, transparent) }
.sa-table input, .sa-table select { padding: 4px 7px }
.sa-go { font: inherit; font-size: 13.5px; font-weight: 700; color: #fff; background: var(--ink); border: 0;
  border-radius: 8px; padding: 7px 14px; cursor: pointer; justify-self: start; align-self: end }
.sa-go:disabled { opacity: .4; cursor: default }
.sa-find { max-width: 340px }
.sa-found { list-style: none; margin: 8px 0 0; padding: 0 }
.sa-found button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit;
  font-size: 13.5px; color: var(--ink); background: transparent; border: 0; border-radius: 7px; padding: 5px 8px; cursor: pointer }
.sa-found button:hover, .sa-found button.on { background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sa-found i { font-style: normal; font-size: 12px; color: var(--ink3); margin-left: auto }
.sa-inline { max-height: 190px; overflow-y: auto; border: 1px solid var(--hair); border-radius: 8px; padding: 4px }
.sa-said { list-style: none; margin: 0; padding: 0 }
.sa-said li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start;
  padding: 9px 2px; border-bottom: 1px solid var(--hair) }
.sa-said li.gone p { font-style: italic; color: var(--ink3) }
.sa-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px }
.sa-meta b { font-size: 13.5px; font-weight: 700; color: var(--ink) }
.sa-meta i, .sa-meta u { font-style: normal; text-decoration: none; font-size: 11.5px; color: var(--ink3) }
.sa-said p { margin: 2px 0 0; max-width: 80ch; font-size: 13.5px; line-height: 1.45; color: var(--ink2) }
.sa-grants { list-style: none; margin: 0; padding: 0 }
.sa-grants li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center;
  padding: 9px 2px; border-bottom: 1px solid var(--hair); color: var(--ink3) }
.sa-grants b { font-size: 13.5px; font-weight: 600; color: var(--ink) }
.sa-grants i { display: block; font-style: normal; font-size: 12px; color: var(--ink3) }
.sa-none { padding: 10px 2px; font-size: 13px; color: var(--ink3) }
/* the declaration's own controls: a role is a row, a grant is a row, and neither is ever the
   file's shape on screen. The rows are grids rather than table cells, for the same reason the
   people list is: a run of chips has to be able to wrap. */
.sa-role-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 44px 72px minmax(0, 1.4fr) auto;
  gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--hair) }
.sa-role-row:last-child { border-bottom: 0 }
.sa-r-colour { padding: 2px; height: 30px; cursor: pointer }
.sa-r-rank { text-align: right }
.sa-grant-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) auto auto; gap: 8px;
  align-items: end; padding: 8px 0; border-bottom: 1px solid var(--hair) }
.sa-grant-row:last-child { border-bottom: 0 }
.sa-inline-field { max-width: 110px }
.sa-sub { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--hair) }
.sa-sub > b { display: block; margin-bottom: 7px; font-size: 11px; font-weight: 800; letter-spacing: .05em;
  text-transform: uppercase; color: var(--ink3) }
/* .sa label is a grid, so a switch says it is a row itself — flex-direction on a grid does nothing */
/* .sa label is a grid and outranks a bare class, so the switch says so where it can be heard */
.sa label/* the ways in, one per row: a space filled two ways is two rows and never a shape to type */
.sa-fill { display: grid; gap: 5px; align-content: start; align-self: end }
.sa-fill-head { font-size: 12px; font-weight: 600; color: var(--ink2) }
/* A RULE IS ONE SENTENCE, so it sits on one line and wraps rather than stacking: the way in, then
   the window if it has one, then the way to take it away. A two-column grid made every control
   full-width and turned "anybody with a call in the next 7 days" into five stacked boxes. */
.sa-fill-row { display: flex; flex-wrap: wrap; gap: 7px; align-items: center }
.sa-fill-row > select:first-child { flex: 1 1 15rem; min-width: 12rem }
.sa-fill-row select { width: auto }
.sa-fill-row .sa-switch { align-self: center; padding-bottom: 0 }
.sa-fill-row .sa-num { width: 4.5rem; flex: 0 0 auto }
.sa-fill-row .sa-drop { margin-left: auto }
.sa-x { width: 28px; height: 28px; font: inherit; font-size: 16px; line-height: 1; color: var(--ink3);
  background: transparent; border: 1px solid var(--hair); border-radius: 7px; cursor: pointer }
.sa-x:hover { color: var(--ink) }
.sa-addfill { justify-self: start; width: auto; font: inherit; font-size: 12.5px; font-weight: 600;
  color: var(--ink2); background: transparent; border: 1px solid var(--hair); border-radius: 999px;
  padding: 4px 11px; cursor: pointer }
.sa-addfill:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sa-switch { display: flex; align-items: center; gap: 7px; align-self: end; padding-bottom: 7px }
.sa label.sa-switch input { width: auto; margin: 0 }
.sa-switch span { font-size: 12.5px; font-weight: 600; color: var(--ink2); white-space: nowrap }
.sa textarea { font: inherit; font-size: 13.5px; line-height: 1.5; color: var(--ink); background: var(--paper);
  border: 1px solid var(--hair); border-radius: 8px; padding: 8px 10px; resize: vertical; width: 100% }
.sa textarea:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 40%, transparent) }
.sa-said-file { margin: 0 0 14px }
/* the save bar: quiet until something has changed, and then it is the only thing on the page that is not */
/* the bar floats over the foot of the page, so the last card ends above it rather than under it */
.sa-main { padding-bottom: 4px }
.sa-bar { position: sticky; bottom: 8px; z-index: 2; margin-top: 8px; display: flex; align-items: center; justify-content: flex-end;
  gap: 12px; padding: 10px 14px; font-size: 12.5px; color: var(--ink3);
  background: color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter: blur(6px);
  border: 1px solid var(--hair); border-radius: 12px;
  transition: color .16s ease, border-color .16s ease, box-shadow .16s ease }
.sa-bar.on { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--ink) 10%, transparent) }
@media (max-width: 1100px) {
  .sa-role-row, .sa-grant-row { grid-template-columns: minmax(0, 1fr) }
  /* stacked, a colour is still a swatch and a rank still a number, not a bar across the card */
  .sa-r-colour { width: 56px }
  .sa-r-rank { max-width: 90px }
  .sa-role-row .sa-drop, .sa-grant-row .sa-drop { justify-self: start }
}
@media (max-width: 820px) { .sa-body { grid-template-columns: minmax(0, 1fr) } }
</style>
