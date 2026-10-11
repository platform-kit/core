/* a build output written only when its bytes differ — the functions tree is watched by the served edge
   runtime, and a rewrite of the same bytes would restart it for nothing (and drop a request mid-flight) */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
export function writeIfChanged(file, text) {
  let cur = null
  try { cur = readFileSync(file, 'utf8') } catch { /* new */ }
  if (cur === text) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return true
}
