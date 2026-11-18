/*
 * Bots, as the build and the functions reach them (openspec: modules-as-packages): the bots, tools and commands
 * compiled from their files, projected into the database, and the script that does it.
 */
import { fileURLToPath } from 'node:url'
export { compileBots, readBots, readSkills, SURFACES } from './bots.mjs'
export { projectBots } from './bots-db.mjs'
/* off an export line: the Supabase CLI reads a quoted path on one as an import (build/pipe-closure.mts) */
const BOTS_PUSH = fileURLToPath(new URL('./bots-push.mjs', import.meta.url))
export { BOTS_PUSH }
