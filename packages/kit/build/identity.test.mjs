/*
 * WHO IS HERE: the rule six modules now depend on, pinned.
 *
 * src/lib/identity.js is pure on purpose — the failure it exists to prevent (a module never told
 * that somebody arrived) is invisible in a browser, because signing out reloads the page and
 * signing in does not. Nothing here touches Supabase.
 */
import { identityBus } from '../src/lib/identity.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nIDENTITY\n')

/* a bus whose hooks just record what they were told, called straight through */
const make = () => {
  const bus = identityBus()
  const told = []
  bus.on((id) => told.push(id))
  const arrive = (id) => { const began = bus.begin(id); if (began) bus.settle(id, (fn, i) => fn(i)); return began }
  return { bus, told, arrive }
}

/* --- a change of person is a change of id, and nothing else --- */
{
  const { told, arrive } = make()
  ok('the first load tells, even for a guest', arrive(null) === true && told.length === 1 && told[0] === null)
  ok('the same guest again tells nobody', arrive(null) === false && told.length === 1)
  ok('signing in tells once', arrive('ada') === true && told.length === 2 && told[1] === 'ada')
  ok('a token refresh tells nobody', arrive('ada') === false && told.length === 2)
  ok('another person tells once', arrive('grace') === true && told.length === 3 && told[2] === 'grace')
  ok('signing out tells with nobody', arrive(null) === true && told.length === 4 && told[3] === null)
}

/* --- the reads come first, and a late one for somebody who has gone is dropped --- */
{
  const bus = identityBus()
  const told = []
  bus.on((id) => told.push(id))
  bus.begin('ada')                       /* ada's reads start */
  bus.begin('grace')                     /* grace signs in before they answer */
  const stale = bus.settle('ada', (fn, i) => fn(i))
  ok('a late answer for the previous person announces nobody', stale === false && told.length === 0)
  const fresh = bus.settle('grace', (fn, i) => fn(i))
  ok('the current person still announces', fresh === true && told.length === 1 && told[0] === 'grace')
}
{
  const bus = identityBus()
  const told = []
  bus.on((id) => told.push(id))
  ok('settling before anything began tells nobody', bus.settle('ada', (fn, i) => fn(i)) === false && told.length === 0)
}

/* --- every hook is told, and one that throws does not stop the next --- */
{
  const bus = identityBus()
  const seen = []
  bus.on(() => { throw new Error('this module is having a bad day') })
  bus.on((id) => seen.push(id))
  bus.begin('ada')
  /* the app calls each hook detached and swallows its failure; here we do the same synchronously */
  bus.settle('ada', (fn, id) => { try { fn(id) } catch (e) { /* swallowed, as the app swallows it */ } })
  ok('a hook that throws does not stop the one after it', seen.length === 1 && seen[0] === 'ada')
}

/* --- registering and unregistering --- */
{
  const bus = identityBus()
  const seen = []
  const off = bus.on((id) => seen.push(id))
  bus.begin('ada'); bus.settle('ada', (fn, i) => fn(i))
  off()
  bus.begin('grace'); bus.settle('grace', (fn, i) => fn(i))
  ok('an unregistered hook is not told', seen.length === 1)
  ok('and the bus knows it is gone', bus._state().hooks === 0)
}

/* --- a hook that registers during a broadcast is not told by that same broadcast --- */
{
  const bus = identityBus()
  const seen = []
  bus.on(() => { bus.on((id) => seen.push('late:' + id)) })
  bus.begin('ada'); bus.settle('ada', (fn, i) => fn(i))
  ok('a hook added mid-broadcast waits for the next one', seen.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
