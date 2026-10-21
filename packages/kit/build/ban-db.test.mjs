/*
 * BAN AND SHADOW BAN, against the real database.
 *
 * Both are acts a person does to a person, so the rules that matter are the ones a policy holds
 * and not the ones a component remembers — which is why this talks to the stack rather than to a
 * pure module. Skipped, loudly, where the stack is not up.
 *
 * What it proves:
 *   a ban takes the membership and KEEPS THEM OUT — the door, an invitation and the fill sweep all
 *   meet the same fence, because it is one trigger on the one insert every membership passes;
 *   a shadow-banned person's new lines are invisible to everybody else and unchanged for them;
 *   what they wrote BEFORE is left alone, because marking the past is a different act;
 *   a lift is a row, not an edit, and it puts things back.
 */
import pg from 'pg'
import { requireStack, skip } from './test-stack.mjs'
const URL = requireStack('ban').db

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nBAN\n')
const client = new pg.Client({ connectionString: URL })
try { await client.connect() } catch (e) { skip('ban', 'the stack\'s database does not answer (' + e.message.slice(0, 60) + ')') }

const q = (sql, args = []) => client.query(sql, args).then((r) => r.rows)
/* Run a statement as a given person, the way the app does — inside a savepoint, because half of
   what is worth proving here is that something is REFUSED, and a refusal aborts the transaction.
   Without the savepoint the rollback in the finally throws over the top of the real error and the
   test reports "transaction is aborted" instead of the exception it was looking for. */
