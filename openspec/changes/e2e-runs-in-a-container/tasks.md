## Tasks

- [x] `docker/e2e.Dockerfile`: the browser image, Node as `.nvmrc` pins it, Deno, a Docker daemon of its own, `npm ci`, a fetched site's own dependencies
- [x] `build/e2e-container.mjs`: the build context from git's file list, settings mounted read-only, the script run inside, its exit code and logs out, the container removed
- [x] `build/e2e.mjs` and `build/e2e-runner.test.mjs` run inside it; the hand-written copy of the checkout and of the functions folder removed
- [x] Content compiled and the prepare steps run in the run's first step
- [x] A fetched site inside the container is the files the host verified, not a checkout (`build/sites.mjs`)
- [x] CI's e2e job runs the same container, with only Node and Docker on the machine
- [x] The runner's test proves the code is the image's and nothing of the checkout is mounted
- [x] Testing page, environment variables, FEATURES.md
- [x] The daemon in its own container beside the tests' (a browser beside a daemon lost requests to its network changes); addresses through `SUPABASE_SERVICES_HOSTNAME` and `DOCKER_HOST`
- [x] Fixes the clean run found: Deno 2 and `npm:` imports, the browser path, the sales and webhooks tests writing the running site's files, the quiz achievements in the awards check, the admin function's cold boot, the demo's weather spec kept in the site
