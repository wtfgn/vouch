# Vouch — Architecture

**Status:** draft · Companion to [VOUCH-PLAN.md](./VOUCH-PLAN.md) · §references are to that document.

---

## 1. Scope

This document describes the **shape** of the system: what the components are, what each may depend on, how they interact at runtime, and which parts are mandatory. It does not restate the theory (§8 of the plan) or the schedule (§12 and [ROADMAP.md](./ROADMAP.md)).

The architectural goal in one sentence: **a pure, deterministic core that can be tested without a filesystem, surrounded by thin, replaceable adapters.**

---

## 2. System context

```
        ┌────────────┐          ┌──────────────┐
        │  Developer │          │   Reviewer   │
        └──────┬─────┘          └──────┬───────┘
               │                       │
               ▼                       ▼
        ┌──────────────────────────────────────┐
        │              Vouch                   │
        │  CLI · Action · (App) · Dashboard    │
        └───┬──────────────┬───────────────┬───┘
            │              │               │
            ▼              ▼               ▼
      ┌──────────┐   ┌───────────┐   ┌──────────────┐
      │  Git /   │   │  GitHub   │   │  Registry    │
      │  files   │   │  API      │   │  (Postgres)  │
      └──────────┘   └───────────┘   └──────────────┘
```

External systems, and nothing else:

| System | Used by | Purpose |
|---|---|---|
| Filesystem | `source` | read schema files |
| Git | `source` | read a schema at a revision |
| GitHub API | `source`, `app` | file contents, PR comments, check runs |
| Postgres | `registry-server` | versions, clients, runs, certificates |

No LLM, no telemetry endpoint, no third-party service sits in the product path.

---

## 3. Layers and packages

Three layers, strictly ordered. An arrow means **may import**.

```
┌──────────────────────────────────────────────────────────────┐
│ L2 · Entry points                                            │
│   cli      action      registry-server      web              │
│   codegen  bench (dev)                                       │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│ L1 · Adapters (the only I/O)                                 │
│   source (fs | git | github)      registry-client (http)     │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│ L0 · Pure core (no I/O, no clock, no randomness)             │
│   core        config        report                           │
└──────────────────────────────────────────────────────────────┘
```

**Rule L0→L1:** a package in L0 may never import a package in L1 or L2. This is not a convention; it is lint-enforced and tested.

---

## 4. Dependency graph

### 4.1 Packages

| Package | Depends on | Layer | Mandatory? |
|---|---|---|---|
| `@vouch/core` | `graphql` (only) | L0 | **Yes** |
| `@vouch/config` | `zod` | L0 | **Yes** |
| `@vouch/report` | `@vouch/core` | L0 | **Yes** |
| `@vouch/source` | `@vouch/core`, `node:fs`, `git` | L1 | **Yes** (CLI) |
| `@vouch/registry-client` | `@vouch/core`, `fetch` | L1 | Optional |
| `@vouch/cli` | core, config, report, source, registry-client | L2 | **Yes** |
| `@vouch/action` | `@vouch/cli` (bundled) | L2 | Optional (strongly recommended) |
| `@vouch/registry-server` | core, config, registry-client types, Postgres | L2 | Optional |
| `@vouch/web` | registry-client (HTTP only) | L2 | Optional |
| `@vouch/codegen` | `@vouch/core` | L2 | Optional |
| `@vouch/bench` | `@vouch/core` | L2 (dev) | Dev-only |

`@vouch/core` depends on exactly one external package, `graphql`. That is deliberate: the core's dependency surface is the core's audit surface.

### 4.2 Core modules

The core is one package with an internal module graph. This is the part worth getting right.

```
                          ┌────────┐
                          │   ir   │
                          └───┬────┘
        ┌──────────┬──────────┼──────────┬──────────────┐
        ▼          ▼          ▼          ▼              ▼
  parse/graphql  diff    relation     hash       check/value
        │          │          │                        │
        ▼          │          │                        ▼
     lower         │          │                   check/query
                   │          │                        │
                   ▼          ▼                        │
                classify ◄────┘                        │
                   │                                  │
                   ▼                                  │
                witness                               │
                   │                                  │
                   ▼                                  ▼
                shrink ──────────────────────────► certify
                   │                                  │
                   └──────────────┬───────────────────┘
                                  ▼
                               pipeline
```

