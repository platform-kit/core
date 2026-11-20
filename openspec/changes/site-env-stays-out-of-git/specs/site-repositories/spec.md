## ADDED Requirements

### Requirement: A site's secrets file stays out of its repository

Wherever the kit runs in a site inside a git repository, it SHALL write a rule ignoring `.env` and `.env.*`, except `.env.example`, into that clone's `.git/info/exclude`, once, so the files stay out of git whether or not the site has a `.gitignore`. While git tracks such a file under the site, every kit command SHALL refuse to run, name the file, and say how to take it out of git. Outside a git repository the kit SHALL do nothing.

#### Scenario: a site with no .gitignore

- **WHEN** the kit runs in a site repository with no `.gitignore` and the site's author runs `git add -A`
- **THEN** `.env` and `.env.dev` are not staged, and `.env.example` is

Verified by: `packages/kit/build/env-guard.test.mts`

#### Scenario: a .env forced into git

- **WHEN** a site's `.env` is committed with `git add -f` and a kit command runs
- **THEN** the command refuses, naming `.env` and `git rm --cached`, and runs again once the file is out of git, with the file still on disk

Verified by: `packages/kit/build/env-guard.test.mts`
