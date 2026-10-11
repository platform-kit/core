/* #site/looks under Node: the names alone (the css is the browser's) */
import { loadSite } from './site.mjs'
const c = await loadSite()
export const LOOKS = Object.keys(c.looks)
export const DEFAULT_LOOK = c.defaultLook
