/*
 * A ROOM'S STATE, AND WHY ITS POWER LEVELS ARE READ-ONLY.
 *
 * Matrix keeps a room's name, topic, membership and permissions as "state events". We keep the
 * same facts in `channels`, `space_members` and `space_grants`, so this is a projection of rows
 * a client can read and — for the permissions — one it may not write.
 *
 * POWER LEVELS ARE DERIVED. Matrix's model is a number per person and a number required per
 * action; ours is a capability granted by a rule (`space_grants`: to a tier, a product, a role, a
 * person, at the site, the space or the channel). The two do not correspond, and the direction
 * matters: a grant can be made by buying something, and Matrix has no idea what that means.
 *
 * So the numbers are computed from the grants and refused as a write. Letting a client set a
 * power level would put a second, weaker way to grant moderation beside the one the admin uses,
 * and it is the weaker one an attacker would reach for. A moderator added in the admin appears
 * here on the next sync; nothing here can add one.
 *
 * The numbers themselves are the conventional ones, so that a client's own interface — which
 * hides a button at 50, greys one at 100 — behaves the way its users expect:
 *
 *   0    a member who may write
 *   25   may attach a file, or speak (our `file` and `voice` capabilities)
 *   50   moderator (Matrix's own convention for one)
 *   100  administrator
 *
 * Pure: rows in, JSON out, no database and no environment.
 */

import { roomId, spaceId, userId } from './ids.js'

export const LEVEL = { member: 0, attach: 25, moderator: 50, admin: 100 }

/* which capability lifts somebody to which number. `moderate` is the only one Matrix has a real
   idea about; the rest are ours and sit below its moderator line on purpose, so that a client
   never draws a moderator's controls for somebody who may merely attach a picture. */
const FROM_CAPABILITY = {
  moderate: LEVEL.moderator,
  announce: LEVEL.moderator,
  invite: LEVEL.attach,
  voice: LEVEL.attach,
  file: LEVEL.attach,
  'mention-channel': LEVEL.attach,
}

/*
 * The levels for one room. `holders` is [{ user_id, capabilities: [...] , admin?: bool }] — worked
 * out by the caller against the grants, because resolving a grant means knowing somebody's tier
 * and purchases, which is a query and not arithmetic.
 */
export function powerLevels(holders, { host } = {}) {
  const users = {}
  for (const h of holders || []) {
    if (!h || !h.user_id) continue
    const n = h.admin ? LEVEL.admin : Math.max(0, ...(h.capabilities || []).map((c) => FROM_CAPABILITY[c] || 0))
    if (n > 0) users[userId(h.user_id, host)] = n
  }
  return {
    users,
    users_default: LEVEL.member,
    events_default: LEVEL.member,
    state_default: LEVEL.admin,      /* nothing here is set from a client */
    ban: LEVEL.moderator,
    kick: LEVEL.moderator,
    redact: LEVEL.moderator,
    invite: LEVEL.attach,
    events: {
      'm.room.name': LEVEL.admin,
      'm.room.topic': LEVEL.admin,
      'm.room.avatar': LEVEL.admin,
      'm.room.power_levels': LEVEL.admin,
      'm.room.history_visibility': LEVEL.admin,
      /* SET BY THE DECLARATION, NEVER BY A CLIENT. A room is sealed because its file says so, so
         the level is the one no client holds — the event is emitted below for a channel whose
         `encrypted` column the compile wrote, and a client asking to set it is refused like any
         other state. (It used to be refused outright, before a channel could be sealed at all.) */
      'm.room.encryption': LEVEL.admin,
      'm.room.message': LEVEL.member,
      'm.reaction': LEVEL.member,
    },
  }
}

