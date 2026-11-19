# Vouch — Roadmap

**Status:** draft 0.3 · Companion to [VOUCH-PLAN.md](./VOUCH-PLAN.md) and [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. How to read this roadmap

Seven milestones, **M0 → M6**, plus an entirely optional research track **M7**. Each milestone specifies:

- **Goal** — the one sentence it exists to satisfy.
- **Features** — the concrete capabilities that must exist, each with an ID, owning component, and a testable acceptance criterion.
- **Week by week** — what happens when, and the observable that says that week is done.
- **Artifacts** — the things that exist at the end and did not exist before.
- **Exit criteria** — the gate. If it fails, the milestone is not done, regardless of how much code exists.
- **Demo** — what you can literally show someone.
- **Out of scope** — what is explicitly *not* built here, so scope creep has somewhere to be refused.
- **Optional** — what can be dropped without invalidating the milestone.
- **Risks** — the one thing most likely to eat the milestone.

**Legend.** **M** = mandatory · **O** = optional · `[OPTIONAL]` = droppable without invalidating the milestone.

Assumes one person, ~30 effective hours per week, 24 weeks total.

---

## 2. The MVP

**MVP = v0.1.0, shipped at the end of M2.** One command:

```bash
npx vouch diff before.graphql after.graphql
```

It classifies every structural change and, for every break, prints a minimal client that compiles against the first schema and fails against the second.

**In the MVP:** GraphQL SDL · full structural relation · verdict + derivation · witness · text/JSON output · exit codes · npm package.

**Not in the MVP:** the Action · certificates · config file · baseline · registry · dashboard · blast radius · shrinking beyond path truncation · OpenAPI · any network call.

**Why this and not more.** Because *the witness is the product*. If a type-directed search cannot produce a client that a human reads and immediately believes, no amount of registry, dashboard, or certificate saves the project. M2 is the first moment that hypothesis can be tested, so it is the MVP.

---

## 3. Feature index

78 features across 8 milestones. Each milestone section expands its own table.

| Milestone | Features | Range | Theme |
|---|---|---|---|
| M0 | 10 | F0.1–F0.10 | Skeleton: the loop runs |
| M1 | 11 | F1.1–F1.11 | The relation: verdicts are correct |
| M2 | 13 | F2.1–F2.13 | The witness: breaks become legible |
| M3 | 15 | F3.1–F3.15 | Distribution and trust |
| M4 | 10 | F4.1–F4.10 | Reality: numbers instead of belief |
| M5 | 13 | F5.1–F5.13 | Blast radius: verdicts become decisions |
| M6 | 11 | F6.1–F6.11 | Launch |
| M7 | 6 | F7.1–F7.6 | Research (optional) |

---

## 4. M0 — Skeleton · weeks 1–2

**Goal.** Prove the pipeline shape end to end on a trivial schema, so every later milestone is filling in rather than inventing.

**Gate.** `vouch diff a.graphql b.graphql` prints a change list with source spans, on real schemas, in under two seconds.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F0.1 | **M** Monorepo scaffold | repo | `pnpm install && pnpm build && pnpm test` succeeds from a clean clone |
| F0.2 | **M** Layer-boundary lint | repo | Adding `import 'node:fs'` to `core` fails CI with a clear message |
| F0.3 | **M** CI pipeline | repo | lint + typecheck + test + build on Node 22 and 24, under 5 min |
| F0.4 | **M** IR type vocabulary | `core/ir` | `TypeRef`, `Field`, `Arg`, `TypeDef`, `VIR`, `Span`, `Change` compile; module contains no logic |
| F0.5 | **M** GraphQL frontend | `core/parse/graphql` | Multi-file merge works; `extend type` across files resolves; an invalid schema is rejected with a span |
| F0.6 | **M** Semantic lowering | `core/lower` | A real 200-type schema lowers fully; reachability is correct on 5 fixtures |
| F0.7 | **M** Content hash | `core/hash` | Same schema → same hash across runs and machines; a comment-only edit → unchanged hash |
| F0.8 | **M** Structural diff v0 | `core/diff` | Detects type add/remove, field add/remove, field type change, enum value add/remove |
| F0.9 | **M** `vouch diff` command | `cli` | Accepts two paths or two git refs; prints changes with `path:line:col`; exit 0 |
| F0.10 | **M** Fixture corpus v0 | `fixtures/` | 5 known-good and 5 known-breaking schema pairs, each with a one-line rationale |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 1 | Repo, CI, lint, `ir`, `parse/graphql`, `lower` | A real schema lowers to VIR in a test |
| 2 | `hash`, `diff` v0, `cli diff`, fixtures | `vouch diff` runs on a real pair and prints spans |

### Artifacts

A monorepo that builds, tests, and lints in CI; an IR; a working `diff`; ten fixtures.

### Exit criteria

- Cold run < 2 s on a 200-type schema.
- The boundary lint demonstrably fails when violated (verify by trying, not by assuming).
- The ten fixtures produce the expected change counts.

### Demo

`npx vouch diff old.graphql new.graphql` → a list of changes, each pointing at a line.

### Out of scope

Classification, verdicts, witnesses, config, CI integration, packaging.

### Risks

**Sinking days into a hand-rolled SDL parser.** Do not. `parse` + `buildASTSchema` + `validateSchema` from `graphql-js` is the entire point of F0.5, and it is a two-day job instead of a two-week one.

---

## 5. M1 — The relation · weeks 3–5

**Goal.** Decide compatibility correctly across the whole structural fragment, and be able to justify every verdict in one line.

**Gate.** 120/120 golden verdicts correct, including the recursive trap cases.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F1.1 | **M** Subtyping relation | `core/relation` | Reflexive on fixtures; terminates on recursive schemas; handles `nonNull`/`list`/`named` |
| F1.2 | **M** Position assignment | `core/classify` | Every change classified as `output`/`input`/`both`/`none`; verified on 20 fixtures |
| F1.3 | **M** Rule table, 22 change kinds | `core/classify` | Each kind has a verdict function and at least one golden test |
| F1.4 | **M** Verdict + derivation string | `core/classify` | Every change carries a one-line explanation a human can read |
| F1.5 | **M** Unreachable-type detection | `core/classify` | Changes inside unreachable types are `internal`, never `breaking` |
| F1.6 | **M** Coinductive recursion | `core/relation` | 5 trap tests where naive memoization is unsound pass correctly |
| F1.7 | **M** Golden suite (120 cases) | `fixtures/` | 120 pairs, each with expected verdict and rationale |
| F1.8 | **M** Property tests | `test/` | Reflexivity, transitivity, monotonicity, antisymmetry on the fragment |
| F1.9 | **M** JSON output | `cli` | `--format json` emits a stable schema; byte-identical across runs |
| F1.10 | **O** Strict/permissive enum & union | `core/classify` | Enum-add and union-add switchable by flag; default strict |
| F1.11 | **M** Suite has teeth | `test/` | Deliberately flipping one rule breaks at least one golden test |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 3 | `relation` core, position assignment, nullability/field/arg rules | The nullability case classifies correctly both directions |
| 4 | Enums, unions, interfaces, input objects, defaults; coinduction + memo | Recursive fixtures terminate correctly |
| 5 | Golden suite, property tests, JSON output, strict/permissive | 120/120 green |

### Artifacts

The relation; the classifier; a 120-case golden suite; property tests; JSON output.

### Exit criteria

- 120/120 verdicts correct.
- All 5 recursive traps correct (they are the ones a competent implementer gets wrong).
- The suite has teeth: an intentionally wrong rule causes failures.
- `--format json` is byte-identical across two runs and two machines.

### Demo

Two schemas, one changed line, and a verdict with a reason: *"output position: `String` is not a subtype of `String!`; a v1 client may receive null."*

### Out of scope

Witnesses, shrinking, certificates, config, CI.

### Optional

- `[OPTIONAL]` F1.10 permissive mode.
- `[OPTIONAL]` Rename detection heuristics (`possibleRenameOf`); nice message, not required.

### Risks

**Getting variance backwards in one construct and never noticing.** Write the golden suite adversarially — derive each expected verdict from the semantics first, then check the implementation. If you write tests to match the code, they test nothing.

---

## 6. M2 — The witness (MVP) · weeks 6–8 · **GATE**

**Goal.** Every break comes with a client that a human believes.

**Gate.** Ten witnesses reviewed by three people who are not you; all three agree each one breaks.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F2.1 | **M** Access-path search | `core/witness` | Finds a root-to-change path for every reachable break; handles interface/union inline fragments |
| F2.2 | **M** Nullability witness | `core/witness` | `T! → T` produces `null` at the correct path |
| F2.3 | **M** Enum witness | `core/witness` | New enum value chosen deterministically (lexicographic) |
| F2.4 | **M** Union witness | `core/witness` | New member as an object with `__typename` and minimal fields |
| F2.5 | **M** Input witnesses | `core/witness` | New required arg → a request that omits it; null-in-nonnull → a request sending null |
| F2.6 | **M** Witness assembly | `core/witness` | Emits operation, query text, variables, path, value |
| F2.7 | **M** Internal certifier v0 | `core/certify` | Three checks; rejects a hand-tampered witness |
| F2.8 | **M** Shrink v0 | `core/shrink` | Drops trailing path segments; re-certifies after each drop |
| F2.9 | **M** Text renderer | `core/report` | Witness block is readable in ≤ 12 lines |
| F2.10 | **M** Exit codes | `cli` | 0 / 1 / 2 / 3 / 4 exactly as specified |
| F2.11 | **M** 20-pair corpus | `fixtures/` | Real GraphQL schemas from open-source history, with known outcomes |
| F2.12 | **M** Self-audit script | `bench/` | Forces witness search on `compatible` verdicts; reports any hit |
| F2.13 | **M** npm publish | release | `npx vouch@0.1.0 diff` works on a clean machine |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 6 | Path search, nullability + field-removal witnesses | The §7 example reproduces exactly |
| 7 | Enum/union/input witnesses, assembly, certifier v0 | Every break on 10 pairs has a witness |
| 8 | Shrink v0, renderer, corpus, review, publish 0.1.0 | Three external reviewers agree |

### Artifacts

The witness engine; a minimal certifier; a text renderer; a 20-pair corpus; `vouch@0.1.0` on npm.

### Exit criteria

- All 20 pairs: every genuine break has a witness.
- Ten witnesses reviewed by three independent people; all agree.
- Self-audit finds zero hits on `compatible` verdicts.
- Median witness ≤ 6 lines; max ≤ 12.
- Offline, under 2 seconds.

### Demo

```text
Order.customerEmail : String! → String       ✗ BREAKING
  query { order(id: "ord_8812") { customerEmail } }
  const d = order.customerEmail.split("@")[1];
```

### Out of scope

Certificates as a public format, config, CI, registry, OpenAPI.

### Optional

- `[OPTIONAL]` F2.8 full shrinking (access + value + selection). Path truncation alone is enough for the MVP.
- `[OPTIONAL]` Markdown renderer. Text and JSON suffice.
- `[OPTIONAL]` Swift/Kotlin snippets. TypeScript rendering only.

### Risks

**Witnesses that are correct but unreadable.** If reviewers hesitate, the fix is usually better path selection, not deeper search. Also: a 40-node type path is not a witness, it is a proof sketch.

---

## 7. M3 — Distribution and trust · weeks 9–12

**Goal.** Make it adoptable in CI, and make the claim checkable by someone who does not trust you.

**Gate.** Installed on three real repositories and clean for two weeks.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F3.1 | **M** `.vouchrc.json` | `config` | Zod-validated; defaults; actionable error messages naming the field |
| F3.2 | **M** `vouch check` | `cli` | Resolves base/head from git; reads config; exit codes |
| F3.3 | **M** Baseline file | `cli` | `.vouch-baseline.json`; `vouch baseline` writes it; subsequent runs diff against it |
| F3.4 | **M** `--fail-on` policy | `cli` | `breaking` / `conditional` / `never` |
| F3.5 | **M** Certifier isolation | `core/certify` | Lint rule forbids importing `diff` or `classify`; CI fails on violation |
| F3.6 | **M** Certificate format | `core/certify` | `vouch/cert@1` with a published JSON Schema |
| F3.7 | **M** `vouch verify` | `cli` | Accepts valid certificates; rejects tampered ones with the failing check named |
| F3.8 | **M** 50 test vectors | `fixtures/certs/` | 10 valid, 40 tampered, all classified correctly |
| F3.9 | **M** `vouch explain <fp>` | `cli` | Prints derivation, witness, and certificate status for one change |
| F3.10 | **M** Markdown renderer | `core/report` | PR-comment layout with collapsible detail |
| F3.11 | **M** GitHub Action | `action` | `uses: vouch-dev/check@v1` works with the default token and no secrets |
| F3.12 | **M** Idempotent comment | `action` | Force-push updates the existing comment instead of duplicating |
| F3.13 | **M** Acknowledgements | `config` | `--acknowledge <fp>` persists; acknowledged breaks appear in the report, not the exit code |
| F3.14 | **O** SARIF output | `core/report` | Valid SARIF 2.1.0 accepted by code scanning |
| F3.15 | **M** Dogfooding | repo | Vouch's own schema is checked in its own CI |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 9 | Config, `check`, baseline, `--fail-on` | CI mode runs locally against a git repo |
| 10 | Certifier hardening, certificate format, `verify`, 50 vectors | All 50 vectors correct |
| 11 | `explain`, markdown renderer, Action, comment posting | A real PR gets a comment |
| 12 | Idempotency, acknowledgements, dogfooding, three repos | Three repos installed, two weeks clean |

### Artifacts

Config; `check`; baseline; certificates; `verify`; `explain`; a GitHub Action; a markdown renderer.

### Exit criteria

- Three real repositories installed.
- Zero false positives over two weeks.
- A PR comment shows a certified witness.
- `verify` passes 10/10 valid and rejects 40/40 tampered.
- A reviewer goes from a red check to understanding the break in one click.

### Demo

Open a PR that widens a field. The bot comments within 30 seconds with the verdict, the witness, and a link to the certificate.

### Out of scope

Registry, dashboard, blast radius, OpenAPI, hosted app.

### Optional

- `[OPTIONAL]` F3.14 SARIF.
- `[OPTIONAL]` HTML report (`vouch render --html`).
- `[OPTIONAL]` Swift/Kotlin witness rendering.

### Risks

**False positives.** One wrong "breaking" on a real team costs more than ten correct ones earn. Tune for precision; every suppression is reviewed; a false positive is a P0 bug, not a tuning note.

---

## 8. M4 — Reality · weeks 13–16 · **GATE**

**Goal.** Replace belief with numbers.

**Gate.** Precision ≥ 95% and recall ≥ 70% on a public labelled benchmark.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F4.1 | **M** Dataset format | `bench` | JSONL, one record per change, validated by a schema |
| F4.2 | **M** Loader | `bench` | Loads 200 records in under 1 s |
| F4.3 | **M** Labelling CLI | `bench` | Review a record, correct the label, write back with a note |
| F4.4 | **M** Replay harness | `bench` | Clone a repo, walk the schema history, diff every consecutive pair |
| F4.5 | **M** Metrics engine | `bench` | Precision, recall, confusion matrix, per-change-kind breakdown |
| F4.6 | **M** Report generator | `bench` | Markdown + JSON with methodology |
| F4.7 | **M** Nightly self-audit | CI | Cron job; fails the build on any hit |
| F4.8 | **M** Failure taxonomy | `docs` | Every false positive and false negative explained individually |
| F4.9 | **M** 200 labelled changes | `bench` | ≥ 5 repositories, every record citing its source |
| F4.10 | **O** Inter-annotator study | `bench` | κ ≥ 0.8 on a 50-item subsample |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 13 | Loader, labelling CLI, replay harness | Harness replays one repo end to end |
| 14 | Label the first 100 changes | 100 records with citations |
| 15 | Label the second 100; metrics engine | Precision/recall computed |
| 16 | Report, nightly self-audit, publish | Numbers published with methodology |

### Artifacts

A public benchmark; a replay harness; a metrics report; a failure taxonomy.

### Exit criteria

- Precision ≥ 95%.
- Recall ≥ 70%.
- Zero soundness bugs across a week of nightly self-audits.
- Every miss and every false positive is written up, including the embarrassing ones.

### Demo

A table: 200 changes, 96% precision, 74% recall, and a list of the eight things it got wrong and why.

### Out of scope

Fixing recall with heuristics. Improving numbers by shrinking the benchmark.

### Optional

- `[OPTIONAL]` F4.10 agreement study.
- `[OPTIONAL]` Public leaderboard.

### Risks

**Labelling is slow and sometimes arguable.** Two passes, publish disagreements, and keep the set small and honest. A benchmark everyone trusts at 150 items beats a benchmark nobody trusts at 2,000.

---

## 9. M5 — Blast radius · weeks 17–20

**Goal.** Turn "this is breaking" into "this is safe in April."

**Gate.** A demo where a breaking change shows three affected clients, their traffic share, and a projected clear date.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F5.1 | **M** Postgres schema | `registry-server` | 7 tables; forward-only migrations; indexes on lookup paths |
| F5.2 | **M** REST API | `registry-server` | 6 endpoints from plan §17.6; per-project tokens |
| F5.3 | **M** `vouch publish` | `cli` | Pushes a VIR blob by content hash; idempotent |
| F5.4 | **M** Registry client | `registry-client` | Typed; timeouts; retries; never blocks a verdict |
| F5.5 | **M** Client registration | `cli` | `vouch clients add` and `clients.json`; validated |
| F5.6 | **M** Correlation engine | `registry-server` | Intersects change paths with client consumed paths |
| F5.7 | **M** Clear-date estimator | `registry-server` | Decay fit + confidence band, labelled as an estimate |
| F5.8 | **M** Dashboard v1 | `web` | Timeline, change detail, deprecations, clients, blast radius |
| F5.9 | **M** Run history | `registry-server` | Runs and certificates stored and queryable |
| F5.10 | **M** Compatibility cache | `registry-server` | `(fromHash, toHash)` → record; repeated query is one row read |
| F5.11 | **O** Type generator | `codegen` | TS/Swift/Kotlin with `VOUCH_SCHEMA` hash constant |
| F5.12 | **O** Telemetry ingest | `registry-server` | Client version + operation from a gateway feed |
| F5.13 | **O** Hosted GitHub App | `app` | Check runs with inline annotations |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 17 | DB schema, API, `publish`, registry client | A schema publishes and reads back |
| 18 | Correlation, client registration, clear dates | A break maps to named clients |
| 19 | Dashboard v1 | Five views render from real data |
| 20 | Cache, polish, demo | The demo tells a complete story |

### Artifacts

A registry service and database; a client; a dashboard; a demo.

### Exit criteria

- Demo shows three affected client versions, traffic shares, and a clear date with a confidence band.
- With no registry configured, everything except blast radius still works.
- Deleting a project deletes its blobs (tested).

### Demo

*"This breaks iOS 1.x (12% of installs), Android 2.x (2%), and partner-v1. Estimated safe to ship 2026-04."*

### Out of scope

Real-time dashboards, alerting, SSO, billing.

### Optional

- `[OPTIONAL]` F5.11 codegen — the cheapest way to get real client data.
- `[OPTIONAL]` F5.12 telemetry.
- `[OPTIONAL]` F5.13 hosted App — the Action already covers CI without it.

### Risks

**Nobody fills in `clients.json`, so blast radius is empty.** Mitigation: one-screen registration, and an empty state that teaches what it would show with data. If this fails, codegen (F5.11) becomes mandatory rather than optional.

---

## 10. M6 — Launch · weeks 21–24

**Goal.** v1.0.0 in public.

**Gate.** A stranger goes from the landing page to a green check in under 10 minutes, using only the README.

### Features

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F6.1 | **M** README + quickstart | `docs` | Install to first verdict in ≤ 10 minutes, tested on a stranger |
| F6.2 | **M** Rules reference | `docs` | One page per construct, each with a runnable schema pair |
| F6.3 | **M** Nullability explainer | `docs` | The marketing piece: why your linter is wrong about `String! → String` |
| F6.4 | **M** Migration playbook | `docs` | Additive-then-deprecate, with real timelines |
| F6.5 | **M** Certificate spec | `docs` | Complete enough for an independent implementation |
| F6.6 | **M** Demo page | `web` | Paste two schemas → verdict + witness, under 2 s |
| F6.7 | **M** Public compatibility report | `docs` | One real OSS API, responsibly disclosed, credited |
| F6.8 | **M** Launch post | `docs` | The story, the numbers, the limit |
| F6.9 | **M** v1.0.0 | release | Certificate format frozen; semver |
| F6.10 | **O** OpenAPI 3.1 frontend | `core/parse/openapi` | One real OpenAPI repo checked correctly |
| F6.11 | **O** Hosted App | `app` | Org-wide install |

### Week by week

| Week | Focus | Done when |
|---|---|---|
| 21 | Docs site, README, rules reference | A stranger completes the quickstart |
| 22 | Demo page, public report, disclosure | Report drafted and sent to the project |
| 23 | Onboarding polish, freeze cert format, release candidate | rc1 published |
| 24 | Launch | v1.0.0 live |

### Artifacts

A docs site; a demo; a public report; v1.0.0.

### Exit criteria

- 10-minute onboarding verified on someone who is not you.
- 10 repositories with the Action installed.
- Public report published, subject project contacted first.
- Certificate format frozen and documented.

### Out of scope

Paid plans, enterprise features, a conference talk.

### Optional

- `[OPTIONAL]` F6.10 OpenAPI — valuable, not required for v1.0.
- `[OPTIONAL]` F6.11 hosted App.
- `[OPTIONAL]` VS Code extension.

### Risks

**Launching with a broken onboarding path.** The 10-minute test is the only one that matters; run it on three people before the post goes out.

---

## 11. M7 — Research · post-24 · entirely `[OPTIONAL]`

**Goal.** The theorem, for credibility and for the record. Not on the product's critical path.

| ID | Feature | Component | Acceptance |
|---|---|---|---|
| F7.1 | **O** Formal model | `research` | Types, values, clients, and `Val(S, T)` defined |
| F7.2 | **O** Relation definition | `research` | Coinductive relation mirroring `core/relation` |
| F7.3 | **O** Soundness theorem | `research` | *If `classify` says compatible, no well-typed client breaks* |
| F7.4 | **O** Mechanization | `research` | Lean 4 or Rocq; compiles with no axioms beyond stdlib |
| F7.5 | **O** Z3 cross-check | `research` | Small schemas: solver and witness engine agree on 100 cases |
| F7.6 | **O** Paper draft | `research` | "Compatibility as subtyping" |

**Exit criteria.** F7.4 compiles; F7.3 covers the structural fragment; the writeup states plainly what is not covered.

**Why optional.** The relation will still be moving until M4. Proving a moving definition wastes months, and the product does not depend on it. Schedule it when the definition has stopped changing.

---

## 12. Milestone dependencies

```
M0 ──► M1 ──► M2 ══ GATE ══► M3 ──► M4 ══ GATE ══► M5 ──► M6
                                         │
                                         └──► M7 (optional, any time after M4)
```

- **M1 depends on M0's IR.** Freeze the IR after M1 or the golden suite churns.
- **M2 depends on M1's verdicts.** A witness for a wrong verdict is worse than no witness.
- **M4 depends on M3's certificates.** The benchmark grades verifiable claims.
- **M5 does not block M6.** If blast radius slips, ship v1.0 without it and follow with v1.1.

---

## 13. Pre-committed cut list

If the schedule slips, cut in this order.

| Order | Cut | Consequence | Acceptable? |
|---|---|---|---|
| 1 | SARIF (F3.14) | No inline annotations; comments still work | Yes |
| 2 | Full shrinking (F2.8) | Witnesses 8–12 lines instead of 4 | Yes, pre-1.0 |
| 3 | Certificates (F3.5–F3.8) | Witnesses printed, not independently checkable | Yes for MVP, **no** for v1.0 |
| 4 | Dashboard (F5.8) | Registry API only, no UI | Yes, temporarily |
| 5 | Codegen (F5.11) | Manual client registration only | Yes |
| 6 | Hosted App (F5.13) | Action only | Yes |
| 7 | OpenAPI (F6.10) | GraphQL only through v1.1 | Yes |

Cutting is allowed. Cutting silently is not — every cut goes in the changelog and the next roadmap revision.

## 14. Never cut

1. **The witness** — without it this is a linter with extra steps.
2. **Precision over recall** — a false positive is a trust event; a false negative is an incident.
3. **The self-audit (F4.7)** — the only mechanism that catches unsoundness before a user does.
4. **The benchmark (M4)** — the gate that says whether any of this works.

---

## 15. Versioning

| Version | Milestone | Meaning |
|---|---|---|
| `0.1.0` | M2 | MVP: CLI diff + witnesses |
| `0.2.0` | M3 | CI-ready: check, Action, certificates |
| `0.3.0` | M4 | Validated: benchmark and published numbers |
| `0.4.0` | M5 | Registry and blast radius |
| `1.0.0` | M6 | Certificate format frozen; API stable |

- Pre-1.0 breaking changes allowed, but changelogged with a migration note.
- `vouch/cert@1` is versioned independently and freezes at v1.0.0.
- CLI exit codes freeze at v0.1.0 — they are an interface from day one.

---

## 16. Assumptions and what breaks if false

| Assumption | If false |
|---|---|
| Node 22 available in user CI | Ship a bundled binary; +1 week |
| Schemas live in the repo as SDL, not generated | The Action needs a build step first; scope change |
| GraphQL APIs with long-lived clients are common | Beachhead weakens; consider OpenAPI-first |
| One person, ~30 h/week, no other job | Timeline stretches roughly linearly |
| Infra under $50/month | Registry becomes a funding question |
| Variance, not recursion, is the hard part | If recursion dominates, +2 weeks in M1 |

---

## 17. What success looks like at week 24

- 25 repositories with the Action; 500 PR checks per week.
- Precision ≥ 95% on a public, honest benchmark.
- One public compatibility report on a real open-source API, credited.
- One team that is not you saying *"we found the client that breaks"* about their own change.
- A v1.0.0 whose certificate format a stranger could reimplement from the docs.

If the witness is convincing and the precision is real, everything else here is packaging. If either is missing, no amount of M5 and M6 saves it.
