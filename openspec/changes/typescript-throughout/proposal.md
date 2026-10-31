# Proposal

## Why

PlatformKit is described as a TypeScript framework, and about 12% of it is TypeScript, all in the Edge Functions. The engine, the CLI, the libraries and the theme are untyped JavaScript, and no type declarations ship except the payment-provider interface. A site's builder learns the config, the registries and the theme contract by reading the kit's source, and a mistake in any of them is found at run time.

## What Changes

- The kit's source becomes TypeScript: the engine and CLI, the libraries, the shared modules the functions copy, and the theme's Vue components (`<script setup lang="ts">`).
- The package ships compiled JavaScript with type declarations, built on publish and on a git install. Node runs TypeScript directly in the workspace but refuses to inside `node_modules`.
- A site gets types for what it writes: `platformkit.config` (through a `defineSite` helper), module manifests, the registries (routes, sections, admin screens, models, member-card panels), the theme contract and the payment and printer adapters.
- `npm run typecheck` (`tsc --noEmit` and `vue-tsc`) runs in CI and fails it.
- New tests are `node:test` files in TypeScript; existing ones move when their subject does.

## Non-goals

- Converting generated files, fixtures or the vendored forms.md grammar.
- Strict mode everywhere at once: each directory turns on `strict` as it is converted.
