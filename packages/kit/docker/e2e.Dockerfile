# syntax=docker/dockerfile:1
#
# THE END-TO-END RUN'S IMAGE (openspec: e2e-runs-in-a-container). build/e2e-container.mjs builds it from the project's
# files as git lists them — never node_modules, a build, a cache or a settings file — and runs every end-to-end test
# inside it: the packages installed from scratch and the browser and Node pinned. A second container of the same image runs
# the Docker daemon the Supabase stacks start in, so they live and die with the run and never meet a developer's.
#
# The same image runs locally and in CI: `platformkit test --e2e`.

FROM mcr.microsoft.com/playwright:v1.63.0-noble
# the launcher removes this image's earlier builds by it, so they never pile up on the disk
LABEL dev.platformkit.e2e="1"

# Node as the project pins it (.nvmrc), in place of the one the browser image ships
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Docker: the client for the tests, and the daemon a second container of this image runs for the stacks (build/e2e-container.mjs);
# Deno, for the functions' own tests
RUN apt-get update && apt-get install -y --no-install-recommends docker.io iptables && rm -rf /var/lib/apt/lists/*
# the browsers at Playwright's default place too, for a process started without the image's environment
RUN mkdir -p /root/.cache && ln -s /ms-playwright /root/.cache/ms-playwright
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno


ENV HUSKY=0 PLATFORMKIT_E2E_IN_CONTAINER=1
WORKDIR /work
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
# a fetched site is not a workspace and has no lockfile of its own: what it needs beyond the workspace's install
RUN --mount=type=cache,target=/root/.npm node node_modules/platformkit/build/e2e-container.mjs --install-fetched

CMD ["sleep", "infinity"]
