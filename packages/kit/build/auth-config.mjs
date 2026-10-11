#!/usr/bin/env node
/*
 * The hosted Supabase project's auth settings, written from the deploy's
 * environment through the management API — one targeted PATCH, never a whole
 * `config push` (which would carry local-only settings across):
 *
 *   - where the site is: Site URL = the app's address, and <address>/** on the
 *     redirect allow list (what is already there is kept). A project is born
 *     with Site URL http://localhost:3000, and nothing else changes that, so
 *     until this ran every confirmed reader was sent to localhost.
 *   - addresses confirmed at sign-up (mailer autoconfirm): confirmation is the
 *     app's own — a magic link that proves the address for the results
 *     (migration 20260914140000) — so a new reader has a session at once.
 *   - the mail: Supabase's built-in sender is for development (a few emails an
 *     hour, from its own domain); with SMTP_HOST / SMTP_PORT / SMTP_USER /
 *     SMTP_PASS / SMTP_FROM set — the same values chat-notify sends with — the
 *     auth emails go out through that relay, from that address. Unset, the
 *     built-in sender stays and this says so.
 *   - the emails it sends — the address's confirmation (the magic link), the
 *     password reset, and a recipient-bound social-publisher invitation — as designs
 *     built under admin → Emails, compiled by
 *     build/emails.mjs (run first) with Supabase's own tokens intact, and their
 *     subjects from content/app/ui/emails.md.
 *
 * Run by build/deploy.mjs, or alone with the same values:
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROD_REF=… VITE_APP_URL=https://… node build/auth-config.mjs
 * `--dry` prints what would be written (the password masked) and writes nothing.
 */
import { readFileSync, existsSync } from 'node:fs'

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = { ...loadEnvFile('.env.production'), ...process.env }
const DRY = process.argv.includes('--dry')
const die = (msg) => { console.error(`\n✖ auth config: ${msg}\n`); process.exit(1) }

const token = env.SUPABASE_ACCESS_TOKEN || ''
const ref = env.SUPABASE_PROD_REF || ''
const site = (env.APP_URL || env.VITE_APP_URL || '').replace(/\/+$/, '')
if (!DRY && !token) die('SUPABASE_ACCESS_TOKEN is unset')
if (!DRY && !/^[a-z]{20}$/.test(ref)) die(`SUPABASE_PROD_REF "${ref}" is not a project ref`)
if (!/^https:\/\/[^/\s]+$/.test(site)) die(`APP_URL / VITE_APP_URL "${site || '(unset)'}" must be the site's https origin, nothing after the host`)

/* ---- the two emails it sends: the compiled designs, with Supabase's tokens intact, and their subjects ---- */
const { emailWords } = await import('./chat-email-strings.mjs')
const W = await emailWords()
let compiled = {}
try { compiled = JSON.parse(readFileSync('supabase/functions/_shared/emails/compiled.json', 'utf8')) } catch (e) { die('no compiled emails — node build/emails.mjs first') }
for (const k of ['magic-link', 'recovery', 'invitation']) {
  if (!compiled[k]) die(`no compiled "${k}" design — build it under admin → Emails, then node build/emails.mjs`)
  if (!compiled[k].includes('{{ .ConfirmationURL }}')) die(`the "${k}" design has no button to {{ .ConfirmationURL }} — the reader would have no link`)
  if (!(W[k] && W[k].subject)) die(`content/app/ui/emails.md has no "## ${k}" subject`)
}

/* ---- the mail relay, when the deploy has one ---- */
const SMTP = { host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 0), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.SMTP_FROM || '' }
const smtpOn = !!(SMTP.host && SMTP.port && SMTP.user && SMTP.pass && SMTP.from)
/* "A Site <hello@example.com>" → a name and an address; a bare address is its own name */
const fromM = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(SMTP.from)
const sender = { name: (fromM ? fromM[1] : '').trim() || (SMTP.from.split('@')[0]), email: (fromM ? fromM[2] : SMTP.from).trim() }
if (smtpOn && !/^[^@\s]+@[^@\s]+$/.test(sender.email)) die(`SMTP_FROM "${SMTP.from}" is not an address (or "Name <address>")`)

