/*
 * Cal Video: the room cal.com attaches to a booking it schedules. Nothing to make or admit — cal.com's
 * own emails carry the link, its own page holds the call — and the recording is pulled after the fact
 * by _shared/recordings.ts through cal.com's API (the scheduler's recordingsOf / transcriptsOf).
 */
import { cal } from '../schedulers/cal.js'
export function calVideo({ env }) {
  const api = cal(env)
  return {
    id: 'cal-video',
    configured: () => api.configured(),
    mock: () => false,
    room: (b) => ({ join_url: b.join_url || null, ref: null }),
    admit: () => null,
    record: async () => ({ started: false }),
    end: async () => {},
    event: () => null,
    recordingsOf: api.recordingsOf, transcriptsOf: api.transcriptsOf,
  }
}
