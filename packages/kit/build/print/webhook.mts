#!/usr/bin/env node
/*
 * The printer's webhook, registered once: Lulu POSTs PRINT_JOB_STATUS_CHANGED to
 * <functions>/lulu-webhook, and this makes sure a subscription to that url exists
 * (listing the account's webhooks, creating one when none has the url, re-activating
 * one the printer switched off after failures). build/deploy.mjs runs it when the
 * printer's keys are set; `node build/print/webhook.mjs --url <url>` does it by hand.
 */
import { printer } from './suppliers.mjs'
import { isMain } from '../is-main.mjs'

export async function ensureWebhook(url: string, id = 'lulu') {
  const p = printer(id)
  if (p.mock()) { console.log(`${p.name} webhook: mocked, nothing registered`); return null }
  const r = await p.ensureWebhook(url)
  console.log(r ? `${p.name} webhook: ${url} is registered` : `${p.name} webhook: none needed`)
  return r
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--url'), url = i > 0 ? process.argv[i + 1] : ''
  if (!url) { console.error('usage: node build/print/webhook.mjs --url https://<ref>.supabase.co/functions/v1/lulu-webhook'); process.exit(1) }
  const { loadDotEnv } = await import('../tts/storage.mjs'); loadDotEnv()
  await ensureWebhook(url)
}
