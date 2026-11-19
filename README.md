# Vouch

A compatibility checker for API schemas that proves what breaks, and shows you the client that breaks.

Planning docs: [VOUCH-PLAN.md](./VOUCH-PLAN.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ROADMAP.md](./ROADMAP.md)

## Requirements

| Tool | Version | Managed by |
|---|---|---|
| Node | ≥ 22.13 (dev on 26.13.1) | scoop (`nodejs`) |
| pnpm | 12.22.0 | scoop (`pnpm`) |

## Setup

```sh
git clone <repo> && cd gcp_proj
pnpm install
pnpm build
pnpm test
```

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile every package with `tsc` |
| `pnpm typecheck` | Type-check sources and tests, no emit |
| `pnpm test` | Run the Vitest suite |
| `pnpm check` | Biome: lint + format + import order check, no writes (the CI gate) |
| `pnpm check:fix` | Apply Biome's fixes |
| `pnpm format` | Reformat with Biome |

Three tools, nothing else: **tsc** builds and type-checks, **Vitest** tests, **Biome** lints and formats. Biome is also what Neovim runs on save (`conform.nvim` → `biome-check`, `nvim-lint` → `biomejs`), so the editor and CI cannot disagree.

## Layout

```
packages/
  core/   pure core: IR, lower, diff, relation, classify, witness, certify
  cli/    the `vouch` command
```

`packages/core` may not import filesystem, network, or process APIs — `pnpm check` fails if it does (F0.2). The rule lives in `biome.json` under the `packages/core/src` override. I/O belongs in the CLI or a registry boundary.

## Deliberately not installed yet

Added when the feature that needs them lands, not before:

| Dependency | Arrives with |
|---|---|
| `graphql` | F0.5, the GraphQL frontend |
| `fast-check` | F1.8, property tests |
| `zod` | config validation (`.vouchrc.json`) |
| `picocolors` | F0.9, CLI rendering |
| a release tool | first release (D13) |
