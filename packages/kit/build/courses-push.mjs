#!/usr/bin/env node
/*
 * The courses a site declares, made real: content/courses into the `courses`, `course_lessons` and `course_cohorts`
 * tables (courses-io.mjs projectCourses). It is the only writer — no client may write a course — and it goes one way.
 * A course whose file has problems is left as it was, and named; one whose file has gone is unpublished.
 *
 * With no service key it says so and does nothing.
 *
 *   node build/courses-push.mjs            project
 *   node build/courses-push.mjs --check    say what it would do, and change nothing
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'
import { readCourses, projectCourses } from './courses-io.mjs'

export async function pushCourses({ root = process.cwd(), check = false, log = console.log, db: client = null } = {}) {
  const courses = await readCourses(root)
  const bad = courses.filter((c) => c.problems.length)
  if (check || (!client && (!supabaseUrl() || !serviceKey()))) {
    log(`courses: ${check ? 'would write' : 'no database to push to;'} ${courses.length - bad.length} course(s)${courses.length ? ': ' + courses.map((c) => c.slug).join(', ') : ''}`)
    for (const c of bad) log(`  ✖ ${c.slug}: ${c.problems.join('; ')}`)
    return { courses: courses.length, refused: bad.length }
  }
  const db = client || createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  const out = await projectCourses({ courses, db })
  log(`courses: ${out.courses} written (${out.lessons} lessons)${out.unpublished ? `, ${out.unpublished} unpublished` : ''}`)
  for (const r of out.refused) log(`  ✖ not written — ${r}`)
  if (out.refused.length) process.exitCode = 1
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) await pushCourses({ check: process.argv.includes('--check') })
