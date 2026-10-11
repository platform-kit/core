# Spec Delta

## ADDED Requirements

### Requirement: The workspace development root lists its selected sites

When the workspace development server is running, its unqualified local front-door host SHALL show a directory with one card for each selected site package. Each card SHALL display that site's resolved homepage Open Graph image and a project title from optional `dev.projectName`, falling back to the site directory name when unset or blank. The complete card SHALL link to the site's named `.localhost` origin on the same front-door port, and SHALL NOT display the SEO description or a separate open-site action. The directory SHALL reflect the `PLATFORMKIT_SITES` selection when one is set.

#### Scenario: Open the workspace root during development

- **WHEN** the workspace development front door is running with multiple selected sites and a developer opens its unqualified local host
- **THEN** the directory shows one uniformly sized image-and-title card per selected site, using its resolved homepage Open Graph image and configured project name (or directory name fallback), with the whole card linking to that site's named local origin and no description or separate action

Verified by: `packages/kit/build/dev-workspace.test.mjs`; screenshots at 1280px and 390px

#### Scenario: Select a subset of workspace sites

- **WHEN** `PLATFORMKIT_SITES` selects only some site packages
- **THEN** the directory lists only those selected sites and each card links to the corresponding named local origin

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Production keeps its configured apex behavior

- **WHEN** the production host configuration is generated without an apex site
- **THEN** the unqualified host retains its existing 404 behavior and does not serve the development directory

Verified by: `packages/kit/build/sites-host.test.mjs`

### Requirement: Development servers use predictable public ports

Single-site development and the workspace development front door SHALL use port 3000 by default. If that requested public port is unavailable, the server SHALL fail with a clear port-conflict error instead of silently choosing another port. Automatic public-port selection SHALL require an explicit `auto` option. Ports used only for the workspace's internal site Vite servers MAY be allocated automatically.

#### Scenario: Start a single-site development server with defaults

- **WHEN** a developer starts a single-site development server without a port option and port 3000 is available
- **THEN** the site listens on port 3000

Verified by: `packages/kit/build/dev.test.mjs`

#### Scenario: The default single-site port is occupied

- **WHEN** a developer starts a single-site development server without a port option and port 3000 is occupied
- **THEN** startup fails with an error identifying the requested port and does not silently select another port

Verified by: `packages/kit/build/dev.test.mjs`

#### Scenario: Explicitly request automatic single-site port selection

- **WHEN** a developer starts a single-site development server with `--port:auto`
- **THEN** the server selects and reports an available port

Verified by: `packages/kit/build/dev.test.mjs`

#### Scenario: Start the workspace front door with defaults

- **WHEN** a developer starts workspace development without a front-door port option and port 3000 is available
- **THEN** the directory and every named site origin are served through the front door on port 3000 while internal site Vite ports are allocated for the selected sites

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Workspace front-door port is occupied

- **WHEN** a developer starts workspace development without a front-door port option and port 3000 is occupied
- **THEN** startup fails with an error identifying the requested port and does not silently select another public port

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Explicitly request automatic workspace front-door port selection

- **WHEN** a developer starts workspace development with `--front-door-port:auto`
- **THEN** the directory and every named site origin use the same available front-door port, which is reported at startup

Verified by: `packages/kit/build/dev-workspace.test.mjs`

### Requirement: Workspace development reuses stable site-specific Supabase projects

Each site's development configuration SHALL allow the developer to set the complete stable Supabase project ID with `dev.projectId`. If it is unset, the default SHALL be `pk_<site-folder-or-subdomain>_local`. Direct and workspace development SHALL use the same resolved project ID. Different site folders/subdomains SHALL have distinct defaults. A run identifier SHALL NOT be included in the project ID.

#### Scenario: Restart a workspace site

- **WHEN** a site is started in workspace development on multiple runs
- **THEN** its local Supabase project ID remains the same and its stack is reused

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Run multiple workspace sites

- **WHEN** two or more sites are selected for workspace development
- **THEN** each site's local Supabase project ID is stable and distinct from the others, and each site keeps its own stack

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Override a site's Supabase project ID

- **WHEN** a developer sets `dev.projectId` in that site's `platformkit.config.js`
- **THEN** direct and workspace development use that exact stable project ID and do not append a per-run identifier

Verified by: `packages/kit/build/dev-workspace.test.mjs`

### Requirement: Developers can stop PlatformKit-managed dev processes safely

The kit SHALL provide a `platformkit stop` command that stops PlatformKit-managed dev server process groups and the associated local Supabase projects for the current workspace. Dev runs SHALL record enough ownership information for the stop command to identify their processes and projects without relying on broad process-name matching. The command SHALL NOT signal unregistered processes or remove Supabase database volumes or Docker images. It SHALL be safe to run repeatedly and SHALL report what it stopped and any managed run it could not stop.

#### Scenario: Stop active workspace dev services

- **WHEN** `platformkit stop` is run in a workspace with active managed dev services
- **THEN** its registered site servers and workspace front door stop, and the local Supabase projects associated with those site runs stop

Verified by: `packages/kit/build/dev-stop.test.mjs`

#### Scenario: Stop when no managed dev services are running

- **WHEN** `platformkit stop` is run with no active managed dev services
- **THEN** it exits successfully, reports that there is nothing to stop, and leaves unrelated processes and Supabase projects untouched

Verified by: `packages/kit/build/dev-stop.test.mjs`

#### Scenario: Stop is run more than once

- **WHEN** `platformkit stop` is run again after all managed services have stopped
- **THEN** it exits successfully without signaling a process whose recorded PID has exited or been reused

Verified by: `packages/kit/build/dev-stop.test.mjs`
