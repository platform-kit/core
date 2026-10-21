/*
 * WHAT A PERSON TOLD AN ASSISTANT IS THEIRS.
 *
 * Against the local stack, because the promises here are the DATABASE's: a person reads their own
 * and nobody else's, deletes their own and nothing comes back, and no client may write a word into
 * somebody's mouth that the assistant would later recall as theirs. A policy is not proved by
 * reading it.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('copilot-db: ' + m)
if (process.env.COPILOT_TEST === '0') { note('skipped (COPILOT_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

/* a 384-vector pointing mostly one way, so "near" and "far" are arranged rather than hoped for */
const vec = (lean) => { const v = new Array(384).fill(0); v[lean] = 1; return v }
const BOT = `zz-copilot-probe-${randomUUID()}`
const made = []

console.log('\nWHAT A PERSON TOLD AN ASSISTANT\n')
try {
  const one = await as('member@example.com')
  const two = await as('member2@example.com')

  /* the platform writes, with the service role — never a client */
  const put = async (user, said, lean) => {
    const { data, error } = await service.from('copilot_memory')
      .insert({ user_id: user, bot: BOT, said, embedding: JSON.stringify(vec(lean)) }).select('id').single()
    if (error) throw new Error('insert: ' + error.message)
    made.push(data.id)
    return data.id
  }
  await put(one.id, 'I am training for a marathon in April', 0)
  await put(one.id, 'My knee hurts after long runs', 0)
  await put(one.id, 'I keep chickens', 200)
  await put(two.id, 'I am learning the cello', 0)

  /* ------------------------------------------------------- theirs to read */
  {
    const { data } = await one.sb.from('copilot_memory').select('said').eq('bot', BOT)
    const mine = (data || []).map((r) => r.said)
    ok('a person reads their own', mine.length === 3, JSON.stringify(mine))
    ok('and nobody else\'s — the other person\'s cello is not there', !mine.some((t) => /cello/.test(t)), JSON.stringify(mine))
  }
  {
    const { data } = await two.sb.from('copilot_memory').select('said').eq('bot', BOT)
    ok('and it runs both ways', (data || []).length === 1 && /cello/.test(data[0].said), JSON.stringify(data))
  }

  /* ------------------------------------------- no client may write or edit */
  {
    const { error } = await one.sb.from('copilot_memory').insert({ user_id: one.id, bot: BOT, said: 'I said this myself' })
    ok('a client cannot write a memory, not even their own', !!error, 'the insert was allowed')
  }
  {
    const { data } = await one.sb.from('copilot_memory').select('id').eq('bot', BOT).limit(1)
    const { error, count } = await one.sb.from('copilot_memory').update({ said: 'something else' }).eq('id', data[0].id).select('id')
    ok('and cannot edit one', !!error || !count, 'the update was allowed')
  }

  /* ------------------------------------------------------ recall, and the floor */
  {
    const { data: near } = await service.rpc('copilot_recall', { p_user: one.id, p_bot: BOT, p_query: JSON.stringify(vec(0)), p_limit: 6 })
    ok('recall finds what was close', (near || []).length === 2 && near.some((t) => /marathon/.test(t)), JSON.stringify(near))
    ok('THE FLOOR: an unrelated remark is not recalled, because a nearest neighbour is always something',
      !(near || []).some((t) => /chickens/.test(t)), JSON.stringify(near))
    const { data: other } = await service.rpc('copilot_recall', { p_user: two.id, p_bot: BOT, p_query: JSON.stringify(vec(0)), p_limit: 6 })
    ok('and it never crosses between people', (other || []).length === 1 && /cello/.test(other[0]), JSON.stringify(other))
    const { data: nobot } = await service.rpc('copilot_recall', { p_user: one.id, p_bot: 'a-different-bot', p_query: JSON.stringify(vec(0)), p_limit: 6 })
    ok('nor between assistants — what they told one is not the other\'s', (nobot || []).length === 0, JSON.stringify(nobot))
  }

  /* ------------------------------------------------------ theirs to delete */
  {
    const before = (await one.sb.from('copilot_memory').select('id').eq('bot', BOT)).data || []
    const { error } = await one.sb.from('copilot_memory').delete().eq('user_id', one.id).eq('bot', BOT)
    ok('a person deletes their own', !error, error && error.message)
    const after = (await one.sb.from('copilot_memory').select('id').eq('bot', BOT)).data || []
    ok('and it is gone', before.length > 0 && after.length === 0, `${before.length} → ${after.length}`)
    const { data: recalled } = await service.rpc('copilot_recall', { p_user: one.id, p_bot: BOT, p_query: JSON.stringify(vec(0)), p_limit: 6 })
    ok('the assistant recalls none of it afterwards', (recalled || []).length === 0, JSON.stringify(recalled))
  }
  {
    const { error } = await one.sb.from('copilot_memory').delete().eq('user_id', two.id).eq('bot', BOT)
    const left = (await service.from('copilot_memory').select('id')
      .eq('user_id', two.id).eq('bot', BOT)).data || []
    ok('and cannot delete anybody else\'s', left.length === 1, `${left.length} left of the other person's`)
  }
  /* ------------------------------------------------------ the conversations themselves */
  /*
   * A KEPT CONVERSATION IS THEIRS, and unlike what the assistant remembers, theirs to WRITE: the
   * worst a forged line can do here is lie to the person who forged it, in their own transcript.
   * What must not happen is anybody reading or touching somebody else's, and a thread that is
   * deleted taking its lines with it rather than leaving them behind under a dead parent.
   */
  {
    const mk = async (who, title) => {
      const { data, error } = await who.sb.from('copilot_threads').insert({ bot: BOT, title }).select('id').single()
      if (error) throw new Error('thread: ' + error.message)
      return data.id
    }
    const t1 = await mk(one, 'about the marathon')
    const t2 = await mk(two, 'about the cello')
    await one.sb.from('copilot_lines').insert([
      { thread_id: t1, who: 'me', said: 'how long should my long run be' },
      { thread_id: t1, who: 'them', said: 'about a third of the week' },
    ])

    const mine = (await one.sb.from('copilot_threads').select('id, title')).data || []
    ok('a person sees their own conversations', mine.some((r) => r.id === t1), JSON.stringify(mine))
    ok('and not anybody else\'s', !mine.some((r) => r.id === t2), JSON.stringify(mine))

    const lines = (await one.sb.from('copilot_lines').select('who, said').eq('thread_id', t1)).data || []
    ok('the lines come back in it', lines.length === 2, JSON.stringify(lines))
    const peeked = (await two.sb.from('copilot_lines').select('id').eq('thread_id', t1)).data || []
    ok('and nobody else may read them', peeked.length === 0, JSON.stringify(peeked))

    /* a line written INTO somebody else's conversation. Carrying your own name is not enough:
       the thread has to be yours, or the row is refused outright. */
    const { error: intruded } = await two.sb.from('copilot_lines')
      .insert({ thread_id: t1, who: 'them', said: 'you should give up' })
    ok('a line cannot be slipped into somebody else\'s conversation', !!intruded, 'it was accepted')
    const owner = (await one.sb.from('copilot_lines').select('said').eq('thread_id', t1)).data || []
    ok('and the owner\'s own stays as it was', owner.length === 2, JSON.stringify(owner.map((r) => r.said)))

    const { error: renamed } = await two.sb.from('copilot_threads').update({ title: 'theirs now' }).eq('id', t1)
    const still = (await service.from('copilot_threads').select('title').eq('id', t1)).data || []
    ok('and cannot rename it', still[0] && still[0].title === 'about the marathon', JSON.stringify(still))

    await two.sb.from('copilot_threads').delete().eq('id', t1)
    const survived = (await service.from('copilot_threads').select('id').eq('id', t1)).data || []
    ok('nor delete it', survived.length === 1, JSON.stringify(survived))

    /* deleted by its owner, and the lines go with it rather than outliving their only parent */
    await one.sb.from('copilot_threads').delete().eq('id', t1)
    const gone = (await service.from('copilot_threads').select('id').eq('id', t1)).data || []
    const orphans = (await service.from('copilot_lines').select('id').eq('thread_id', t1)).data || []
    ok('a person deletes their own conversation', gone.length === 0)
    ok('and its lines go with it', orphans.length === 0, `${orphans.length} left`)
    await service.from('copilot_threads').delete().eq('id', t2)
  }

} finally {
  if (made.length) await service.from('copilot_memory').delete().in('id', made)
  await service.from('copilot_threads').delete().eq('bot', BOT)
  const { data: left } = await service.from('copilot_memory').select('id').eq('bot', BOT)
  const { data: leftT } = await service.from('copilot_threads').select('id').eq('bot', BOT)
  ok('the probe left nothing behind', !(left || []).length && !(leftT || []).length, `${(left || []).length} + ${(leftT || []).length} rows`)
}

console.log(`\ncopilot-db: ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''}\n`)
process.exit(fail ? 1 : 0)
