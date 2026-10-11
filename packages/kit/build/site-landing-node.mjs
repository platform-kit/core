/* #site/landing under Node: no skins, no section components and no stage components (the browser's), but the
   site's section schemas and its stages' schemas, which the admin server validates a page against
   (platformkit.config.js landing.schemas: SECTION_SCHEMAS, and STAGE_SCHEMAS for the hero's visual) */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSite } from './site.mjs'
export const SKINS_BY_LOOK = {}
export const SECTIONS = {}
export const STAGES = {}
const c = await loadSite()
const M = c.landing && c.landing.schemas ? await import(/* @vite-ignore */ pathToFileURL(path.resolve(c.root, c.landing.schemas)).href) : {}
export const SECTION_SCHEMAS = M.SECTION_SCHEMAS || {}
export const STAGE_SCHEMAS = M.STAGE_SCHEMAS || {}
