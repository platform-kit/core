/*
 * Events, as the build and the functions reach them (openspec: modules-as-packages): the calendar compiled from its files,
 * projected into the database, and the scripts that do it.
 */
import { fileURLToPath } from 'node:url'
export { compileEvents } from './events.mjs'
export { projectEvents, projectEventComments } from './events-db.mjs'
export const EVENTS_PUSH = fileURLToPath(new URL('./events-push.mjs', import.meta.url))
