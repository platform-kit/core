import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { MODULES } from './modules/kit.mjs'
import { readManifests, readManifest } from './modules/manifest.mjs'
import { activeCronJobs, assertNoManualCron, cronSql } from './cron.mjs'
import { loadSite } from './site.mjs'
import { moduleSet } from './steps.mjs'

let passed = 0
let failed = 0
const check = async (name, test) => {
  try { await test(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { failed++; console.log(`  ✗ ${name}: ${error.message}`) }
}

console.log('\nCRON REGISTRATION\n')

const good = { key: 'cron-test', what: 'a cron test module', static: true, git: true, cloud: true }
await check('SQL literals may contain semicolons without becoming multiple actions', () => {
  const result = readManifest({
    ...good,
    owns: { cron: [{ name: 'literal-test', schedule: '* * * * *', command: 'select public.run_work($body$a;b$body$)' }] },
  })
  assert.deepEqual(result.faults, [])
})
await check('comments do not create handwritten cron calls', () => {
  assert.doesNotThrow(() => assertNoManualCron(
    `-- cron.schedule('fake', '* * * * *', 'select 1')\n/* cron.unschedule(1) */\nselect '-- cron.schedule(fake)', $body$cron.unschedule(1)$body$`,
    'fixture.sql',
  ))
  assert.throws(() => assertNoManualCron(`select cron.schedule('real', '* * * * *', 'select 1')`, 'fixture.sql'), /handwritten cron\.schedule/)
  assert.throws(() => assertNoManualCron('DO $body$BEGIN PERFORM cron.unschedule(1); END;$body$', 'fixture.sql'), /handwritten cron\.unschedule/)
})
await check('kit, site and theme declarations share the module resolver and switch semantics', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platformkit-cron-modules-'))
  try {
    const themeRoot = path.join(root, 'theme')
    fs.mkdirSync(themeRoot)
    const siteManifest = {
      ...good, key: 'site-cron-test',
      owns: { cron: [{ name: 'site-cron-test-job', schedule: '3 * * * *', command: 'select public.site_job()' }] },
    }
    const themeManifest = {
      ...good, key: 'theme-cron-test',
      owns: { cron: [{ name: 'theme-cron-test-job', schedule: '4 * * * *', command: 'select public.theme_job()' }] },
    }
    fs.writeFileSync(path.join(root, 'site-module.mjs'), `export default ${JSON.stringify(siteManifest)}\n`)
    fs.writeFileSync(path.join(themeRoot, 'module.mjs'), `export default ${JSON.stringify(themeManifest)}\n`)
    fs.writeFileSync(path.join(themeRoot, 'theme.js'), `export default { modules: ['./module.mjs'] }\n`)
    fs.writeFileSync(path.join(root, 'platformkit.config.js'), `export default {
      theme: ${JSON.stringify(themeRoot)},
      modules: { 'site-cron-test': false, 'theme-cron-test': true, 'social-publishing': false },
      build: { modules: ['./site-module.mjs'] }
    }\n`)

    const site = await loadSite(root)
    const modules = await moduleSet(site)
    assert.ok(modules.has('social-publishing'))
    assert.ok(modules.has('site-cron-test'))
    assert.ok(modules.has('theme-cron-test'))
    const active = activeCronJobs(modules, site.modules)
    assert.ok(active.some((job) => job.name === 'theme-cron-test-job'))
    assert.ok(!active.some((job) => ['site-cron-test-job', 'social-publishing'].includes(job.name)))
    const enabled = activeCronJobs(modules, { ...site.modules, 'site-cron-test': true })
    assert.ok(enabled.some((job) => job.name === 'site-cron-test-job'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const { modules: kitModules, faults: kitFaults } = readManifests(MODULES.map((manifest) => ({ manifest, where: 'the kit' })))
await check('all legacy kit jobs are represented once and retain their original declaration values', () => {
  assert.deepEqual(kitFaults, [])
  const actual = activeCronJobs(kitModules).map(({ name, schedule, command, module }) => ({ name, schedule, command, module }))
  const baseline = [
    ['agents-schedule', '*/5 * * * *', 'select public.run_agent_schedules();', 'bots'],
    ['agents-sweep', '* * * * *', 'select public.run_agents();', 'bots'],
    ['chat-followups', '* * * * *', 'select public.send_booking_followups()', 'coaching'],
    ['content-push', '* * * * *', 'select public.run_content_push()', 'api'],
    ['email-funnels', '7 * * * *', 'select public.run_email_funnels()', 'funnels'],
    ['event-reminders', '*/5 * * * *', 'select public.run_event_reminders()', 'events'],
    ['hyperswitch-subscription-renewal', '*/15 * * * *', 'select public.run_hyperswitch_subscription_renewal()', 'memberships'],
    ['network-crawl', '17 3 * * *', 'select public.run_network_crawl();', 'network'],
    ['network-project', '*/5 * * * *', 'select public.run_network_project();', 'network'],
    ['payouts-sweep', '15 * * * *', 'select public.payouts_sweep()', 'store'],
    ['session-recordings', '*/10 * * * *', 'select public.run_session_recordings()', 'sessions'],
    ['session-recordings-retain', '40 4 * * *', 'select public.run_session_recordings_retain()', 'sessions'],
    ['session-reminders', '*/5 * * * *', 'select public.run_session_reminders()', 'sessions'],
    ['social-automation-recovery', '* * * * *', 'select public.run_social_automation()', 'social-publishing'],
    ['social-metrics', '*/10 * * * *', 'select public.run_social_metrics()', 'social-publishing'],
    ['social-publishing', '* * * * *', 'select public.run_social_publishing()', 'social-publishing'],
    ['spaces-later', '* * * * *', 'select public.run_space_scheduled();', 'spaces'],
    ['spaces-sweep', '23 * * * *', 'select public.run_spaces_sweep();', 'spaces'],
    ['stock-holds', '*/20 * * * *', 'select public.inventory_sweep()', 'store'],
    ['support-escalate', '*/5 * * * *', 'select public.run_support_escalation()', 'support'],
    ['support-retain', '20 4 * * *', 'select public.run_support_retention()', 'support'],
    ['sweep-uploads', '50 4 * * *', 'select public.sweep_uploads()', 'api'],
    ['usage-meter-reports', '*/5 * * * *', 'select public.run_usage_meter_reports()', 'store'],
  ].map(([name, schedule, command, module]) => ({ name, schedule, command, module }))
  assert.deepEqual(actual, baseline)
})

await check('generated reconciliation schedules enabled declarations and records their ownership', () => {
  const sql = cronSql(kitModules, { support: false })
  assert.match(sql, /platformkit_cron_jobs/)
  assert.match(sql, /cron\.unschedule\(job_name\)/)
  assert.match(sql, /cron\.schedule\('chat-followups', '\* \* \* \* \*', 'select public\.send_booking_followups\(\)'\)/)
  assert.doesNotMatch(sql, /cron\.schedule\('support-escalate'/)
  assert.match(sql, /ARRAY\['agents-schedule'.*'usage-meter-reports'\]::text\[\]/s)
})

let dbNote = 'Docker unavailable'
const env = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
}
const docker = spawnSync('docker', ['info'], { stdio: 'ignore', env })
if (docker.status === 0) {
  const root = process.cwd()
  const scratch = path.join(root, 'node_modules', '.cache', 'platformkit', 'cron-registration-test')
  const port = 54384
  const target = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`
  const kitRoot = fileURLToPath(new URL('../supabase/', import.meta.url))
  const note = (text) => console.log('cron-db: ' + text)
  const sb = (args, options = {}) => spawnSync('npx', ['supabase', '--workdir', scratch, ...args], {
    cwd: scratch, env, encoding: 'utf8', ...options,
  })
  const major = (/major_version\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8')) || [])[1] || '17'
  const rowsFile = path.join(scratch, 'supabase', 'data.sql')
  let db
  try {
    fs.rmSync(scratch, { recursive: true, force: true })
    fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true })
    fs.cpSync(path.join(kitRoot, 'schemas'), path.join(scratch, 'supabase', 'schemas'), { recursive: true })
    fs.writeFileSync(path.join(scratch, 'supabase', 'config.toml'), `project_id = "pk-cron-registration-test"
[db]
port = ${port}
shadow_port = ${port + 1}
major_version = ${major}
[db.seed]
enabled = true
sql_paths = ["./schemas/*.sql", "./data.sql"]
`)
    const writeRows = (mods, switches = {}) => {
      fs.writeFileSync(rowsFile, fs.readFileSync(path.join(kitRoot, 'data.sql'), 'utf8').trimEnd() + cronSql(mods, switches) + '\n')
    }
    writeRows(kitModules)
    const start = sb(['db', 'start'])
    if (start.status !== 0) throw new Error(`scratch Supabase did not start: ${start.stderr || start.stdout}`)
    const reset = sb(['db', 'reset', '--db-url', target, '--yes'])
    if (reset.status !== 0) throw new Error(`scratch database reset failed: ${reset.stderr || reset.stdout}`)
    db = new pg.Client({ connectionString: target })
    await db.connect()
    const getJob = async (name) => (await db.query('select jobid, schedule, command from cron.job where jobname = $1', [name])).rows[0] || null
    const initial = (await db.query('select jobname from cron.job order by jobname')).rows.map((row) => row.jobname)
    assert.deepEqual(initial, activeCronJobs(kitModules).map((job) => job.name))
    const originalChat = await getJob('chat-followups')
    assert.ok(originalChat)
    await db.query(cronSql(kitModules))
    assert.equal((await getJob('chat-followups')).jobid, originalChat.jobid)
    assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n, initial.length)

    await db.query("select cron.schedule('operator-owned-job', '11 * * * *', 'select 1')")
    const updatedModules = new Map(kitModules)
    updatedModules.set('coaching', {
      ...kitModules.get('coaching'),
      owns: {
        ...kitModules.get('coaching').owns,
        cron: [{ ...kitModules.get('coaching').owns.cron[0], schedule: '12 * * * *' }],
      },
    })
    await db.query(cronSql(updatedModules))
    assert.equal((await getJob('chat-followups')).schedule, '12 * * * *')
    assert.equal((await getJob('chat-followups')).jobid, originalChat.jobid)
    assert.ok(await getJob('operator-owned-job'))

    await db.query(cronSql(updatedModules, { support: false }))
    assert.equal(await getJob('support-escalate'), null)
    assert.equal(await getJob('support-retain'), null)
    assert.ok(await getJob('chat-followups'))
    assert.ok(await getJob('operator-owned-job'))

    const withRemoved = new Map(updatedModules)
    withRemoved.set('cron-test-owner', {
      key: 'cron-test-owner',
      owns: { cron: [{ name: 'cron-test-removed-job', schedule: '17 * * * *', command: 'select 1' }] },
    })
    await db.query(cronSql(withRemoved, { support: false }))
    assert.ok(await getJob('cron-test-removed-job'))
    withRemoved.set('cron-test-owner', { ...withRemoved.get('cron-test-owner'), owns: { cron: [] } })
    await db.query(cronSql(withRemoved, { support: false }))
    assert.equal(await getJob('cron-test-removed-job'), null)
    assert.ok(await getJob('operator-owned-job'))

    await db.query("select cron.schedule('cron-test-collision', '19 * * * *', 'select 1')")
    const colliding = new Map(withRemoved)
    colliding.set('cron-test-owner', {
      ...colliding.get('cron-test-owner'),
      owns: { cron: [{ name: 'cron-test-collision', schedule: '20 * * * *', command: 'select 2' }] },
    })
    await assert.rejects(db.query(cronSql(colliding, { support: false })), /collides with an untracked cron\.job/)
    assert.equal((await getJob('cron-test-collision')).schedule, '19 * * * *')
    assert.ok(await getJob('operator-owned-job'))

    /* a fresh database with a module off: no registry and nothing scheduled, so nothing to unschedule — the club
       fixture's first reset failed here, cron.unschedule raising on a job that was never made */
    await db.query("delete from public.app_settings where key = 'platformkit_cron_jobs'")
    await db.query('select cron.unschedule(jobid) from cron.job')
    await db.query(cronSql(kitModules, { support: false }))
    assert.equal(await getJob('support-escalate'), null)
    assert.ok(await getJob('chat-followups'))
    passed += 1
    dbNote = 'passed reset, repeat, cadence update, module disable, declaration removal, collision preservation, and a fresh database with a module off'
  } catch (error) {
    failed++
    dbNote = error.message
    console.log('  ✗ isolated Postgres reconciliation: ' + error.message)
  } finally {
    if (db) await db.end().catch(() => {})
    sb(['stop', '--no-backup'], { stdio: 'ignore' })
  }
} else {
  console.log('  ⚠ isolated Postgres reconciliation skipped — Docker is not running')
}

console.log(`cron-registration: ${passed} passed, ${failed} failed; database: ${dbNote}`)
process.exit(failed ? 1 : 0)