| Module | Responsibility | May depend on | Must **not** depend on |
|---|---|---|---|
| `ir` | Types for `TypeRef`, `Field`, `TypeDef`, `VIR`, `Change`, `Witness` | — | everything |
| `parse/graphql` | SDL text → `GraphQLSchema` | `ir`, `graphql` | `diff`, `classify` |
| `parse/openapi` | OpenAPI doc → same shape | `ir` | `diff`, `classify` |
| `lower` | `GraphQLSchema` → `VIR` + reachability | `ir`, `graphql` | `diff`, `classify` |
| `hash` | Canonical JSON → SHA-256 | `ir` | `graphql` |
| `diff` | `VIR × VIR` → `Change[]` | `ir` | `classify`, `witness`, `certify` |
| `relation` | Coinductive subtyping on `TypeRef` | `ir` | `diff`, `classify` |
| `check/value` | Does a JSON value conform to a type? | `ir` | `diff`, `classify` |
| `check/query` | Is a query well-typed against a schema? | `ir` | `diff`, `classify` |
| `certify` | Witness + two VIRs → `Certificate` | `ir`, `check/*` | **`diff`, `classify`** |
| `classify` | `Change` + positions → `Verdict` | `ir`, `relation`, `diff` | `witness`, `certify` |
| `witness` | `Change` → `Witness` | `ir`, `relation` | `certify`, `shrink` |
| `shrink` | `Witness` → smaller `Witness` | `ir`, `witness`, `certify` | `diff`, `classify` |
| `pipeline` | Orchestrates the above, still pure | all | I/O |

### 4.3 The invariants this buys

Three edges are load-bearing, and each has a test that fails if someone rewires it:

1. **`certify` must not see `diff` or `classify`.** If it did, a bug in the diff could produce a certificate that "confirms" the diff's own mistake. The certifier must be able to contradict the classifier.
2. **`classify` must not see `witness`.** A verdict must be derivable without knowing whether a witness will be found; otherwise "we couldn't construct a counterexample" silently becomes "it's compatible." That is exactly the unsoundness the tool exists to prevent.
3. **`witness` must not see `certify`.** Otherwise the witness generator could be shaped by what the certifier accepts, and both drift together. The certifier is an adversary, not a collaborator.

`shrink` is the one place that legitimately sees both: it needs a witness *and* the certifier, because its whole job is "delete until the certifier refuses, then put one back."

---

## 5. Components

### 5.1 Mandatory vs optional

| Component | MVP (v0.1) | v1.0 | Notes |
|---|---|---|---|
| `core/ir` | **M** | **M** | |
| `core/parse/graphql` | **M** | **M** | |
| `core/lower` | **M** | **M** | |
| `core/diff` | **M** | **M** | |
| `core/relation` | **M** | **M** | |
| `core/classify` | **M** | **M** | |
| `core/witness` | **M** | **M** | The product |
| `core/shrink` | O | **M** | MVP may ship unshrunk witnesses |
| `core/certify` | O | **M** | MVP may ship uncertified witnesses (weaker trust) |
| `core/parse/openapi` | — | O | v1.1+ |
| `config` | O | **M** | MVP uses flags |
| `report` | **M** | **M** | text + JSON in MVP |
| `source` | **M** | **M** | fs in MVP, git in MVP, GitHub in v0.2 |
| `cli` | **M** | **M** | |
| `action` | — | O | Strongly recommended; the cheapest distribution |
| `registry-client` | — | O | |
| `registry-server` | — | O | The paid tier |
| `web` | — | O | |
| `codegen` | — | O | |
| `bench` | O | **M** (dev) | Needed from M4 to validate |

**Legend:** **M** = mandatory · O = optional · — = not applicable at that stage.

### 5.2 Catalog

| Component | One line |
|---|---|
| `ir` | The type vocabulary shared by every other module. No logic. |
| `parse/graphql` | Thin wrapper over `graphql-js`: parse, merge, build, validate. |
| `lower` | Semantic lowering: schema → normalized VIR, plus reachability. |
| `hash` | Content addressing. The identity of a schema version. |
| `diff` | Structural comparison. Knows *what changed*, not whether it matters. |
| `relation` | The subtyping relation. Pure, coinductive, memoized. |
| `classify` | Position assignment + relation → verdict. The theory. |
| `witness` | Type-directed construction of a distinguishing access. |
| `shrink` | Delta-debugging on witnesses, with a certify gate at each step. |
| `certify` | Independent re-derivation. The trust boundary. |
| `pipeline` | Pure orchestration: source set in, result out. |
| `config` | Zod schema for `.vouchrc.json`; defaults; validation errors. |
| `report` | Renderers: text, JSON, markdown, SARIF, HTML. Pure functions. |
| `source` | The only module that reads the outside world for input. |
| `cli` | Argument parsing, wiring, exit codes. Thin. |
| `action` | A shell wrapper: sets up Node, runs `vouch check`, uploads. |
| `registry-client` | Typed HTTP client for the registry. |
| `registry-server` | REST + Postgres: versions, clients, runs, certificates. |
| `web` | Static dashboard over the registry API. |
| `codegen` | VIR → TypeScript / Swift / Kotlin types, with the schema hash. |
| `bench` | Dataset loader, harness, precision/recall reporter. |

