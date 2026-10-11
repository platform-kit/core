import { runPhase } from './steps.mjs'
import { functionsData } from './functions-data.mjs'
import { isLocalSupabaseUrl, supabaseUrl } from './tts/storage.mjs'

export async function refreshContent({
  site,
  changed,
  env = process.env,
  log = console.log,
  projectLocal = true,
  run = runPhase,
  makeFunctionsData = functionsData,
} = {}) {
  const context = { site, env, changed, log }
  const ran = {
    prepare: await run('prepare', context),
    functions: await makeFunctionsData({ ...context, phases: ['functions'] }),
    site: await run('site', context),
    after: [],
  }
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || supabaseUrl()
  if (projectLocal && isLocalSupabaseUrl(url)) {
    ran.after = await run('after', { ...context, localProjectionOnly: true })
  }
  return ran
}
