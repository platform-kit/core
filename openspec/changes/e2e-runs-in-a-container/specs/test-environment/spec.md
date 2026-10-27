## ADDED Requirements

### Requirement: The end-to-end run happens in a container built from the project's files

The end-to-end run SHALL build an image from the project's files as git lists them, with each fetched site's and the site registry, and none that `.gitignore` names. The image SHALL install the packages from scratch and pin the runtime and browser. The run and every test in it SHALL happen inside a container of that image, with a Docker daemon of the container's own for the stacks; nothing of the checkout SHALL be mounted into it but its settings files, read-only. The same image SHALL run locally and in CI.

#### Scenario: the code under test is the image's

- **WHEN** a run over two sites probes each from its tests
- **THEN** the probe and the functions each stack serves are the image's files, nothing of the checkout is mounted but settings files, and the stacks run on the container's own Docker

Verified by: `build/e2e-runner.test.mjs`

#### Scenario: nothing an earlier build left

- **WHEN** a run starts from an image with no installed leftovers, no compiled content and no built drop-in scripts
- **THEN** the run compiles and builds them itself and reaches its tests

Verified by: `build/e2e-runner.test.mjs`

#### Scenario: the container is removed with everything in it

- **WHEN** a run ends, passing or failing, without `--keep`
- **THEN** its container and every stack in it are gone, and its logs are in `node_modules/.cache/platformkit/e2e/`

Verified by: `build/e2e-runner.test.mjs`