---

## 6. Data contracts

These are the only things that cross a module boundary. Changing one is an architecture change.

```ts
// SourceFile — the unit of input
{ path: string; text: string }

// VIR — the unit of comparison
{ v: 1; schemaName: string; roots: Roots; types: TypeDef[]; reach: Reach; hash: string }
// invariants: types sorted by name; every named ref resolves; hash strips spans

// Change — the unit of a difference
{ fingerprint: string; kind: ChangeKind; path: string[];
  position: 'output'|'input'|'both'|'none'; old?: string; new?: string; span?: Span }

// Classified — a change with a verdict
{ change: Change; verdict: 'compatible'|'breaking'|'conditional'|'internal'|'unknown';
  derivation: string }

// Witness — a claim of breakage
{ kind: 'client'|'structural'; operation?: 'query'|'mutation';
  query?: string; path: PathSegment[]; value?: unknown }

// Certificate — a checkable claim
{ v: 'vouch/cert@1'; change: ChangeRef; from: VersionRef; to: VersionRef;
  verdict: 'breaking'; witness: Witness; checks: Check[] }

// Report — what a renderer consumes
{ v: 'vouch/report@1'; run: string; unit: string; from: VersionRef; to: VersionRef;
  verdict: Verdict; counts: Record<Verdict, number>;
  changes: Classified[]; certificates: Certificate[]; blastRadius?: BlastRadius[] }
```

**Invariants.**

- `Change.fingerprint` is `sha256(kind ‖ path ‖ old ‖ new)` and is stable across runs and machines.
- A `Witness` that has not passed `certify` must never appear in a `Report`.
- A `Certificate` with `verdict: 'breaking'` must contain all three checks passing.
- `Report.changes` is sorted by `(kindRank, path)`.

---

## 7. Interactions

### 7.1 CLI — local check

```
User        CLI         config      source      core            report
 │           │            │           │           │               │
 ├─ diff ───►│            │           │           │               │
 │           ├─ load ────►│           │           │               │
 │           ├─ read ────────────────►│           │               │
 │           │            │           ├─ parse ──►│               │
 │           │            │           │           ├─ lower        │
 │           │            │           │           ├─ hash         │
 │           │            ├─ diff ────────────────►│              │
 │           │            │           │           ├─ classify     │
 │           │            │           │           ├─ witness      │
 │           │            │           │           ├─ shrink       │
 │           │            │           │           ├─ certify      │
 │           │◄───────────────────────────────────┤ result        │
 │           ├─ render ───────────────────────────────────────────►│
 │◄─ text ───┤            │           │           │               │
```

Exit code is the product: `0` clean, `1` breaking, `2` config, `3` parse, `4` internal/unknown.

### 7.2 GitHub Action

```
PR event ─► Action (user's runner)
              ├─ checkout (both refs)
              ├─ npx vouch check
              │     └─ same path as 7.1
              ├─ upload SARIF (optional)
              └─ post/update PR comment
```

No network beyond GitHub. No data leaves the runner. This is the recommended v1 distribution.

### 7.3 Hosted App (optional)

```
webhook ─► app ─► source (GitHub API) ─► core.pipeline ─► report
             │                                  │
             ├─ check run + annotations          └─ registry: store run
             └─ PR comment
```

### 7.4 Registry correlation (optional)

```
CLI ─► registry-client ─► registry-server ─► Postgres
                                    │
                                    └─ clients × changed paths → blast radius
```

If the registry is absent or unreachable, the correlation stage is skipped and the report says so. It never blocks a verdict.

---

## 8. Trust boundaries

There are two different trust questions, and they have different answers.

**"Is this witness real?"**
Trusted set: `{ ir, check/value, check/query, certify }`. These are small, pure, and independently testable. Nothing else can make a false certificate, because `certify` re-derives both sides from scratch.

**"Is this verdict sound?"**
Trusted set: `{ ir, relation, classify }`. The certifier cannot help here — it only validates *positive* claims of breaking. A false `compatible` is caught by two other mechanisms: the nightly **self-audit** (run the witness search even on positive verdicts; any hit is a P0), and the **mechanized soundness proof** in Phase 6.

This asymmetry is why the plan insists on "fail closed": every unknown path in `classify` must produce `unknown`, never `compatible`. A false positive costs trust; a false negative costs an incident.

---

## 9. Extensibility

