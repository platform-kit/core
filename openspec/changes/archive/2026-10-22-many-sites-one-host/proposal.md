# Proposal

## Why

A workspace with several sites still requires each dev server and backend to be started and
ported by hand. That makes the subdomain setup incomplete: a site is isolated only after its own
server and Supabase stack have been found and connected.

## What Changes

- At the workspace root, `npm run dev` discovers every selected site and starts them together.
- Each site's Vite server and backend-enabled Supabase stack receive automatically chosen,
  non-conflicting ports. One local front door routes `<site>.localhost` to the correct site and
  reports the usable URLs, including its chosen port.
- Backend-free sites remain backend-free. Starting dev in an individual site remains available.
- Shutdown and startup failure stop the child processes and stacks and remove runtime port files.

## Non-goals

This does not enable backends for sites that declare `deployment.backend: false`, change production
deployment, or require manually maintained per-site port maps.

## What James should look at

The root command should be the only command needed to bring every workspace site online, with each
backend-enabled site isolated and independently signed in.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-and-dev`: workspace-root development starts and routes all selected sites with isolated,
  automatically port-assigned local backends.
- `deploy`: the existing multi-site hosting requirements remain part of this change; this revision
  adds no deployment behavior.

## Impact

The workspace dev runner, per-site Vite and Supabase startup, runtime-only Supabase configuration,
the development nginx front door, local auth redirect patterns, tests, and the multiple-sites guide
are affected. No new dependency is expected.
