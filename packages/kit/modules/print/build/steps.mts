/* print's build steps, each placed in the kit's list where it stood (print#print, print#print-type, print#lulu-webhook) */
import print from './steps/print.mjs'
import printType from './steps/print-type.mjs'
import luluWebhook from './steps/lulu-webhook.mjs'
export default [print, printType, luluWebhook]
