/* the printers, bound to this process's environment (the modules are shared with the functions) */
import { printers, PRINTER_IDS, FORMATS_PRINTED } from '../../supabase/functions/_shared/suppliers/index.js'
import { loadDotEnv } from '../tts/storage.mjs'
loadDotEnv()   /* the keys from .env, for a process that has not read it (the admin server) */
const P = printers((k) => process.env[k] || '')
export const PRINTERS = P.PRINTERS
export const printer = P.printer
export const providersFor = P.providersFor
export { PRINTER_IDS, FORMATS_PRINTED }
