/*
 * A MESSAGE ROW AS A MATRIX EVENT, AND BACK.
 *
 * `space_messages` is the timeline. This turns one of its rows into the event a client expects,
 * and an event a client sends into the arguments of a write. Pure: no database, no clock, no
 * environment — everything it needs is passed in, so the same function runs in the Edge Function,
 * in the build and under Node in the test.
 *
 * Two rules decide the shape of everything below.
 *
 * ONE: the row is the truth and the event is a view of it. Where Matrix has a concept we do not,
 * it is derived or left out; where we have one Matrix does not, it rides in the content under a
 * name of ours rather than bending a standard field. A client that does not know the name ignores
 * it, which is how Matrix is meant to be extended.
 *
 * TWO: an edit is a replacement and a withdrawal is a redaction, both keyed on the message's own
 * id. Matrix models an edit as a NEW event pointing at the old one, which would mean inventing an
 * id we have nowhere to keep — so the row's own id is the event id in both directions and the
 * replacement carries it as its target. Two surfaces then always agree about which line changed,
 * which is the whole reason the id is the message's rather than a position in the room.
 */

import { eventId, readEvent, roomId, userId } from './ids.js'

/* our kinds, and the msgtype each becomes. A poll and an announcement have no standard msgtype;
   they go out as text with our own key beside them, so a client shows the words rather than
   nothing at all. */
const MSGTYPE = {
  text: 'm.text',
  voice: 'm.audio',
  file: 'm.file',
  system: 'm.notice',
  poll: 'm.text',
  announcement: 'm.text',
}
/* a picture is a file whose type says so — Matrix separates them and we do not */
const isImage = (t) => /^image\//i.test(String(t || ''))

const ts = (v) => (v ? Date.parse(v) : 0) || 0

/*
 * ROW → EVENT.
 *
 * `mediaUrl` is a function the caller supplies: it turns an attachment into an `mxc://` content
 * uri. It is passed in rather than built here because minting one needs to know the host, and a
 * pure module that knew the host would not be pure.
 */
/* what the sender said about the picture, kept on meta and never editable */
const imageOf = (row) => (row && row.meta && typeof row.meta === 'object' && row.meta.image) || null

export function toEvent(row, { host, mediaUrl = () => null } = {}) {
  if (!row) return null
  const sender = row.author_id ? userId(row.author_id, host) : userId('00000000-0000-0000-0000-000000000000', host)
  const base = {
    event_id: eventId(row.id),
    room_id: roomId(row.channel_id, host),
    sender,
    origin_server_ts: ts(row.created_at),
    type: 'm.room.message',
    unsigned: {},
  }
  /*
   * A SEALED LINE IS SERVED AS WHAT IT IS. The row's cipher IS a Matrix `m.room.encrypted` content
   * — the algorithm, the ciphertext, the sending device and the session — because that is what our
   * own client put there. Served as `m.room.message` instead, a real client reads a timeline of
   * empty bubbles in a room it has just been told is encrypted, with nothing to say what went
   * wrong; the room looks broken rather than sealed.
   */
  if (row.cipher) return { ...base, type: 'm.room.encrypted', content: row.cipher }

  /* a withdrawn line is a redacted event: Matrix's own shape for "this was here and is gone", so
     a client draws its own placeholder rather than us inventing words for one */
  if (row.deleted_at) {
    return {
      ...base,
      content: {},
      unsigned: { redacted_because: { type: 'm.room.redaction', sender, redacts: base.event_id, origin_server_ts: ts(row.deleted_at), content: {} } },
    }
  }

  const msgtype = row.kind === 'file' && isImage(row.attachment_type) ? 'm.image' : (MSGTYPE[row.kind] || 'm.text')
  const content = { msgtype, body: bodyOf(row) }

  if (row.kind === 'voice' || row.kind === 'file') {
    const url = mediaUrl(row)
    if (url) content.url = url
    const px = imageOf(row)
    content.info = clean({
      mimetype: row.attachment_type || undefined,
      size: row.attachment_size || undefined,
      w: px && Number(px.w) > 0 ? Number(px.w) : undefined,
      h: px && Number(px.h) > 0 ? Number(px.h) : undefined,
      duration: row.seconds ? Math.round(Number(row.seconds) * 1000) : undefined,
    })
    /* a voice note is a voice note, which Matrix says with two marks beside the audio */
    if (row.kind === 'voice') { content['org.matrix.msc3245.voice'] = {}; content['m.voice'] = {} }
  }

  /* a thread hangs off its root; an echoed reply is in the channel too, which Matrix says with
     `is_falling_back` — the same event shown in both places rather than copied into both */
  if (row.thread_root_id) {
    content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: eventId(row.thread_root_id),
      is_falling_back: !!row.echoed,
    }
  }

  /* an edit is a replacement of the original, carrying the new words as the fallback body too so
     a client that does not understand replacements still shows the current text */
  if (row.edited_at) {
    content['m.new_content'] = { msgtype, body: bodyOf(row) }
    content['m.relates_to'] = { ...(content['m.relates_to'] || {}), rel_type: 'm.replace', event_id: base.event_id }
    base.unsigned.edited_ts = ts(row.edited_at)
  }

  /* what is ours and has no Matrix name: the kind as we call it, a poll's options, a title */
  const ours = clean({
    kind: row.kind,
    title: row.title || undefined,
    poll: row.kind === 'poll' && row.meta && row.meta.options ? { options: row.meta.options, closed: !!row.poll_closed_at } : undefined,
    filename: row.attachment_name || undefined,
  })
  if (Object.keys(ours).length) content['site.platformkit'] = ours
  if (row.attachment_name) content.filename = row.attachment_name

  if (row.reply_count) base.unsigned.thread_replies = row.reply_count
  return { ...base, content }
}

