/*
 * MARKETING MAIL: WHO IT GOES TO, AND THAT IT GOES ONCE.
 *
 * Three scenarios that shared a shape — "NOT VERIFIED by a pinned test" — and share a cost. Every
 * one of them is about sending a real email to a real person, and every failure is the kind you
 * cannot take back: the same email twice, an email to somebody the audience never meant, or a
 * sign-in email with no link in it.
 *
 *   THE AUDIENCE is one rule set written in markdown and read by the build, the admin and the
 *   functions. A rule key nobody recognises must be DROPPED, not passed through: a rule that
 *   silently became no rule is an audience that silently became everybody.
 *
 *   AN EMAIL'S IDENTITY is a uuid written into the markdown once and never edited, and the log is
 *   keyed on it. It is what makes "once, ever" survive a funnel being renamed, its steps being
 *   reordered, or a blast being made again under another name — so what is pinned is that the id
 *   SURVIVES those things, which is the only property that matters.
 *
 *   THE SIGN-IN EMAIL is not filled by us: its link is Supabase's own token, left exactly as
 *   written. A design that lost it would compile, deploy, and send a perfectly rendered email that
 *   nobody can sign in from.
 *
 * Run alone:  node packages/kit/build/marketing.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RULE_KEYS, normalizeRules, describeRules, span } from '../supabase/functions/_shared/emails/rules.js'
import { keyed, serialiseFunnel, parseFunnel } from './funnel-io.mjs'

const ROOT = process.cwd()
let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }

/* ─── the audience ─── */

t('every rule key the writers may use is one the reader knows', () => {
  assert.ok(RULE_KEYS.length > 0)
  assert.equal(new Set(RULE_KEYS).size, RULE_KEYS.length, 'a key is listed twice')
})
/* the one that matters: a typo must not become "everybody" */
t('a rule nobody recognises is dropped, not passed through', () => {
  assert.deepEqual(normalizeRules({ nonsense: 'x' }), {})
  assert.deepEqual(normalizeRules({ inactve: '7d+' }), {}, 'a misspelt key was kept')
})
t('and a recognised rule beside an unrecognised one survives alone', () => {
  const r = normalizeRules({ inactive: '7d+', nonsense: 'x' })
  assert.deepEqual(Object.keys(r), ['inactive'])
})
t('a span is read as a number of days', () => {
  assert.deepEqual(span('3d'), { min: 3 })
  assert.deepEqual(normalizeRules({ inactive: '7d+' }), { inactive: { min: 7 } })
})
t('no rules at all is an audience of everybody, and says so', () => {
  assert.deepEqual(normalizeRules({}), {})
  assert.deepEqual(normalizeRules(null), {})
})
t('every rule can be described back in words, so the admin never shows its grammar', () => {
  for (const k of RULE_KEYS) {
    const said = describeRules(normalizeRules({ [k]: k === 'verified' ? true : k === 'inactive' || k === 'signed-up' || k === 'since-purchase' || k === 'since-session' ? '7d+' : ['x'] }))
    assert.ok(said != null, `${k} describes as ${JSON.stringify(said)}`)
  }
})

/* ─── an email's identity ─── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

t('a step with no id is given one', () => {
  const id = keyed(undefined)
  assert.match(id, UUID)
})
t('a step that has one keeps it, whatever the case', () => {
  const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  assert.equal(keyed(id), id)
  assert.equal(keyed(id.toUpperCase()), id)
})
t('something that is not a uuid is replaced rather than trusted', () => {
  assert.notEqual(keyed('step-one'), 'step-one')
  assert.match(keyed('step-one'), UUID)
})
/* THE PROPERTY: rename the funnel, reword the step, move it — the id does not move, because the
   log is keyed on it and a new id means somebody gets an email they have already had */
t('the id survives a rename, a reword and a reorder', () => {
  const a = { title: 'Step one', id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', after: '0d', subject: 'Hello', body: 'Hi.' }
  const b = { title: 'Step two', id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', after: '3d', subject: 'Again', body: 'Hi again.' }
  const once = serialiseFunnel({ title: 'Welcome', published: true }, [a, b])
  const back = parseFunnel(once)
  assert.deepEqual(back.steps.map((s) => s.id), [a.id, b.id])

  /* now renamed, reworded and reordered — the ids must be exactly the same two */
  const again = serialiseFunnel({ title: 'A Completely Different Name', published: true },
    [{ ...b, subject: 'Rewritten' }, { ...a, title: 'Renamed' }])
  const back2 = parseFunnel(again)
  assert.deepEqual(back2.steps.map((s) => s.id), [b.id, a.id], 'an id moved with the words')
})
t('a step written without an id gets a stable one on the first save', () => {
  const out = serialiseFunnel({ title: 'F' }, [{ title: 'S', after: '0d', subject: 'x', body: 'y' }])
  const id = parseFunnel(out).steps[0].id
  assert.match(id, UUID)
  /* and it is kept on the next save rather than re-rolled */
  const out2 = serialiseFunnel({ title: 'F' }, parseFunnel(out).steps)
  assert.equal(parseFunnel(out2).steps[0].id, id)
})

/* ─── the sign-in email keeps Supabase's own link ─── */

const COMPILED = path.join(ROOT, 'supabase', 'functions', '_shared', 'emails', 'compiled.json')
if (!fs.existsSync(COMPILED)) console.log('  ⚠ no compiled emails — the sign-in link is not checked in this run')
else {
  const compiled = JSON.parse(fs.readFileSync(COMPILED, 'utf8'))
  for (const k of ['magic-link', 'recovery', 'invitation']) {
    t(`the ${k} design links to Supabase's own token`, () => {
      assert.ok(compiled[k], `no compiled "${k}" design`)
      assert.ok(compiled[k].includes('{{ .ConfirmationURL }}'), 'the reader would have no link')
    })
  }
  /* and the guard that is supposed to catch it, run for real against a design that lost the link */
  t('auth-config refuses a design whose button goes elsewhere', () => {
    const backup = fs.readFileSync(COMPILED, 'utf8')
    const broken = JSON.parse(backup)
    broken.invitation = String(broken.invitation).split('{{ .ConfirmationURL }}').join('https://example.com/somewhere-else')
    fs.writeFileSync(COMPILED, JSON.stringify(broken))
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(new URL('./auth-config.mjs', import.meta.url)), '--dry'], {
        cwd: ROOT, encoding: 'utf8',
        env: { ...process.env, APP_URL: 'https://example.com', VITE_APP_URL: 'https://example.com' },
      })
      assert.notEqual(r.status, 0, 'the deploy would have shipped a sign-in email with no link in it')
      assert.match(String(r.stdout) + String(r.stderr), /ConfirmationURL/)
    } finally { fs.writeFileSync(COMPILED, backup) }
  })
  t('and passes with the link in place', () => {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./auth-config.mjs', import.meta.url)), '--dry'], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, APP_URL: 'https://example.com', VITE_APP_URL: 'https://example.com' },
    })
    assert.equal(r.status, 0, String(r.stdout) + String(r.stderr))
  })
}

console.log(bad ? `marketing: ${n - bad} passed, ${bad} failed` : `marketing: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
