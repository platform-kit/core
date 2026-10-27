# Proposal

## Why

The end-to-end run built fresh stacks but ran the code in the developer's checkout: its installed packages, files a dev build had generated, and the site's functions folder, which the stack served through a link. A dev server running alongside rewrote that folder mid-run, the run's functions restarted, and a test failed with a 503 that had nothing to do with the code. Content compiled by an earlier dev build also stood in for the run's own: from a clean install the drop-in scripts would not build at all. And the run used whatever Node, browser and Docker the machine had, so a pass on one machine said little about another.

## What Changes

- The run builds an image from the project's files exactly as git lists them — never `node_modules`, a build, a cache or a settings file — with each fetched site's files and the site registry.
- The image installs the packages from scratch (`npm ci`) and pins Node, the browser and Deno.
- The run and its tests happen inside a container of that image with a Docker daemon of its own: every stack it starts lives and is removed inside it. The settings files are mounted read-only, never built in.
- The run compiles each site's content and runs its prepare steps itself, as `platformkit build` does.
- The same image runs locally and in CI; CI needs only Node and Docker.

## Non-goals

- Changing what a run tests or how its stacks are built.