/* ---- what the project should say ---- */
const API = `https://api.supabase.com/v1/projects/${ref}/config/auth`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
let now = {}
if (!DRY) {
  const cur = await fetch(API, { headers })
  if (!cur.ok) die(`reading the auth config: ${cur.status} ${(await cur.text()).slice(0, 200)}`)
  now = await cur.json()
}
const list = String(now.uri_allow_list || '').split(',').map((s) => s.trim()).filter(Boolean)
if (!list.includes(site + '/**')) list.push(site + '/**')

const next = {
  site_url: site,
  uri_allow_list: list.join(','),
  mailer_autoconfirm: true,
  mailer_subjects_magic_link: W['magic-link'].subject,
  mailer_templates_magic_link_content: compiled['magic-link'],
  mailer_subjects_recovery: W.recovery.subject,
  mailer_templates_recovery_content: compiled.recovery,
  mailer_subjects_invite: W.invitation.subject,
  mailer_templates_invite_content: compiled.invitation,
  ...(smtpOn ? { smtp_host: SMTP.host, smtp_port: String(SMTP.port), smtp_user: SMTP.user, smtp_pass: SMTP.pass, smtp_admin_email: sender.email, smtp_sender_name: sender.name } : {}),
}
/* only what differs — the password is never returned, so it is sent whenever SMTP is on */
const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => k === 'smtp_pass' || String(now[k] ?? '') !== String(v)))
const shown = (o) => JSON.stringify({ ...o, ...(o.smtp_pass ? { smtp_pass: '••••' } : {}), ...(o.mailer_templates_magic_link_content ? { mailer_templates_magic_link_content: '(html, ' + o.mailer_templates_magic_link_content.length + ' chars)' } : {}), ...(o.mailer_templates_recovery_content ? { mailer_templates_recovery_content: '(html, ' + o.mailer_templates_recovery_content.length + ' chars)' } : {}), ...(o.mailer_templates_invite_content ? { mailer_templates_invite_content: '(html, ' + o.mailer_templates_invite_content.length + ' chars)' } : {}) }, null, 2)

if (DRY) { console.log('› auth config, dry run — would write:\n' + shown(next)); process.exit(0) }
if (!Object.keys(changed).length) console.log(`› auth config already set: site ${site}, redirects ${next.uri_allow_list}, addresses confirmed at sign-up, ${smtpOn ? 'mail through ' + SMTP.host : 'the built-in sender (no SMTP_* set)'}`)
else {
  const res = await fetch(API, { method: 'PATCH', headers, body: JSON.stringify(changed) })
  if (!res.ok) die(`setting the auth config: ${res.status} ${(await res.text()).slice(0, 200)}`)
  console.log(`› auth config set: ${Object.keys(changed).join(', ')}`)
  console.log(`  site ${now.site_url || '(unset)'} → ${site}; redirects ${next.uri_allow_list}; addresses confirmed at sign-up; ${smtpOn ? 'mail through ' + SMTP.host + ' as ' + sender.email : 'the built-in sender — set SMTP_* in the deploy environment for production mail'}`)
}
if (!smtpOn) console.log('  ⚠ auth emails go through Supabase\'s built-in sender: a few an hour, from its domain. Not for production — set SMTP_HOST/PORT/USER/PASS/FROM.')

/* ---- the proof, without an email: the verify endpoint's redirect names the Site URL.
   The auth server picks a change up a few seconds after it is written, so this
   looks again for up to a minute; a setting that was already right answers at once. ---- */
const base = (env.VITE_SUPABASE_URL || `https://${ref}.supabase.co`).replace(/\/+$/, '')
const landing = async () => {
  const probe = await fetch(`${base}/auth/v1/verify?token=x&type=signup`, { redirect: 'manual' })
  return (probe.headers.get('location') || '').split('#')[0]
}
let to = await landing()
for (let waited = 0; !to.startsWith(site) && waited < 60; waited += 5) {
  await new Promise((r) => setTimeout(r, 5000))
  to = await landing()
}
if (!to.startsWith(site)) die(`the verify endpoint still redirects to "${to}" a minute after the change — expected ${site}`)
console.log(`✔ a confirmation link now lands on ${to}`)
