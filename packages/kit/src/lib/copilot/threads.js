/*
 * THE CONVERSATIONS SOMEBODY HAS HAD, so they can come back to one.
 *
 * A spoken answer is gone the moment it is made, and until now so was the conversation: close the
 * page and there was nothing. This is the sidebar's data — a thread per session, lines in it, the
 * person's own rows under their own session (see schemas/95-copilot.sql for why these are theirs
 * to write while copilot_memory is not).
 *
 * THE TITLE IS NEVER TYPED. It is the first thing the person said, trimmed to a line, which is
 * what every assistant does and what means a list never shows "Untitled". A thread with no title
 * yet is a thread nobody has spoken in, and nothing lists it.
 *
 * NOTHING HERE DECIDES ANYTHING. It reads and writes rows; whether there is a backend at all is
 * the page's question, and with none it simply never calls — a deployment with no Supabase has no
 * voice surface to put a sidebar on.
 */

export const TITLE_MAX = 72

/* the first thing said, as a line: one line, no markdown, short enough to sit in a column */
export function titleOf(said) {
  const one = String(said || '').replace(/\s+/g, ' ').trim()
  if (!one) return ''
  if (one.length <= TITLE_MAX) return one
  /* break on a word rather than mid-word, but never leave a stub */
  const cut = one.slice(0, TITLE_MAX)
  const sp = cut.lastIndexOf(' ')
  return (sp > TITLE_MAX * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

/*
 * WHEN, IN WORDS. A sidebar of timestamps is a sidebar nobody reads; what somebody wants to know
 * is whether this was today, and otherwise roughly when. The words come from the caller, because
 * every reader-facing string in this project is authored in markdown.
 */
export function whenOf(at, words = {}, now = Date.now()) {
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((now - t) / 60000)
  if (mins < 1) return words.now || ''
  if (mins < 60) return (words.minutes || '{n}m').replace('{n}', String(mins))
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return (words.hours || '{n}h').replace('{n}', String(hrs))
  const days = Math.floor(hrs / 24)
  if (days < 7) return (words.days || '{n}d').replace('{n}', String(days))
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function threads(supabase, bot) {
  const table = () => supabase.from('copilot_threads')

  return {
    /* every conversation with THIS assistant, newest spoken in first. A thread nobody said
       anything in has no title and is not a conversation yet, so it is left out. */
    async list(limit = 40) {
      const { data, error } = await table()
        .select('id, title, spoke_at')
        .eq('bot', bot).neq('title', '')
        .order('spoke_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async lines(id) {
      const { data, error } = await supabase.from('copilot_lines')
        .select('who, said').eq('thread_id', id).order('created_at', { ascending: true })
      if (error) throw error
      return (data || []).map((r) => ({ who: r.who, text: r.said }))
    },

    /* a thread is made empty and titled by the first thing said in it, so starting one costs
       nothing and an abandoned one never appears in the list */
    async start() {
      const { data, error } = await table().insert({ bot, title: '' }).select('id').single()
      if (error) throw error
      return data.id
    },

    /* one line, and the thread moves to the top. The title is set once, by the first thing the
       PERSON said — never by an answer, which would title a conversation with its reply. */
    async append(id, who, text, { title = false } = {}) {
      if (!id || !text) return
      const { error } = await supabase.from('copilot_lines').insert({ thread_id: id, who, said: text })
      if (error) throw error
      const patch = { spoke_at: new Date().toISOString() }
      if (title && who === 'me') patch.title = titleOf(text)
      const q = title && who === 'me' ? table().update(patch).eq('id', id).eq('title', '') : table().update(patch).eq('id', id)
      await q
    },

    async rename(id, title) {
      const { error } = await table().update({ title: titleOf(title) }).eq('id', id)
      if (error) throw error
    },

    /* the lines go with it: the thread is their only reason to exist (ON DELETE CASCADE) */
    async remove(id) {
      const { error } = await table().delete().eq('id', id)
      if (error) throw error
    },
  }
}
