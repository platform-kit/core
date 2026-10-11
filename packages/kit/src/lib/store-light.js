/*
 * The store's shape without the store: get / set / del over plain localStorage, for the form embed
 * (build/form-embed.mjs aliases lib/store.js to this), which runs on another site's page and must
 * not carry the CRDT and its wasm — a guest's anonymous id and nothing else is kept there. Never
 * used on the site itself.
 */
const KEY = 'pk.embed'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)) } catch { /* private mode */ } }
export function get(key) { const v = read()[key]; return v === undefined ? null : v }
export function set(key, value) { const o = read(); o[key] = value; write(o) }
export function del(key) { const o = read(); delete o[key]; write(o) }
export async function reset() { try { localStorage.removeItem(KEY) } catch { /* private */ } }
export const ready = Promise.resolve()
export function loroDoc() { return null }
export function onCommit() { return () => {} }
export function onReconcile() { return () => {} }
export function reconcileFromDoc() {}
export function b64ToBytes() { return new Uint8Array() }
export function bytesToB64() { return '' }
export const STORE = { get, set }