let sp = 0
const as = async (uid, sql, args = []) => {
  const name = 'as_' + (++sp)
  await q('savepoint ' + name)
  await q('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ sub: uid, role: 'authenticated' })])
  await q('set local role authenticated')
  try {
    const rows = await q(sql, args)
    await q('reset role')
    await q('release savepoint ' + name)
    return rows
  } catch (e) {
    await q('rollback to savepoint ' + name).catch(() => {})
    await q('reset role').catch(() => {})
    throw e
  }
}

await q('begin')
try {
  /* a space, a room, a moderator, a member and a bystander — made here and rolled back after */
  const [{ id: modId }] = await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mod-ban@example.com', '', now(), now(), now()) returning id`)
  const [{ id: badId }] = await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bad-ban@example.com', '', now(), now(), now()) returning id`)
  const [{ id: byId }] = await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'by-ban@example.com', '', now(), now(), now()) returning id`)

  const [{ id: spaceId }] = await q(`insert into public.spaces (slug, name, kind, joining)
    values ('ban-test', 'Ban test', 'community', '{"how":"open"}'::jsonb) returning id`)
  const [{ id: chanId }] = await q(`insert into public.channels (space_id, slug, name, kind, mode)
    values ($1, 'room', 'Room', 'channel', 'stream') returning id`, [spaceId])
  for (const u of [modId, badId, byId]) {
    await q(`insert into public.space_members (space_id, user_id, source) values ($1, $2, 'manual')`, [spaceId, u])
    await q(`insert into public.channel_members (channel_id, user_id) values ($1, $2) on conflict do nothing`, [chanId, u])
  }
  /* the moderator's capability, granted the way a space grants one */
  await q(`insert into public.space_grants (space_id, capability, scope, user_id, source) values ($1, 'moderate', 'user', $2, 'hand')`, [spaceId, modId])

  /* --- a line each, before anything is done --- */
  await as(badId, `insert into public.space_messages (channel_id, author_id, kind, body) values ($1, $2, 'text', 'before the act')`, [chanId, badId])
  const seenBefore = await as(byId, `select count(*)::int n from public.space_messages where channel_id = $1`, [chanId])
  ok('the bystander sees the line to begin with', seenBefore[0].n === 1, 'saw ' + seenBefore[0].n)

  /* --- SHADOW BAN --- */
  await as(modId, `select public.space_moderate('shadow-ban', $1, null, $2, 'testing', null)`, [spaceId, badId])
  await as(badId, `insert into public.space_messages (channel_id, author_id, kind, body) values ($1, $2, 'text', 'after the act')`, [chanId, badId])

  const byNow = await as(byId, `select body from public.space_messages where channel_id = $1 order by seq`, [chanId])
  ok('the bystander does not see what was said after it', byNow.length === 1 && byNow[0].body === 'before the act', JSON.stringify(byNow.map((r) => r.body)))
  const badNow = await as(badId, `select body from public.space_messages where channel_id = $1 order by seq`, [chanId])
  ok('and the shadow-banned person sees their own, unchanged', badNow.length === 2, JSON.stringify(badNow.map((r) => r.body)))
  const modNow = await as(modId, `select body from public.space_messages where channel_id = $1 order by seq`, [chanId])
  ok('a moderator sees everything', modNow.length === 2, JSON.stringify(modNow.map((r) => r.body)))

  const hist = await as(byId, `select public.space_history($1) h`, [chanId])
  ok('and the paged read agrees with the policy', JSON.stringify(hist[0].h).includes('before the act') && !JSON.stringify(hist[0].h).includes('after the act'))

  /* --- a lift is a row, and it puts things back --- */
  const [{ id: actId }] = await q(`select id from public.space_moderation where kind = 'shadow-ban' and subject_id = $1`, [badId])
  await as(modId, `select public.space_lift($1, 'thought better of it')`, [actId])
  await as(badId, `insert into public.space_messages (channel_id, author_id, kind, body) values ($1, $2, 'text', 'after the lift')`, [chanId, badId])
  const byLifted = await as(byId, `select body from public.space_messages where channel_id = $1 order by seq`, [chanId])
  ok('after a lift the bystander sees the new line', byLifted.some((r) => r.body === 'after the lift'), JSON.stringify(byLifted.map((r) => r.body)))
  ok('and what was said while shadowed stays shadowed', !byLifted.some((r) => r.body === 'after the act'))
  const lifts = await q(`select count(*)::int n from public.space_moderation where kind = 'lift' and lifts_id = $1`, [actId])
  ok('the lift is its own row, not an edit of the act', lifts[0].n === 1)
  const still = await q(`select count(*)::int n from public.space_moderation where id = $1`, [actId])
  ok('and the act it undid is still on the record', still[0].n === 1)

  /* --- BAN --- */
  await as(modId, `select public.space_moderate('ban', $1, null, $2, 'testing', null)`, [spaceId, badId])
  const mem = await q(`select count(*)::int n from public.space_members where space_id = $1 and user_id = $2`, [spaceId, badId])
  ok('a ban takes the membership', mem[0].n === 0)
  ok('and space_banned says so', (await q(`select public.space_banned($1, $2) b`, [spaceId, badId]))[0].b === true)

  /* every way back in meets the same fence */
  await q(`insert into public.space_members (space_id, user_id, source) values ($1, $2, 'fill') on conflict do nothing`, [spaceId, badId])
  const afterFill = await q(`select count(*)::int n from public.space_members where space_id = $1 and user_id = $2`, [spaceId, badId])
  ok('the fill sweep cannot put them back', afterFill[0].n === 0)

  await q(`insert into public.space_members (space_id, user_id, source) values ($1, $2, 'invite') on conflict do nothing`, [spaceId, badId])
  const afterInvite = await q(`select count(*)::int n from public.space_members where space_id = $1 and user_id = $2`, [spaceId, badId])
  ok('nor an invitation', afterInvite[0].n === 0)

  const door = await as(badId, `select public.space_ask($1) r`, [spaceId])
  ok('and the open door says so in words', door[0].r && door[0].r.error === 'barred', JSON.stringify(door[0].r))

  /* lifting the ban lets them back */
  const [{ id: banId }] = await q(`select id from public.space_moderation where kind = 'ban' and subject_id = $1`, [badId])
  await as(modId, `select public.space_lift($1, null)`, [banId])
  ok('a lifted ban is no longer a ban', (await q(`select public.space_banned($1, $2) b`, [spaceId, badId]))[0].b === false)
  const back = await as(badId, `select public.space_ask($1) r`, [spaceId])
  ok('and the door opens again', back[0].r && back[0].r.ok === true, JSON.stringify(back[0].r))

  /* --- who may do it --- */
  let refused = false
  try { await as(byId, `select public.space_moderate('ban', $1, null, $2, null, null)`, [spaceId, modId]) } catch (e) { refused = /not allowed/.test(e.message) }
  ok('somebody who cannot moderate cannot ban', refused)
} finally {
  await q('rollback')
  await client.end()
}

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
