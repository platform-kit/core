/*
 * The video rooms, one module each behind one shape, shared by the functions (Deno) and the kit's tests
 * (node) — plain JavaScript. A booking type says where it happens; for the one kind that is a video room
 * on this site (`where.kind === 'video'`) a provider makes the room, admits the people on the booking,
 * records it and says when it started and ended. A session in person, by phone, on a link or nowhere
 * has no provider and is never touched by any of this. `videos({ db, env })` binds them and gives:
 *
 *   VIDEO             { livekit, 'cal-video' } — every provider known
 *   video(id)         one of them, or a throw naming the id
 *   videoIdOf(type, env)  the provider a type gets: cal-video for a cal.com type; for a native
 *                     video-room type the site's own — livekit where the site has an account, the mesh
 *                     (browser to browser, no account, not recorded, five people) where it has none;
 *                     null for every other kind
 *   videoOf(type)     the module, or null
 *
 * A provider:
 *   id, configured(), mock()
 *   room(booking)                       → { join_url, ref }   the address the row's Join opens, the provider's own name for the room
 *   admit(booking, person, role)        → { url, token, ttl }  credentials for that person and that booking alone (the host's with the room's controls)
 *   record(booking)  end(booking)       start the recording; end the room for everyone
 *   event(req)                          → { kind: started | ended | recording, ref, path?, error? } | null   from the provider's signed notification
 */
import { livekit } from './livekit.js'
import { calVideo } from './cal-video.js'
import { mesh } from './mesh.js'

/* the choice is its own module: pure, and read by the kit's tests under Node, which cannot import
   this file because a provider here reaches for a Deno-only package */
export { VIDEO_IDS, videoIdOf, hasVideoAccount } from './choose.js'
import { videoIdOf } from './choose.js'

export function videos({ db, env, ice }) {
  const VIDEO = { livekit: livekit({ db, env }), 'cal-video': calVideo({ env }), mesh: mesh({ db, env, ice }) }
  const video = (id) => { const v = VIDEO[id]; if (!v) throw new Error('no video provider named ' + id); return v }
  const videoOf = (type) => { const id = videoIdOf(type, env); return id ? video(id) : null }
  return { VIDEO, video, videoOf }
}
