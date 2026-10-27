# syntax=docker/dockerfile:1
#
# THE END-TO-END RUN'S IMAGE (openspec: e2e-runs-in-a-container). build/e2e-container.mjs builds it from the project's
# files as git lists them — never node_modules, a build, a cache or a settings file — and runs every end-to-end test
# inside it: the packages installed from scratch, the browser and Node pinned, and a Docker daemon of its own, so the
# Supabase stacks a run starts live and die inside the container and never meet a developer's.
#
# The same image runs locally and in CI: `platformkit test --e2e`.

FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Node as the project pins it (.nvmrc), in place of the one the browser image ships
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# a Docker daemon of the container's own (the stacks), and Deno (the functions' own tests)
RUN apt-get update && apt-get install -y --no-install-recommends docker.io iptables && rm -rf /var/lib/apt/lists/*
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno

# the daemon starts with the container; its data is a volume, so the stacks' images are pulled once, not every run
COPY <<'EOF' /usr/local/bin/e2e-daemon
#!/bin/sh
set -e
dockerd --host=unix:///var/run/docker.sock >/var/log/dockerd.log 2>&1 &
i=0
until docker info >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then echo "the container's Docker daemon did not start:" >&2; tail -20 /var/log/dockerd.log >&2; exit 1; fi
  sleep 1
done
exec "$@"
EOF
RUN chmod +x /usr/local/bin/e2e-daemon
VOLUME /var/lib/docker

ENV HUSKY=0 PLATFORMKIT_E2E_IN_CONTAINER=1
WORKDIR /work
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
# a fetched site is not a workspace and has no lockfile of its own: what it needs beyond the workspace's install
RUN --mount=type=cache,target=/root/.npm node node_modules/platformkit/build/e2e-container.mjs --install-fetched

ENTRYPOINT ["e2e-daemon"]
CMD ["sleep", "infinity"]
