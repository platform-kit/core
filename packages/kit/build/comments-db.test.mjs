/*
 * THE COMMENT RULES, AGAINST THE LOCAL STACK — the half that cannot be proven pure.
 *
 * Who is held and who is not, whether a held comment is visible to its author and to nobody else,
 * whether the flagged list stops a trusted author and whether it tells them why, what an approval
 * writes down, and whether an embed's three declarations survive. The pure arithmetic — the thread's
 * shape, the orders, the matcher — is build/comments.test.mjs.
 *
 * Everything it makes is removed at the end, and the site's own policy is put back exactly as it
 * was: this runs against a stack somebody is also using. Skipped with a note when the stack is down
 * (COMMENTS_TEST=0 skips it too).
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('comments-db: ' + m)
if (process.env.COMMENTS_TEST === '0') { note('skipped (COMMENTS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

console.log('\nCOMMENTS, AGAINST THE STACK\n')

const KIND = 'test-comment-' + Math.random().toString(36).slice(2, 7)
const SUBJ = 'a-thing'
let hadWords = null
let strangerId = null

try {
  const admin = await as('admin@example.com')
  const member = await as('member@example.com')
  /* trust is global and never expires, so "somebody nobody knows" has to be somebody new: a seeded
     account an earlier run released would be trusted for ever and this would pass by luck */
  const email = 'stranger-' + Math.random().toString(36).slice(2, 8) + '@example.com'
  const { data: newbie, error: me } = await service.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  if (me) throw new Error('could not make a stranger: ' + me.message)
  strangerId = newbie.user.id
  const free = await as(email)

  /* ---- a surface of our own, so nothing of the site's is disturbed ---- */
  await service.from('comment_subjects').insert({
    kind: KIND, subject: SUBJ, title: 'A thing', href: '/a-thing',
    access: [], allow: 'members', approval: 'trusted', votes: true, reactions: true,
  })
  /* the kind declared open, so the embed half below has a wildcard to make a subject from */
  await service.from('comment_subjects').insert({
    kind: KIND, subject: '*', access: [], allow: 'members', approval: 'none',
  })

  const { data: was } = await service.from('app_settings').select('value').eq('key', 'comment_flagged').maybeSingle()
  hadWords = was ? was.value : null
  await service.from('app_settings').upsert({ key: 'comment_flagged', value: '["fnord"]' }, { onConflict: 'key' })

  const say = async (who, body, parent = null) =>
    (await who.sb.rpc('comment_say', { p_kind: KIND, p_subject: SUBJ, p_body: body, p_parent: parent })).data
  const readAs = async (who) => (await who.sb.rpc('comments_on', { p_kind: KIND, p_subject: SUBJ })).data || []

  /* ---- trusted, and not ---- */
  const free1 = await say(free, 'A first comment from somebody nobody knows.')
  ok('a first-time commenter on a trusted surface is held', free1 && free1.state === 'waiting', JSON.stringify(free1))
  const mem1 = await say(member, 'And one from somebody who pays.')
  ok('a live membership is a standing the site already answers', mem1 && mem1.state === 'live', JSON.stringify(mem1))
  ok('and it is a fact about the PERSON, read before they typed',
    (await member.sb.rpc('comment_trusted', { p_user: member.id })).data === true)
  ok('somebody with no standing is not trusted',
    (await admin.sb.rpc('comment_trusted', { p_user: free.id })).data === false)

  /* ---- held is not hidden from its author, and is hidden from everybody else ---- */
  const theirs = (await readAs(free)).find((c) => c.id === free1.id)
  ok('its author sees it', !!theirs && theirs.state === 'waiting')
  ok('and is told it is waiting rather than believing it was published', theirs && theirs.state === 'waiting')
  ok('nobody else sees it at all', !(await readAs(member)).some((c) => c.id === free1.id))
  ok('a moderator does', (await readAs(admin)).some((c) => c.id === free1.id))
  ok('and it is not counted where it is not shown',
    Number(((await member.sb.rpc('comment_counts', { p_kind: KIND, p_subjects: [SUBJ] })).data || {})[SUBJ]) === 1)

  /* ---- the flagged list: a machine may flag, only a person decides ---- */
  const mem2 = await say(member, 'This one says fnord, which the site has listed.')
  ok('a flagged word holds a trusted author too', mem2 && mem2.state === 'waiting', JSON.stringify(mem2))
  ok('the author is never told which word caught them', mem2 && mem2.flagged === undefined)
  const held = (await readAs(admin)).find((c) => c.id === mem2.id)
  ok('the moderator is', held && held.flagged === 'fnord', JSON.stringify(held && held.flagged))
  ok('and the author still is not', ((await readAs(member)).find((c) => c.id === mem2.id) || {}).flagged === null)
  const inWord = await say(member, 'A word with fnords inside a longer one.')
  ok('a word inside another word does not match', inWord && inWord.state === 'live', JSON.stringify(inWord))

  /* ---- the fifth act, and what it writes down ---- */
  const before = ((await service.from('space_moderation').select('id').eq('kind', 'approve')).data || []).length
  const done = (await admin.sb.rpc('comment_approve', { p_comment: free1.id, p_reason: 'fine' })).data
  ok('a moderator releases it', done && done.ok === true, JSON.stringify(done))
  ok('and everybody sees it', (await readAs(member)).some((c) => c.id === free1.id))
  const after = (await service.from('space_moderation').select('id, actor_id, comment_id, reason').eq('kind', 'approve')).data || []
  ok('the release is a record like any other act', after.length === before + 1)
  ok('with the moderator, the comment and the reason on it',
    after.some((r) => r.comment_id === free1.id && r.actor_id === admin.id && r.reason === 'fine'))
  ok('and the same person is trusted afterwards',
    (await admin.sb.rpc('comment_trusted', { p_user: free.id })).data === true)
  const free2 = await say(free, 'And so this one goes straight up.')
  ok('so their next comment appears at once', free2 && free2.state === 'live', JSON.stringify(free2))

  ok('a member cannot release their own', ((await member.sb.rpc('comment_approve', { p_comment: mem2.id })).data || {}).error === 'not-yours')
  ok('and refusing removes it as any message is',
    ((await admin.sb.rpc('comment_refuse', { p_comment: mem2.id })).data || {}).state === 'removed')
  ok('the placeholder stays', (await readAs(admin)).some((c) => c.id === mem2.id && c.deleted_at))

  /* ---- a reply keeps its real depth ---- */
  const r1 = await say(member, 'One.')
  const r2 = await say(member, 'Two, answering one.', r1.id)
  const r3 = await say(member, 'Three, answering two.', r2.id)
  const rows = await readAs(member)
  const at = (id) => (rows.find((c) => c.id === id) || {}).parent
  ok('a reply to a reply keeps the reply it answered', at(r3.id) === r2.id && at(r2.id) === r1.id,
    JSON.stringify(rows.map((c) => [c.id, c.parent])))

  /* ---- what may be done without writing a reply ---- */
  const target = { surface: 'comment', target_id: r1.id, user_id: member.id }
  ok('a vote is taken where the surface takes them',
    !(await member.sb.from('votes').upsert({ ...target, vote: 1 }, { onConflict: 'surface,target_id,user_id' })).error)
  const voted = (await readAs(member)).find((c) => c.id === r1.id)
  ok('and comes back with the line, aggregated', voted && Number(voted.up) === 1 && Number(voted.my_vote) === 1)
  ok('changing it replaces the row rather than adding one',
    !(await member.sb.from('votes').upsert({ ...target, vote: -1 }, { onConflict: 'surface,target_id,user_id' })).error
    && ((await member.sb.from('votes').select('vote').match(target)).data || []).length === 1)
  const re1 = await member.sb.from('reactions').insert({ ...target, emoji: '👍' })
  const re2 = await member.sb.from('reactions').insert({ ...target, emoji: '🙏' })
  ok('a reaction is many per person', !re1.error && !re2.error, JSON.stringify([re1.error, re2.error]))
  const react = (await readAs(member)).find((c) => c.id === r1.id)
  ok('and comes back as a tally with this reader\'s own marked',
    react && Number(react.re['👍']) === 1 && (react.mine_re || []).includes('🙏'))

  await service.from('comment_subjects').update({ votes: false }).eq('kind', KIND).eq('subject', SUBJ)
  ok('a vote on a surface that takes none is refused by the policy, not hidden by the page',
    !!(await member.sb.from('votes').upsert({ surface: 'comment', target_id: r3.id, user_id: member.id, vote: 1 }, { onConflict: 'surface,target_id,user_id' })).error)
  await service.from('comment_subjects').update({ votes: true }).eq('kind', KIND).eq('subject', SUBJ)

  /* ---- and the embed's three declarations ---- */
  const SLUG = '/blog/a-post-' + Math.random().toString(36).slice(2, 6)
  const made = await member.sb.rpc('comment_say', {
    p_kind: KIND, p_subject: SLUG, p_body: 'From somebody else\'s page.',
    p_title: 'A Post', p_href: 'https://elsewhere.example' + SLUG,
  })
  ok('an embed makes the subject from the kind\'s own declaration', !made.error && !!made.data && !made.data.error, JSON.stringify(made.error || made.data))
  const { data: subj } = await service.from('comment_subjects').select('*').eq('kind', KIND).eq('subject', SLUG).maybeSingle()
  ok('the slug is the subject', !!subj)
  ok('the title is kept, for the board and the queue', subj && subj.title === 'A Post')
  ok('and the canonical url, so there is a way back', subj && subj.href === 'https://elsewhere.example' + SLUG)
  await member.sb.rpc('comment_say', {
    p_kind: KIND, p_subject: SLUG, p_body: 'Again.', p_title: 'A DIFFERENT NAME', p_href: 'https://elsewhere.example/moved',
  })
  const { data: again } = await service.from('comment_subjects').select('title, href').eq('kind', KIND).eq('subject', SLUG).maybeSingle()
  ok('a caller may name a thread and may not rename one', again && again.title === 'A Post' && again.href === 'https://elsewhere.example' + SLUG)
  ok('the page moving does not move its conversation',
    ((await service.from('comments').select('id').eq('kind', KIND).eq('subject', SLUG)).data || []).length === 2)

  /* ---- the queue: the unattached ones, and who may read it ---- */
  const q = (await admin.sb.rpc('comment_queue', { p_state: 'waiting', p_attached: false, p_limit: 100 })).data || []
  ok('the desk\'s queue is the conversations no room owns', Array.isArray(q) && q.every((r) => r.attached === false))
  ok('and an ordinary member reads nothing from it',
    (((await member.sb.rpc('comment_queue', { p_state: 'waiting', p_limit: 100 })).data) || []).length === 0)
} catch (e) {
  fail++
  console.log('  FAIL  ' + (e && e.message))
} finally {
  await service.from('comments').delete().eq('kind', KIND)
  await service.from('space_moderation').delete().is('space_id', null).not('comment_id', 'is', null)
  await service.from('comment_subjects').delete().eq('kind', KIND)
  if (hadWords === null) await service.from('app_settings').delete().eq('key', 'comment_flagged')
  else await service.from('app_settings').upsert({ key: 'comment_flagged', value: hadWords }, { onConflict: 'key' })
  /* and the stranger goes, so the next run's stranger is a stranger too */
  if (strangerId) await service.auth.admin.deleteUser(strangerId).catch(() => {})
}

console.log('\ncomments-db: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
