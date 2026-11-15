/*
 * Print, as the build and the functions reach it (openspec: modules-as-packages): the wording a printed edition is
 * named with, and the folder its function code and templates are bundled from.
 */
import { fileURLToPath } from 'node:url'
export { printWords, SPINE_EDITION } from './words.mjs'
export const PRINT_BUILD = fileURLToPath(new URL('.', import.meta.url))