/* what a client shows when it understands nothing else about the message */
function bodyOf(row) {
  if (row.kind === 'voice') return row.attachment_name || 'Voice message'
  if (row.kind === 'file') return row.attachment_name || 'File'
  if (row.kind === 'poll' && row.title) return row.title
  return row.body || row.title || ''
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

/*
 * EVENT → THE ARGUMENTS OF A WRITE.
 *
 * Answers `{ ok, row }` or `{ ok: false, why }`. It never writes and never validates permission —
 * that is the database's, through the same policies the browser meets. What it does is refuse a
 * shape we do not store, so that an unsupported event is a clear no rather than a row with its
 * meaning quietly dropped.
 *
 * A BODY BEGINNING WITH A SLASH IS A MESSAGE. Slash commands are drawn as controls and their
 * prompt is the file's; a client that can only type `/name a b c` is typing a grammar, which this
 * platform refuses everywhere. So nothing is parsed out of it and it is stored as the words it is.
 */
export function fromEvent(ev, { channelId, media = null, sealed = false } = {}) {
  if (!ev || typeof ev !== 'object') return { ok: false, why: 'no event' }
  const c = ev.content || {}
  /*
   * A CIPHERTEXT IS TAKEN IN A SEALED ROOM AND REFUSED EVERYWHERE ELSE, and a plaintext is refused
   * IN one. Both halves matter and the second is the one that would be missed: a client that sends
   * a plain message into a room it has been told is encrypted would write words into a timeline
   * everybody else is sealing, and nothing about the room would look wrong afterwards.
   */
  if (ev.type === 'm.room.encrypted') {
    if (!sealed) return { ok: false, why: 'not-sealed' }
    return { ok: true, replaces: null, row: { channel_id: channelId, kind: 'text', cipher: c } }
  }
  if (sealed) return { ok: false, why: 'must-seal' }
  if (ev.type && ev.type !== 'm.room.message') return { ok: false, why: 'type' }

  const rel = c['m.relates_to'] || {}
  const thread = rel.rel_type === 'm.thread' ? readEvent(rel.event_id) : null
  const replaces = rel.rel_type === 'm.replace' ? readEvent(rel.event_id) : null

  /* an edit carries the new words under m.new_content; the top-level body is a fallback and
     usually begins with an asterisk, which is a client's convention and not our text */
  const words = replaces && c['m.new_content'] ? c['m.new_content'].body : c.body

  const kind = c.msgtype === 'm.audio' && (c['m.voice'] || c['org.matrix.msc3245.voice']) ? 'voice'
    : c.msgtype === 'm.image' || c.msgtype === 'm.file' || c.msgtype === 'm.video' || c.msgtype === 'm.audio' ? 'file'
      : 'text'

  if (kind === 'text' && !String(words || '').trim()) return { ok: false, why: 'empty' }
  if (kind !== 'text' && !media) return { ok: false, why: 'no file' }

  return {
    ok: true,
    replaces: replaces ? replaces.id : null,
    row: clean({
      channel_id: channelId,
      kind,
      body: kind === 'text' ? String(words) : (String(words || '').trim() || null),
      thread_root_id: thread ? thread.id : undefined,
      attachment: media ? media.path : undefined,
      attachment_type: media ? media.type : undefined,
      attachment_name: media ? media.name : undefined,
      attachment_size: media ? media.size : undefined,
      seconds: media && media.seconds ? media.seconds : undefined,
    }),
  }
}
