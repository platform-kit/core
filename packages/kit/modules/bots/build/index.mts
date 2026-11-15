/*
 * Bots, as the build and the functions reach them (openspec: modules-as-packages): the bots, tools and commands
 * compiled from their files, projected into the database, and the script that does it.
 */
import { fileURLToPath } from 'node:url'
export { compileBots, readBots, readSkills, SURFACES } from './bots.mjs'
export { projectBots } from './bots-db.mjs'
export const BOTS_PUSH = fileURLToPath(new URL('./bots-push.mjs', import.meta.url))
