/*
 * The way into a booking's video room, from the client: session-room admits the person for that
 * booking alone (the token minted there, never a link), and the host may start the recording or
 * end the room for everyone. The call page (CallPage.vue) is the one caller.
 */
import { supabase } from './supabase.js'

async function call(body) {
  const { data, error } = await supabase.functions.invoke('session-room', { body })
  if (error) { let msg = error.message || 'request failed', code = '', extra = {}; try { const j = await error.context.json(); if (j && j.error) { msg = j.error; code = j.code || ''; extra = j } } catch (e) { /* no body */ } const e = new Error(msg); e.code = code; e.status = error.context ? error.context.status : 0; Object.assign(e, extra); throw e }
  if (data && data.error) { const e = new Error(data.error); e.code = data.code || ''; throw e }
  return data
}
export const admit = (uid) => call({ uid, action: 'admit' })
export const startRecording = (uid) => call({ uid, action: 'record' })
export const endRoom = (uid) => call({ uid, action: 'end' })
