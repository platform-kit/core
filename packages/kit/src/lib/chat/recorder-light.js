/*
 * The recorder's shape without the recorder, for the support snippet on another site (build/support-sdk.mjs aliases
 * lib/chat/recorder.js to this): no voice notes off the site — the encoder and its worker stay here — so the mic is
 * never usable and the composer shows no microphone. Never used on the site itself.
 */
export function micUsable() { return false }
export function createRecorder() { throw new Error('voice notes are the site\'s own') }
