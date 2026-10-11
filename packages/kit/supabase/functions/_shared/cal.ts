/*
 * The seam's Deno binding: the schedulers bound to this stack's service-role client and
 * environment, and cal.com's own calls re-exported under their old names for what still asks for
 * them by name (the webhook's cancel, the recordings pull). The site's own part of a session —
 * the judge, the credits, the mirror, the week of chat — is ./sessions.ts; nothing new imports
 * cal.com from here.
 */
import { admin } from './lib.ts'
import { schedulers, schedulerIdOf } from './schedulers/index.js'
import { videos, videoIdOf } from './video/index.js'
export { schedulerIdOf, SCHEDULER_IDS } from './schedulers/index.js'
export { videoIdOf, VIDEO_IDS } from './video/index.js'
export * from './sessions.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
export const { SCHEDULERS, scheduler, schedulerOf } = schedulers({ db: admin, env })
/* the video rooms behind their own seam: a provider for the one kind of place that is a room on this site */
export const { VIDEO, video, videoOf } = videos({ db: admin, env })
export const CAL = SCHEDULERS.cal as any

export type CalRecording = { id: string | number; url: string; startTs: number; duration: number; status: string }
export type CalTranscript = { format: string; url: string }
export const recordingsOf = (uid: string, base?: string): Promise<CalRecording[]> => CAL.recordingsOf(uid, base)
export const transcriptsOf = (uid: string, base?: string): Promise<CalTranscript[]> => CAL.transcriptsOf(uid, base)
export const cancel = (uid: string, reason: string) => CAL.cancel(uid, 'app', reason)
