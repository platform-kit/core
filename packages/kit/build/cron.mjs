import { isOn, sqlStructure } from './modules/manifest.mjs'

const sqlText = (value) => {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('cron registration: SQL values must be strings without NUL bytes')
  return `'${value.replaceAll("'", "''")}'`
}

export function activeCronJobs(modules, switches = {}) {
  return [...modules.values()]
    .filter((module) => isOn(module.key, switches))
    .flatMap((module) => module.owns.cron.map((job) => ({ ...job, module: module.key })))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function assertNoManualCron(source, origin) {
  const structure = sqlStructure(source)
  if (structure === null) throw new Error(`${origin}: unterminated SQL comment or quoted value`)
  const findCall = (sql, depth = 0) => {
    const code = sqlStructure(sql)
    if (code === null) return null
    const match = /\bcron\s*\.\s*(schedule|unschedule)\s*\(/i.exec(code)
    if (match) return match[1].toLowerCase()
    if (depth >= 3) return null

    const delimiterPattern = /\$[a-z_][a-z0-9_]*\$|\$\$/ig
    let open
    while ((open = delimiterPattern.exec(sql))) {
      const delimiter = open[0]
      const closeAt = sql.indexOf(delimiter, open.index + delimiter.length)
      if (closeAt < 0) return null
      const prefix = sql.slice(0, open.index).trimEnd()
      const executableBody = /\bDO(?:\s+LANGUAGE\s+[a-z_][a-z0-9_]*)?\s*$/i.test(prefix) ||
        /\bCREATE(?:\s+OR\s+REPLACE)?\s+(?:FUNCTION|PROCEDURE)\b[\s\S]*\bAS\s*$/i.test(prefix)
      if (executableBody) {
        const call = findCall(sql.slice(open.index + delimiter.length, closeAt), depth + 1)
        if (call) return call
      }
      delimiterPattern.lastIndex = closeAt + delimiter.length
    }
    return null
  }
  const call = findCall(source)
  if (call) throw new Error(`${origin}: handwritten cron.${call} calls are not allowed; declare jobs in a module manifest`)
}

export function cronSql(modules, switches = {}) {
  const declared = [...modules.values()].flatMap((module) => module.owns.cron.map((job) => job.name)).sort()
  const active = activeCronJobs(modules, switches)
  const declaredNames = `ARRAY[${declared.map(sqlText).join(', ')}]::text[]`
  const activeNames = `ARRAY[${active.map((job) => sqlText(job.name)).join(', ')}]::text[]`
  const registrations = active.map(({ name, schedule, command }) =>
    `  PERFORM cron.schedule(${sqlText(name)}, ${sqlText(schedule)}, ${sqlText(command)});`,
  ).join('\n')

  return `\n-- Generated from enabled kit, theme and site module manifests. Do not edit this block.\nDO $platformkit_cron$\nDECLARE\n  declared_names text[] := ${declaredNames};\n  active_names text[] := ${activeNames};\n  managed_names text[];\n  registry jsonb;\n  registry_found boolean;\n  job_name text;\nBEGIN\n  SELECT value::jsonb INTO registry\n    FROM public.app_settings\n   WHERE key = 'platformkit_cron_jobs'\n   FOR UPDATE;\n  registry_found := FOUND;\n\n  IF registry_found THEN\n    IF jsonb_typeof(registry) IS DISTINCT FROM 'array'\n         OR EXISTS (SELECT 1 FROM jsonb_array_elements(registry) AS entries(value) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string') THEN\n      RAISE EXCEPTION 'PlatformKit cron registry app_settings.platformkit_cron_jobs must be a JSON array of job names';\n    END IF;\n    SELECT COALESCE(array_agg(value), ARRAY[]::text[])\n      INTO managed_names\n      FROM jsonb_array_elements_text(registry);\n  ELSE\n    managed_names := declared_names;\n  END IF;\n\n  IF EXISTS (\n    SELECT 1\n      FROM cron.job job\n     WHERE job.jobname = ANY(active_names)\n       AND NOT (job.jobname = ANY(managed_names))\n  ) THEN\n    RAISE EXCEPTION 'PlatformKit cron job name collides with an untracked cron.job; remove or rename the operator-managed job before applying';\n  END IF;\n\n  FOREACH job_name IN ARRAY managed_names LOOP\n    IF NOT (job_name = ANY(active_names)) THEN\n      PERFORM cron.unschedule(job_name);\n    END IF;\n  END LOOP;\n\n${registrations || '  -- No enabled module currently declares a cron job.'}\n\n  INSERT INTO public.app_settings (key, value)\n  VALUES ('platformkit_cron_jobs', ${sqlText(JSON.stringify(active.map((job) => job.name)))})\n  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;\nEND\n$platformkit_cron$;\n`
}