Four extension points, each an interface with one implementation per format.

```ts
interface Frontend {                        // add a schema language
  name: string;
  detect(files: SourceFile[]): boolean;
  parse(files: SourceFile[]): ParsedUnit;
}

interface Renderer {                        // add an output surface
  name: string;
  render(report: Report, opts: RenderOpts): string;
}

interface ClientIndex {                     // add a client data source
  list(): Promise<ClientVersion[]>;
}

interface Rule {                            // add a compatibility rule
  kind: ChangeKind;
  position(c: Change, vir: VIR): Position;
  verdict(c: Change, vir: VIR, rel: Relation): Verdict;
}
```

- **New schema format:** implement `Frontend`, register it. No core change. OpenAPI is the proof that this works.
- **New output:** implement `Renderer`. Text, JSON, markdown, SARIF, and HTML are already five instances.
- **New client source:** implement `ClientIndex`. Manual `clients.json`, generated-client hashes, and telemetry are three instances.
- **New rule:** add a `ChangeKind`, a `Rule`, and a golden test. Exactly one place to edit.

Deliberately **not** extensible: the certificate format (it is the contract), the relation (it is the theory), and the exit codes (they are the interface).

---

## 10. Build, packaging, enforcement

**Workspace.** pnpm, packages under `packages/*`, each with its own `package.json` and explicit `exports` map (no deep imports).

**Bundling.** The CLI bundles `core`, `config`, `report`, and `source` into one artifact so `npx vouch` is a single download.

**Enforcement.**

| Rule | Mechanism |
|---|---|
| L0 must not import L1/L2 | Biome `noRestrictedImports` overrides + CI |
| `core` must not import `fs`/`net`/`http` | `noRestrictedImports` (implemented in `biome.json`) |
| `certify` must not import `diff`/`classify` | `noRestrictedImports` override, once `certify` exists |
| No `process.env`/`fetch` in `core` | `noProcessEnv` + `noRestrictedGlobals` (implemented) |
| No `Date.now`/`Math.random` in `core` | review only; Biome has no member-access rule (a GritQL plugin is the fix) |
| Public API is explicit | `exports` field + API extractor check |

**Tests.**

| Layer | What it covers |
|---|---|
| Unit | each module in isolation, with in-memory data |
| Golden | 120 schema pairs → expected verdicts |
| Property | reflexivity, transitivity, monotonicity, no-witness-on-compatible |
| Integration | CLI end-to-end against fixtures |
| Contract | certificate verifier accepts valid, rejects tampered |
| Audit | nightly self-audit over the benchmark |

---

## 11. Testing seams

Every non-deterministic input is injected, never imported:

| Input | Seam | Test double |
|---|---|---|
| Filesystem | `source` interface | in-memory `SourceFile[]` |
| Git | `source` interface | fixture revisions |
| Registry | `ClientIndex` / `RegistryClient` | in-memory fake |
| Clock | `now()` parameter (clear dates only) | fixed timestamp |
| Randomness | none exists | — |

Because `pipeline` is pure, the entire product can be tested by calling one function with two `SourceFile[]` values and asserting on a `Report`. That is the property that keeps the test suite fast as the product grows.

---

## 12. Non-goals

Architectural non-goals, distinct from the product non-goals in the plan:

- **No plugin runtime.** Extensibility is compile-time interfaces, not loaded code.
- **No server-side rendering in the core.** Renderers return strings.
- **No multi-tenancy inside the CLI.** The CLI is single-tenant by construction; tenancy lives in the registry.
- **No database in the CLI path.** The CLI works offline, forever.
- **No background jobs.** Every run is synchronous and bounded.

---

## Appendix — Directory layout

```
vouch/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── ir/
│   │       ├── parse/{graphql,openapi}/
│   │       ├── lower/
│   │       ├── hash/
│   │       ├── diff/
│   │       ├── relation/
│   │       ├── check/{value,query}/
│   │       ├── certify/
│   │       ├── classify/
│   │       ├── witness/
│   │       ├── shrink/
│   │       └── pipeline/
│   ├── config/
│   ├── report/
│   ├── source/
│   ├── cli/
│   ├── action/
│   ├── registry-client/
│   ├── registry-server/
│   ├── web/
│   ├── codegen/
│   └── bench/
├── schema/                 # Vouch's own GraphQL schema (dogfood)
├── fixtures/               # golden schema pairs
│   ├── known-good/
│   ├── known-breaking/
│   └── recursive/
├── docs/
└── .github/workflows/
```

`fixtures/known-good` is as important as `fixtures/known-breaking`: a checker that finds nothing on valid changes is a checker nobody trusts either.