/* the state events of a channel: what it is called, what it is about, who may do what */
export function roomState(channel, { host, holders = [], members = [], creator = null } = {}) {
  const id = roomId(channel.id, host)
  const at = Date.parse(channel.created_at || 0) || 0
  const ev = (type, content, stateKey = '') => ({
    type, state_key: stateKey, content, room_id: id, origin_server_ts: at,
    sender: userId(creator || channel.created_by || '00000000-0000-0000-0000-000000000000', host),
    event_id: `$state_${type}_${stateKey}_${channel.id}`,
  })
  const out = [
    ev('m.room.create', { creator: userId(creator || channel.created_by || '00000000-0000-0000-0000-000000000000', host), room_version: '10' }),
    ev('m.room.name', { name: channel.name || channel.slug || 'Room' }),
    ev('m.room.power_levels', powerLevels(holders, { host })),
    /* WHAT AN ARRIVING MEMBER MAY READ. `shared` is Matrix's word for "everything since the room
       became shared-history", which is what our rooms are: somebody who joins a channel reads it
       from the beginning, as they do in our own client. */
    ev('m.room.history_visibility', { history_visibility: 'shared' }),
    ev('m.room.join_rules', { join_rule: 'invite' }),   /* membership is the space's rule, never a client's request */
    ev('m.room.guest_access', { guest_access: 'forbidden' }),
  ]
  if (channel.topic) out.push(ev('m.room.topic', { topic: channel.topic }))
  /*
   * AND WHETHER IT IS SEALED. This is the one event that changes what a Matrix client DOES rather
   * than what it shows: Element seeing it will encrypt every message it sends here and refuse to
   * send a plain one, which is exactly what we want — a client that did not know would post the
   * plaintext into a room everybody else is sealing.
   *
   * The rotation numbers are Matrix's own defaults, said out loud rather than left out: a megolm
   * session is replaced after a week or a hundred messages, so somebody who leaves the room stops
   * being able to read it within that bound rather than forever.
   */
  if (channel.encrypted) {
    out.push(ev('m.room.encryption', {
      algorithm: 'm.megolm.v1.aes-sha2',
      rotation_period_ms: 604800000,
      rotation_period_msgs: 100,
    }))
  }
  for (const m of members) {
    out.push(ev('m.room.member', {
      membership: 'join',
      displayname: m.name || undefined,
      avatar_url: m.avatar_mxc || undefined,
    }, userId(m.user_id, host)))
  }
  return out
}

/*
 * A SPACE IS A ROOM WHOSE CHILDREN ARE ITS CHANNELS. This is the whole of what makes a client
 * show the site's own arrangement rather than a flat list of rooms, and it is three state events.
 */
export function spaceState(space, channels, { host, viewer = null } = {}) {
  const viewerId = viewer ? (String(viewer).startsWith('@') ? String(viewer) : userId(viewer, host)) : null
  const id = spaceId(space.id, host)
  const at = Date.parse(space.created_at || 0) || 0
  const ev = (type, content, stateKey = '') => ({
    type, state_key: stateKey, content, room_id: id, origin_server_ts: at,
    sender: userId('00000000-0000-0000-0000-000000000000', host),
    event_id: `$state_${type}_${stateKey}_${space.id}`,
  })
  const out = [
    ev('m.room.create', { type: 'm.space', room_version: '10', creator: userId('00000000-0000-0000-0000-000000000000', host) }),
    ev('m.room.name', { name: space.name || space.slug || 'Space' }),
    ev('m.room.join_rules', { join_rule: 'invite' }),
  ]
  /* the viewer's own membership: without it a client has a room it is not in, and will not
     draw the space at all — which is how the site's arrangement went missing in Element while
     every channel showed up loose underneath it */
  if (viewerId) out.push({
    type: 'm.room.member', state_key: viewerId, content: { membership: 'join' }, room_id: id,
    origin_server_ts: at, sender: viewerId, event_id: `$state_member_${space.id}`,
  })
  for (const c of channels || []) {
    out.push(ev('m.space.child', { via: [host], order: String(c.position ?? 99).padStart(4, '0'), suggested: false }, roomId(c.id, host)))
  }
  return out
}

/* what a client may set, which is nothing. Named so the function has one list rather than a
   condition per endpoint, and so the refusal can say which thing it was. */
export const READ_ONLY_STATE = {
  'm.room.power_levels': 'Who may do what',
  'm.room.name': "A room's name",
  'm.room.topic': "A room's topic",
  'm.room.avatar': "A room's picture",
  'm.room.join_rules': 'Who may join',
  'm.room.history_visibility': 'What an arriving member may read',
  'm.room.encryption': 'Encryption',
  'm.space.child': 'Which rooms a space holds',
}
