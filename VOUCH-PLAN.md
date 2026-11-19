# Vouch — Project Plan

**A compatibility checker for API schemas that proves what breaks, and shows you the client that breaks.**

Version: 0.2 · Status: planning · Owner: solo, full-time

> **What changed in 0.2.** The design is unchanged. The pipeline is now specified stage by stage, with inputs, outputs, algorithms, and failure modes (§9), including a single change traced end to end. The tech-stack table became a decision record with rejected alternatives and a reversibility score (§13). The deliverables list became a catalog with interfaces, usage, and acceptance criteria (§17).

## Contents

| § | Section | § | Section |
|---|---|---|---|
| [0](#0-executive-summary) | Executive summary | [10](#10-the-witness-engine) | The witness engine |
| [1](#1-problem-domain) | Problem domain | [11](#11-blast-radius-and-the-client-registry) | Blast radius and registry |
| [2](#2-problem-definition) | Problem definition | [12](#12-stages-and-milestones) | Stages and milestones |
| [3](#3-existing-solutions-and-gaps) | Existing solutions | [13](#13-technology-decisions) | Technology decisions |
| [4](#4-objectives) | Objectives | [14](#14-testing-and-validation-strategy) | Testing and validation |
| [5](#5-scope) | Scope | [15](#15-metrics) | Metrics |
| [6](#6-users-and-use-cases) | Users and use cases | [16](#16-risks-and-mitigations) | Risks |
| [7](#7-product-definition) | Product definition | [17](#17-deliverables) | Deliverables |
| [8](#8-theory-the-compatibility-relation) | Theory | [18](#18-sustainability) | Sustainability |
| [9](#9-architecture-and-pipeline) | Architecture and pipeline | [19](#19-open-questions) | Open questions |

---

## 0. Executive summary

Every API changes. Every change risks breaking a client. Today the question *"what breaks if I ship this?"* is answered with rules of thumb, field-diff heuristics, and hope. The tools that exist are conservative linters: they flag what looks scary and cannot prove what is safe.

Vouch answers the question with **type theory**. Schema compatibility is subtyping: outputs are covariant, inputs are contravariant, and nullability, optionality, unions, and enums all fall out of the same rule. When a change is safe, Vouch proves it. When it is not, Vouch produces a **minimal client that compiles against the old schema and fails against the new one** — a witness, not a warning.

The product is a CI check (GitHub App + CLI), a schema registry that tracks real client versions, and a deprecation dashboard that turns "this is breaking" into "this is safe to ship in April."

**Beachhead:** GraphQL APIs with mobile clients, because mobile clients cannot be force-updated, which makes compatibility a live business risk rather than an engineering nicety.

---

## 1. Problem domain

### 1.1 The schema evolution problem

An API schema is a contract between a producer (the service) and an unknown, uncoordinated set of consumers (apps, SDKs, partners, scripts). The contract must evolve — features ship, data models change, fields get deprecated — but every evolution is a potential break for a consumer that cannot be updated in lockstep.

This is universal: REST/OpenAPI, GraphQL, gRPC/protobuf, TypeScript package types, database schemas. The specific failure modes differ; the shape is identical.

### 1.2 Why compatibility is hard

Four things make it hard, and all four are type-theoretic:

1. **Variance.** The direction of safety flips between inputs and outputs. Widening an output type is dangerous; widening an input type is safe. Almost everyone gets this backwards at least once, because "more values" *feels* like "more permissive."
2. **Nullability.** A nullable field is a supertype of a non-null field. So `String! → String` on a response is a *widening* — breaking — even though it looks like loosening. This is the single most common real-world break.
3. **Structural recursion.** Schemas are recursive (`Order → Customer → Order`). Subtyping is coinductive, and naive implementations either loop forever or silently become unsound.
4. **Unknown consumers.** You cannot enumerate the clients, so you cannot test against them. Any approach that requires the consumer to participate (contract testing) has a hole exactly where the risk is.

### 1.3 The cost

- Production incidents from schema changes: order-history screens blanking, checkouts failing, apps crashing on decode errors.
- Mobile apps are the worst case: a two-year-old build stays installed, and you cannot patch it.
- Engineering time: review-by-vibes, rollbacks, postmortems, "add it to the checklist" action items that don't work.
- Business risk: partner integrations and enterprise customers break silently.

---

## 2. Problem definition

### 2.1 Formal statement

Let a schema `S` assign to each type name a structure, and to each operation a request type `I` and response type `O`. Let `Val(S, T)` be the set of values conforming to `T` under `S`.

A **client** `C` is well-typed against `S` if every field access respects the nullability and structure declared in `S`. Clients are compiled against one schema and run against another.

A schema change `S → S'` is **backward compatible** iff every client well-typed against `S` remains well-typed against `S'`. That decomposes into exactly two conditions:

- **Inputs (contravariant):** `Val(S, I) ⊆ Val(S', I')` — every request a v1 client can construct must still be accepted.
- **Outputs (covariant):** `Val(S', O') ⊆ Val(S, O)` — every response v2 can produce must still be handled by a v1 client.

**Vouch's core claim:** it decides this relation soundly for a well-defined fragment, and produces a witness for every negative answer.

### 2.2 Failure taxonomy

| Class | Example | Why it breaks | How often it's missed |
|---|---|---|---|
| Nullability widening (output) | `String! → String` | Client decodes null into a non-optional | Very often |
| Required input added | new `String!` arg | Existing clients omit it | Often |
| Field removed | `customerEmail` deleted | Client reads a field that no longer exists | Rarely (obvious) |
| Type narrowed (input) | `String → String!` | Client sends null | Sometimes |
| Enum value added (output) | new `OrderStatus` | Client switch is not exhaustive | Often |
| Enum value removed (input) | `CANCELLED` dropped | Client sends it | Sometimes |
| Default changed | `limit: Int = 10 → 20` | Behavior changes silently | Almost never |
| Union member added (output) | new object type | Client fragment doesn't match | Sometimes |
| Recursive structure changed | deep field nullability | Only shows up under recursion | Almost never |

### 2.3 Why current practice fails

The industry answers the compatibility question three ways, and each has a structural hole:

1. **Rules-based diffing** — a table of "these changes are breaking." Fast, no reasoning, no proof, no witness, and both over- and under-blocks.
2. **Contract testing** — consumers publish expectations; the producer runs them. Only covers *known* consumers, requires participation, and is runtime rather than design-time.
3. **Review by senior engineer** — doesn't scale, doesn't survive turnover, and produces the postmortem action item "add to checklist."

None of them can answer *"is it actually safe?"* or *"show me what breaks."*

---

## 3. Existing solutions and gaps

| Tool | Domain | What it does | Gap |
|---|---|---|---|
| **Buf** | Protobuf | Registry + `buf breaking` rule engine | Rules-based; protobuf only; no witnesses |
| **GraphQL Hive** | GraphQL | Schema registry, schema checks, operation checks | Rules-based; no variance model; no proof of safety |
| **Apollo Studio** | GraphQL | Schema checks + field usage | Requires Apollo stack; usage-based, not semantic |
| **oasdiff** | OpenAPI | Diffing + breaking-change rules | Heuristic; common false positives/negatives |
| **Optic** | OpenAPI | API diffing | Heuristic; product direction has shifted |
| **Pact** | Any HTTP | Consumer-driven contract testing | Requires consumers; runtime; unknown consumers invisible |
| **api-extractor** | TypeScript | API report generation | Not a compatibility checker |
| **arethetypeswrong** | npm | Type resolution correctness | Not about version compatibility |
| **SemVer tooling** | Packages | Conventional-commit automation | Doesn't check semantics at all |

**The unoccupied position:** a tool that *reasons* — proves safety when it can, produces a witness when it cannot, and knows which clients are affected. Every incumbent is a linter. Vouch is a type checker.

---

## 4. Objectives

### 4.1 Primary

1. **Correctly decide compatibility** for GraphQL SDL changes, with a documented, sound relation covering nullability, fields, arguments, enums, unions, interfaces, and defaults.
2. **Generate a minimal witness** for every breaking change: a client snippet that is well-typed against the old schema and ill-typed against the new one.
3. **Report blast radius**: which registered client versions are affected by a change.
4. **Provide a migration path**: an additive alternative change and an estimated clear date when the breaking change becomes safe.

### 4.2 Secondary

5. Support OpenAPI 3.x as a second frontend on the same IR.
6. Publish a mechanized soundness argument for the compatibility relation.
7. Build a public benchmark of real schema histories with labelled breakages.

### 4.3 Success metrics

| Metric | Target (6 months) |
|---|---|
| Precision of "breaking" verdicts | ≥ 99% (false positives are the trust-killer) |
| Recall on labelled benchmark | ≥ 90% |
| Witness validity (independently checkable) | 100% |
| Median witness size | ≤ 6 lines |
| Time to verdict per schema pair | < 5 s |
| Repos with the GitHub App installed | 25 |
| Weekly PRs checked | 500 |

---

## 5. Scope

### 5.1 In scope

- GraphQL SDL (primary), OpenAPI 3.x (secondary).
- Structural compatibility: types, fields, arguments, nullability, enums, unions, interfaces, input objects, defaults, deprecation.
- Witness generation and minimization.
- Client registry + blast radius (manual and telemetry-fed).
- CLI, GitHub App, dashboard.
- A worked soundness argument and a validation benchmark.

### 5.2 Out of scope (explicit non-goals)

- **Runtime correctness or business-logic verification.** Vouch reasons about types, not about whether `total` is computed correctly.
- **Schema style/lint.** Naming, description, complexity limits — not our job.
- **An API gateway or proxy.**
- **Replacing contract testing.** Vouch complements it; it covers unknown consumers, which Pact cannot.
- **Automatic code generation or migration.**
- **Generic programming language compatibility.** TypeScript `.d.ts`, protobuf, Avro: later, maybe never.
- **Federation/subgraph composition** in v1. Noted as a future frontend.
- **Deciding arbitrary semantic equivalence.** Only the structural fragment.

Scoping out is the most important part of this document. Every item above would double the schedule.

---

## 6. Users and use cases

### 6.1 Personas

- **Priya — API platform engineer.** Owns the schema. Reviews every change. Wants to stop being the human compatibility oracle.
- **Marcus — mobile lead.** Ships apps that live for two years. Wants to know when it's safe to change the API.
- **Dana — SDK maintainer.** Publishes a client library. Wants CI to tell her when upstream breaks her.
- **Sam — partner integration engineer.** Consumes the API without access to the backend repo. Wants a compatibility guarantee before upgrading.

### 6.2 Use cases

**UC-1: The PR gate (primary).** A schema change is proposed. CI runs Vouch. If compatible, a green check and a one-line explanation. If breaking, a red check, a witness, a blast radius, and a suggested additive alternative. The author must either change the approach or explicitly acknowledge the break with a migration plan.

**UC-2: The release gate.** A version tag is cut. Vouch runs against the previous release. A release that hasn't been checked cannot publish.

**UC-3: Deprecation planning.** The schema owner opens the dashboard, sees every deprecated field, what is blocking its removal, and the projected clear date. "We can remove `customerEmail` in April."

**UC-4: Client audit.** A mobile team asks "are we behind?" Vouch diffs the client's generated types against the live schema and lists the breaking changes they haven't absorbed.

**UC-5: Public API review.** Before announcing v2, the team checks compatibility across every published operation and produces a public changelog with per-change verdicts.

---

## 7. Product definition

### 7.1 Core concepts

- **Schema** — a versioned API description.
- **Change** — a single structural difference between two schemas.
- **Verdict** — `compatible`, `breaking`, or `conditional` (needs a data-integrity precondition, e.g. narrowing an output to non-null requires the data to guarantee it).
- **Witness** — a minimal client and value pair that distinguishes the two schemas.
- **Blast radius** — the set of registered clients affected.
- **Migration path** — an additive alternative plus the conditions under which the breaking change becomes safe.

### 7.2 The four outputs

Every run produces, per change:

1. **A verdict**, with the typing derivation in one line.
2. **A witness** (if breaking), minimized.
3. **A blast radius** (if a registry is connected).
4. **A migration path** (if breaking), including an estimated clear date.

---

## 8. Theory: the compatibility relation

This is the heart of the product and the part worth doing properly.

### 8.1 Semantic model

Types denote sets of values. Define:
- `Val(S, T)` recursively over the schema.
- A *frame* is a finite access path into a value.
- A client is a finite set of accesses, each with an expected structure and nullability.

A client is well-typed against `S` if every access is defined in `S` and respects nullability. Compatibility is then the set-inclusion conditions of §2.1.

### 8.2 Variance, stated once

The whole rule set follows from one principle:

> **Outputs are covariant; inputs are contravariant.**

- Response position: new type must be a **subtype** of the old (`S' ≤ S`).
- Request position: new type must be a **supertype** of the old (`S ≤ S'`).

Every other rule is this principle applied to a construct.

### 8.3 The compatibility table

| Construct | Position | Change | Verdict | Why |
|---|---|---|---|---|
| Field type | output | `T! → T` (widen) | **breaking** | More values than the client can handle |
| Field type | output | `T → T!` (narrow) | **conditional** | Safe for clients; requires data to be non-null |
| Field type | input | `T → T!` (narrow) | **breaking** | Clients may send null |
| Field type | input | `T! → T` (widen) | **compatible** | Accepts everything it used to |
| Field | output | remove | **breaking** | Access no longer resolves |
| Field | output | add | **compatible** | Nobody reads it yet |
| Field | input | add required | **breaking** | Clients omit it |
| Field | input | add optional | **compatible** | Clients omit it safely |
| Field | input | remove | **breaking** | Clients may send it |
| Argument | any | add required | **breaking** | Existing calls omit it |
| Argument | any | add optional | **compatible** | Defaulted |
| Argument | any | remove | **breaking** | Existing calls pass it |
| Enum value | output | add | **breaking**¹ | Exhaustive clients miss the case |
| Enum value | output | remove | **compatible** | Fewer values to handle |
| Enum value | input | add | **compatible** | Clients never send it |
| Enum value | input | remove | **breaking** | Clients may send it |
| Union member | output | add | **breaking**¹ | Fragments may not match |
| Union member | output | remove | **compatible** | Fewer cases |
| Default value | input | change | **breaking** | Silent behavior change |
| Deprecation | any | add | **compatible** | No structural change |
| Recursive cycle | any | any change inside | **computed coinductively** | See §8.4 |

¹ Configurable: strict mode (default) treats this as breaking; permissive mode follows the GraphQL spec's "clients must handle unknown values" rule and treats it as compatible.

### 8.4 Recursive types — the subtle part

Schemas are regular trees. Subtyping is therefore **coinductive**: to check `T ≤ T'`, assume the pair and check the structures; if you revisit a pair already on the assumption set, succeed.

Naive recursive comparison without memoization loops. Naive memoization without a coinductive assumption set is *unsound* — it accepts pairs that should fail. This is the same trap as the Amber rule in recursive subtyping, and it is the one place where a competent implementer can still get it wrong. The witness side is easier: client accesses are finite, so every counterexample has a finite unfolding.

### 8.5 Soundness and completeness

**Soundness (must have).** If Vouch says `compatible`, then no well-typed client breaks. This is checked *empirically* by a self-audit fuzzer (run the witness search even on positive verdicts; any hit is a soundness bug in Vouch) and *mathematically* by a mechanized argument in Lean or Rocq.

**Completeness (nice to have).** If Vouch says `breaking`, a witness exists. This is guaranteed by construction if the witness engine is total over the negative fragment — which is why the two are built together.

**Decidability.** The structural fragment is decidable because schemas are finite regular trees and the relation is coinductive with finite assumptions. TypeScript-style conditional types would break this, which is one reason they're out of scope.

### 8.6 The witness, formally

Given `S`, `S'`, and a break, a witness is a pair `(access path p, value v)` such that:

- `p` is well-typed against `S` with type `T`.
- `v ∈ Val(S', T')` at path `p`.
- `v ∉ Val(S, T)`.

That is, `v` is a value the new server can produce that the old client's type cannot accept. The witness is *checked*, not asserted: the certifier re-runs the typing derivation on both schemas.

---

## 9. Architecture and pipeline

### 9.1 Overview

The pipeline is a pure function from two schema documents to a report. Only three stages touch the outside world: **acquisition** (reads git/HTTP), **correlation** (reads the registry), and **persistence** (writes it). Everything between them is deterministic, side-effect free, and testable in memory.

Technology choices are recorded separately in §13. This section is about structure.

```
schema files
   │
   ▼
[ parse ]  ──►  AST (per-format)
   │
   ▼
[ lower ]  ──►  VIR (Vouch IR): positions, nullability, cycles, defaults
   │
   ▼
[ diff ]   ──►  Change list (structural)
   │
   ▼
[ classify ] ─►  verdict per change (position-aware variance, coinductive)
   │
   ├─ compatible ─► report
   │
   └─ breaking ──► [ witness ] ──► [ shrink ] ──► [ certify ] ──► report
                        │
                        ▼
                  [ registry ]  ──► blast radius + clear date
```

### 9.2 The pipeline, stage by stage

Fourteen stages. Each has a typed input, a typed output, and a declared failure mode. Nothing between S1 and S11 performs I/O.

#### S0 — Trigger

**In.** CLI argv, or a GitHub webhook payload; `.vouchrc.json`.
**Out.** `RunContext { runId, trigger, repo, baseRef, headRef, schemaPaths, mode, budgetMs, options }`.
**Algorithm.** Normalize both entry points into the same context. `mode` is `baseline` when there is no base revision, `check` when there is, `release` when the trigger is a tag.
**Fails.** Missing config → defaults plus a warning. Missing schema path → S1 error.
**Details.** In a monorepo, one run may contain several *units* (independent schema roots); each unit flows through S2–S13 separately and the run aggregates at the end.

#### S1 — Acquisition

**In.** `RunContext`.
**Out.** `SourceSet { base: SourceFile[] | null, head: SourceFile[] }` where `SourceFile = { path, text }`.
**Algorithm.** CLI: read the working tree for `head`, and `git show <base>:<path>` for `base`. Action/App: `actions/checkout` already has both, or `octokit.repos.getContent({ ref })`. Files are collected by the globs in config, deduplicated, and **sorted by path** so downstream output is stable.
**Fails.** Head file missing → exit 3. Base file missing → switch to `baseline` for that unit.
**Details.** A rename appears as a delete plus an add; the diff stage detects it. Files are read as UTF-8 and normalized to `\n`. Nothing is fetched beyond the configured globs.

#### S2 — Parse

**In.** `SourceSet`.
**Out.** `ParsedUnit { schema: GraphQLSchema, ast: DocumentNode, spans: SpanMap }`.
**Algorithm.**
1. `parse()` each file with `graphql-js`.
2. Concatenate all definitions into one `DocumentNode` — this is what makes `extend type` across files work.
3. `buildASTSchema(merged)` to resolve extensions, interfaces, and root operation types.
4. `validateSchema(schema)` to reject an invalid schema before any diffing.
5. Index `astNode.loc` → `Span` for every type, field, arg, and enum value.

**Fails.** Syntax error → exit 3 with `path:line:col` and the offending line. Duplicate definition → exit 3. Unresolved type reference → exit 3.

**Key decision.** Work on the *schema*, not the raw AST. The AST is syntax; `buildASTSchema` gives you semantics — merged extensions, resolved roots, checked interfaces — for free. Reimplementing that resolution is how you acquire bugs.

#### S3 — Lower to VIR

**In.** `ParsedUnit`.
**Out.** `VIR` with `hash`.
**Algorithm.**
1. Walk `schema.getTypeMap()`, skipping names beginning with `__` (introspection) and built-in scalars.
2. Convert every `GraphQLType` into the normalized `TypeRef` form (`nonNull(list(named("String")))`), so nullability is explicit data rather than a `!` suffix.
3. Copy fields, args, defaults, enum values, union members, interface implementations, and `@deprecated`.
4. **Compute reachability** by BFS: start from the three root operation types over output-typed edges; record `output: true` for everything reached. Do the same from input positions (arg types and input-object fields) for `input: true`. A type can be both; an unreachable type is `internal`.
5. Sort everything by name.
6. Hash: SHA-256 over the canonical JSON **with spans and descriptions stripped**, so a comment-only change does not create a new version.

**Fails.** A cycle in reachability is fine — BFS marks visited. An undefined reference is impossible here because S2 validated.
**Details.** Custom scalars are opaque (`scalar` type defs). Directives other than `@deprecated` are recorded but not classified in v1. Empty types are legal and preserved.

#### S4 — Version and cache

**In.** `VIR`.
**Out.** `{ hash, vir }` and a cache lookup.
**Algorithm.** Content-address the VIR. Check a local content-addressed cache (`~/.cache/vouch/vir/<hash>.json`) and the registry if configured. A repeated comparison of the same pair is a cache hit and skips S5–S10 entirely.
**Fails.** Corrupt cache entry → refetch/recompute, never trust.

#### S5 — Diff

**In.** `VIR_base`, `VIR_head`.
**Out.** `Change[]`, deterministically ordered.
**Algorithm.**
1. Match types by name; emits `typeAdded`, `typeRemoved`, or `typeKindChanged`.
2. For matched types, match fields/values/members by name.
3. Emit one `Change` per structural difference, using a closed union of ~20 kinds (§9.6).
4. Detect renames: a `fieldRemoved` and a `fieldAdded` on the same type with an identical printed type and edit distance ≤ 3 are tagged `possibleRenameOf` — still breaking, but the report can say "did you mean to rename?".
5. Sort by `(kindRank, path)`.

**Fails.** Never throws; a malformed VIR is a bug, not a user error.
**Details.** A change to an argument's type is a separate change from a change to the field's type, because they have opposite variance. A type whose kind changes (object → interface) is emitted as `typeKindChanged` and classified as remove-plus-add. Additions and removals inside *unreachable* types are emitted but classified `internal`.

#### S6 — Classify

**In.** `Change[]`, both VIRs.
**Out.** `Classified[]` — each change plus `position`, `verdict`, `derivation`, `severity`.
**Algorithm.**
1. **Determine position** from the schema, not from the diff:
   - object/interface field → `output`
   - union member → `output`
   - field argument → `input`
   - input-object field → `input`
   - enum used in both positions → `both` (worst verdict wins)
2. **Check variance.**
   - `output`: require `subtype(new, old)`.
   - `input`: require `supertype(new, old)`, i.e. `subtype(old, new)`.
   - Add/remove: handled by the construct rules (§8.3).
3. **Subtyping** is coinductive with a memo table keyed by `(typeA, typeB)` and an assumption set. Revisiting a pair on the current path succeeds; revisiting a pair already *proved* succeeds from the memo; revisiting a pair currently *in progress elsewhere* must not short-circuit to true.
4. Map to a verdict: `compatible`, `breaking`, `conditional` (output narrowing to non-null — safe for clients, requires a data invariant), or `internal` (unreachable).
5. Emit a one-line derivation string for the report.

**Fails.** Any unexpected structure → `unknown`, never `compatible`. Fail closed.
**Details.** This is the whole theory in code, and it is the only place it lives. `classify` imports `vir` and a `relation` module; it does not import `diff`, the filesystem, or the clock.

#### S7 — Aggregate

**In.** `Classified[]`, config, baseline file.
**Out.** `RunSummary { verdict, counts, changes, acknowledged[] }`.
**Algorithm.** Remove acknowledged changes by fingerprint. Run verdict = worst of the remaining. Apply config severity overrides (strict vs permissive enum handling).
**Fails.** Unknown changes count as breaking for the run verdict, and are reported separately so they can be triaged.

#### S8 — Witness request

**In.** Breaking changes.
**Out.** `WitnessRequest[]`.
**Algorithm.** One request per breaking change. Skipped for `internal` and `conditional`. In the nightly self-audit mode, requests are also created for `compatible` changes — and any witness found there is a **soundness bug in Vouch**, which is a P0.
**Fails.** Budget exceeded → witness status `skipped`, run verdict stays breaking.

#### S9 — Witness construction

**In.** `WitnessRequest`.
**Out.** `Witness`.
**Algorithm.**
1. **Find an access path** in the *old* schema: BFS from a root operation type to the parent type of the changed element. Selections through an interface or union carry an inline fragment (`... on T`), so a path is `{ field, onType? }[]`.
2. **Build the discriminating value** for the changed leaf:
   - old `T!`, new `T` → the value is `null`.
   - enum gained a value → that value (lexicographically smallest for determinism).
   - union gained a member → `{ __typename: newMember }` plus minimal valid fields.
   - list element changed → `[v]`.
   - object field changed → an object with that field set and every other required field at its minimal value.
3. **For input changes** the witness is a *request*, not a response: an operation that omits a newly required argument, or passes `null` where the new type forbids it.
4. Assemble `{ operation, query, variables, path, value }`.

**Fails.** No path exists (the type is only reachable through something that was itself removed) → emit a `structural` witness, which is the schema delta itself, and label it honestly. Not every break has a client-shaped witness.

#### S10 — Shrink

**In.** `Witness`.
**Out.** Smaller `Witness`.
**Algorithm.** Greedy, three passes, each re-certified before acceptance:
1. drop path segments from the end;
2. shrink selection sets to the minimum required by the query;
3. minimize the value (drop optional fields, choose the smallest enum literal).
Stop at a fixpoint or at the node/time budget. Deterministic tie-break: size, then lexicographic.

**Fails.** Never accept a witness that fails re-certification.

#### S11 — Certify

**In.** `Witness`, both VIRs, the `Change`.
**Out.** `Certificate`.
**Algorithm.** A **separate module** with its own query type checker and value checker. It does not import `diff` or `classify`. It checks exactly three things:
1. the query is well-typed against the old schema;
2. the value conforms to the new schema at that path;
3. the value does **not** conform to the old schema at that path.

**Fails.** Any check fails → the witness is discarded and the change is reported `unverified`, which is treated as breaking. Fail closed.

This separation is the trust boundary: a bug in the diff cannot produce a false certificate, because the certifier never sees the diff.

#### S12 — Correlate

**In.** Changes, registry client index.
**Out.** `BlastRadius { client, version, share, consumedSince }[]` and `clearDate` per blocking client.
**Algorithm.** Intersect each change's path with each registered client's consumed paths; join with traffic share; fit a simple decay curve for the clear date.
**Fails.** No registry → skip the stage entirely and say so in the report.

#### S13 — Render and persist

**In.** `RunSummary`, `Certificate[]`, `BlastRadius`.
**Out.** Exit code; text/markdown/JSON/SARIF/HTML; a registry record.
**Algorithm.** One renderer per surface, each deterministic. Persist the run, the schema version blob, and certificates if a registry is configured.
**Fails.** Persistence failure is a warning, not a verdict change: a checker that cannot write to a database must still be able to say "breaking."

### 9.3 One change, traced end to end

The PR from §7, followed through every stage.

**S1 in — head:**

```graphql
type Order {
  id: ID!
  status: OrderStatus!
  customerEmail: String
  total: Money!
  placedAt: DateTime!
}
```

**S3 out — VIR fragment (spans elided):**

```json
{
  "k": "object",
  "name": "Order",
  "fields": [
    { "name": "customerEmail", "type": { "k": "named", "name": "String" }, "args": [], "deprecated": false },
    { "name": "id",            "type": { "k": "nonNull", "of": { "k": "named", "name": "ID" } }, "args": [], "deprecated": false }
  ]
}
```

**S5 out — one change:**

```json
{
  "fingerprint": "sha256:9f2c…",
  "kind": "fieldTypeChanged",
  "path": ["Order", "customerEmail"],
  "position": "output",
  "old": "String!",
  "new": "String"
}
```

**S6 out — verdict:**

```json
{
  "verdict": "breaking",
  "derivation": "output position: String is not a subtype of String! (nullable ⊄ non-null); a v1 client may receive null where it expects a string",
  "severity": "breaking"
}
```

**S9 out — witness:**

```json
{
  "kind": "client",
  "operation": "query",
  "query": "query { order(id: \"ord_8812\") { customerEmail } }",
  "path": [{ "field": "order" }, { "field": "customerEmail" }],
  "value": { "order": { "customerEmail": null } }
}
```

**S11 out — certificate:**

```json
{
  "v": "vouch/cert@1",
  "change": { "fingerprint": "sha256:9f2c…", "kind": "fieldTypeChanged", "path": ["Order", "customerEmail"] },
  "from": { "hash": "sha256:aa…", "ref": "v1.14.0" },
  "to":   { "hash": "sha256:bb…", "ref": "v2.0.0" },
  "verdict": "breaking",
  "witness": { "query": "query { order(id: \"ord_8812\") { customerEmail } }", "value": null },
  "checks": [
    { "name": "query-well-typed-against-from", "ok": true },
    { "name": "value-conforms-to-to",          "ok": true },
    { "name": "value-violates-from",           "ok": true }
  ]
}
```

**S13 out — exit code 1**, plus a PR comment.

### 9.4 Components

| Component | Input → Output | I/O? | Notes |
|---|---|---|---|
| `acquirer` | `RunContext` → `SourceSet` | git/HTTP | The only place that reads files |
| `parser/graphql` | text → `GraphQLSchema` | no | `graphql-js` |
| `parser/openapi` | text → `GraphQLSchema`-shaped IR | no | Phase 6 |
| `lower` | schema → `VIR` + reachability | no | Pure |
| `hasher` | `VIR` → `sha256` | no | Canonical JSON |
| `differ` | `VIR × VIR` → `Change[]` | no | Pure, deterministic |
| `relation` | `TypeRef × TypeRef` → `bool` | no | Coinductive subtyping |
| `classifier` | `Change × VIR × VIR` → `Verdict` | no | The theory |
| `witnesser` | `Change` → `Witness` | no | Type-directed search |
| `shrinker` | `Witness` → `Witness` | no | Re-certifies each step |
| `certifier` | `Witness × VIR × VIR` → `Certificate` | no | **Separate code path** |
| `correlator` | `Change × Registry` → `BlastRadius` | registry | Optional |
| `renderers` | result → text/md/json/sarif/html | no | One per surface |
| `config` | JSON → `Config` | file | Zod-validated |
| `registry` | HTTP → Postgres | yes | Versioned schemas, clients |
| `app` | webhook → run → comment | yes | Phase 5 |
| `action` | workflow → run | yes | Phase 3 |

### 9.5 Vouch IR (VIR)

```ts
type TypeRef =
  | { k: 'named';   name: string }
  | { k: 'list';    of: TypeRef }
  | { k: 'nonNull'; of: TypeRef };

interface Span { file: string; line: number; column: number }

interface Arg  { name: string; type: TypeRef; defaultValue?: Literal; span: Span }
interface Field {
  name: string; type: TypeRef; args: Arg[];
  deprecated: boolean; reason?: string; span: Span;
}

type TypeDef =
  | { k: 'object';    name: string; fields: Field[]; interfaces: string[]; span: Span }
  | { k: 'interface'; name: string; fields: Field[]; impls: string[];      span: Span }
  | { k: 'union';     name: string; members: string[];                     span: Span }
  | { k: 'enum';      name: string; values: EnumValue[];                   span: Span }
  | { k: 'input';     name: string; fields: Field[];                       span: Span }
  | { k: 'scalar';    name: string;                                        span: Span };

interface VIR {
  v: 1;
  schemaName: string;
  roots: { query?: string; mutation?: string; subscription?: string };
  types: TypeDef[];                                        // sorted by name
  reach: Record<string, { output: boolean; input: boolean }>;
  hash: string;                                            // sha256, spans stripped
}
```

**Invariants.** `types` is sorted. Every `named` reference resolves. `hash` is stable under comment and description changes. Two VIRs with the same `hash` are identical for classification purposes.

### 9.6 Artifacts and wire formats

**`.vouchrc.json`**

```json
{
  "$schema": "https://vouch.dev/schema/vouchrc.json",
  "schema": ["schema/**/*.graphql"],
  "base": "origin/main",
  "mode": "strict",
  "failOn": "breaking",
  "severity": {
    "enumValueAddedOutput": "breaking",
    "unionMemberAddedOutput": "breaking"
  },
  "ignore": ["Internal*"],
  "acknowledge": ["sha256:9f2c…"],
  "registry": { "url": "https://api.vouch.dev", "project": "order-api" }
}
```

**Change kinds** (the closed union diffed in S5):

`typeAdded · typeRemoved · typeKindChanged · fieldAdded · fieldRemoved · fieldTypeChanged · fieldDeprecationChanged · argAdded · argRemoved · argTypeChanged · argDefaultChanged · inputFieldAdded · inputFieldRemoved · inputFieldTypeChanged · inputFieldDefaultChanged · enumValueAdded · enumValueRemoved · unionMemberAdded · unionMemberRemoved · interfaceImplAdded · interfaceImplRemoved · rootTypeChanged`

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | No breaking changes |
| 1 | Breaking changes, unacknowledged |
| 2 | Configuration or usage error |
| 3 | Schema could not be parsed or is invalid |
| 4 | Internal error, or budget exhausted with unknowns (fail closed) |

**Report JSON** (`vouch/report@1`): run id, unit name, from/to hashes and refs, run verdict, counts by verdict, `changes[]` with derivations and certificates, `blastRadius[]`, `warnings[]`.

**Certificate JSON** (`vouch/cert@1`): as traced in §9.3. It is self-contained — the three checks plus the query and value — so a third party can verify it without the tool.

### 9.7 Execution model

**Determinism.** No `Date.now()`, no `Math.random()`, no `Object.keys` iteration order. Every collection is sorted before it is walked or rendered. Two runs on the same inputs produce byte-identical output, which is what makes the golden tests meaningful and diffable.

**Caching.** Two layers: VIR blobs keyed by content hash, and a subtype memo keyed by `(hashA, hashB)` with a bounded LRU. A repeated schema pair is O(cache lookup).

**Concurrency.** Units run in parallel; within a unit, witness construction runs in a worker pool (`--jobs`, default `min(8, cpus)`). Results are collected and sorted by fingerprint, so concurrency never affects output order.

**Budgets.** Default 60 s for the CLI, 300 s for the hosted app. Caps: path depth 12, witness nodes 500, changes 5,000. On exhaustion, unfinished work is marked `unknown`, the run exits 4, and nothing unverified is ever reported as compatible.

**Failure policy.** Fail closed everywhere: unknown structure → `unknown`; failed certification → `unverified` (breaking); missing registry → skip correlation; parse error → exit 3.

### 9.8 Deployment topology

| Surface | Runs where | State | Notes |
|---|---|---|---|
| `vouch` CLI | user machine / CI | none | npm; no network in `diff`/`check` |
| GitHub Action | user's CI runner | none | composite action; schema never leaves the runner |
| GitHub App | hosted (Fly/Cloud Run) | Postgres | Phase 5 |
| Registry API | same host as the App | Postgres | versioned VIR + clients |
| Dashboard | static (Astro) | read-only API | no server-side session |

The Action-first order matters: it means the core product has **zero hosting cost and zero data exposure**, which is both a solo-friendly operational choice and a selling point.

### 9.9 Security and privacy

Schema files are among the most sensitive documents a company has — they describe the entire data model. Treat them that way.

- **No third-party calls in the product path.** No LLM, no analytics, no phone-home. Every verdict is reproducible offline.
- **The Action runs entirely in the user's CI.** The schema never leaves their runner. Say this on the landing page.
- **The registry is opt-in.** When enabled: encryption at rest, per-project tokens, audit log, and a documented retention policy.
- **Certificates embed schema fragments.** Treat them as confidential; the dashboard never renders a certificate to an unauthenticated user.
- **On-prem runner** for enterprise, reusing the same container.

---

## 10. The witness engine

The algorithmic core, and the thing that makes the product different.

### 10.1 Construction

Witness generation is a *type-directed search for a distinguishing access*. Given `(S, S', change)`:

1. **Locate the position.** The change happens at a field path with a type; determine whether any client can reach it (reachability from the root operation types).
2. **Build the access.** Construct the chain of field selections from an operation root to the changed field, using the *old* schema (the client is compiled against the old schema).
3. **Build the value.** At the changed leaf, construct a value in `Val(S', T') \ Val(S, T)`:
   - Nullability break → the value is `null`.
   - Enum break → the new enum value.
   - Union break → an object of the new member.
   - Structural break → recursively, the smallest discriminating value.
4. **Check.** The certifier re-derives that the access is well-typed under `S` and that the value is admissible under `S'` but not under `S`.

### 10.2 Minimization

Shrink the witness along three axes, in order:

- **Access length** — find the shortest path to the break.
- **Value size** — remove irrelevant fields.
- **Client code size** — render only the accesses needed to exhibit the failure.

Shrinking is greedy and re-checked after every step, so a minimized witness is still certified. This mirrors the shrinking problem in the Witness project: deletion must preserve the property, which is why it's a search rather than a script.

### 10.3 Certification

The certifier is deliberately a *separate code path* from the classifier. It takes a witness and re-runs the typing derivation from scratch against both schemas, using an independent entry point. It must not share the diff logic, or a bug in the diff becomes a bug in the certificate.

### 10.4 Rendering

One witness, several surfaces:
- GraphQL query text (human-readable).
- Typed client snippet (TypeScript and Swift by default).
- A curl/prose explanation for non-engineers.

---

## 11. Blast radius and the client registry

### 11.1 Why it matters

"This is breaking" is a block. "This is breaking for 12% of iOS installs, and becomes safe in April" is a decision. The registry is what turns the verdict into a plan.

### 11.2 How it works

1. Store every schema version.
2. Store registered client versions with the operations and fields they consume.
3. On a break, intersect the changed path with each client's consumed fields.
4. Rank by estimated traffic share (from telemetry, if available).

### 11.3 Data sources, in order of accessibility

- **Manual registration** (v1): a `clients.json` listing versions and consumed operations. Crude, works, and is what most teams can do on day one.
- **Generated client metadata** (v1.5): Vouch's own type generator tags the schema version it was built from.
- **Telemetry** (v2): an SDK header or a query-hash feed from the gateway.
- **Existing observability** (v2): read operation names from Sentry/Datadog/APM.

### 11.4 Clear dates

For each blocking client, estimate when it will age out, from its observed request share over time. Fit a simple decay curve; report a date with a confidence band. This is deliberately simple — a heuristic is fine, an honest label is mandatory.

---

## 12. Stages and milestones

Solo, full-time. Each phase has an exit criterion that is a *demonstration*, not a checklist item.

### Phase 0 — Foundation (weeks 1–2)

**Build:** repo, VIR, GraphQL SDL parser → VIR, naive structural diff, CLI skeleton.
**Exit:** `vouch diff a.graphql b.graphql` lists changes with source spans, on two real-world schemas.

### Phase 1 — The relation (weeks 3–5)

**Build:** position-aware variance, nullability, fields, args, enums, unions, interfaces, defaults, coinductive cycle handling.
**Exit:** a hand-curated suite of ~120 changes with expected verdicts; all pass. Includes the recursive-type trap cases.

### Phase 2 — Witnesses (weeks 6–8)

**Build:** witness construction, shrinking, certification, rendering.
**Exit:** every `breaking` verdict on the suite has a certified witness ≤ 6 lines. Independent certification path implemented.

### Phase 3 — The product shell (weeks 9–11)

**Build:** GitHub App, PR comments, config file (`.vouchrc`), severity levels, acknowledgement flow.
**Exit:** installed on one real repository; comments correctly on PRs for two weeks.

### Phase 4 — Validation on reality (weeks 12–14)

**Build:** benchmark harness; replay of real schema histories; a public benchmark of labelled changes.
**Exit:** precision and recall numbers on ≥ 5 real repositories with git histories. This is the go/no-go gate.

### Phase 5 — Blast radius (weeks 15–18)

**Build:** registry, client registration, intersection, clear-date estimation, dashboard v1.
**Exit:** a demo where a breaking change shows affected clients and a projected safe date.

### Phase 6 — Second frontend + launch (weeks 19–24)

**Build:** OpenAPI frontend on the same IR; soundness writeup; public launch; docs.
**Exit:** one OpenAPI repo checked correctly; published post; app available.

### Go/no-go gates

- **After Phase 2:** is the witness actually illuminating? If not, the product thesis is weak.
- **After Phase 4:** does it work on real schemas? If precision < 95% or recall < 70%, stop and reassess.

---

## 13. Technology decisions

### 13.1 The principle

Three criteria, in order:

1. **Integration velocity.** A solo builder wins or loses on how fast they can connect to the ecosystem their users already live in.
2. **One language.** Every additional language doubles the build, CI, version drift, and debugging surface. It is the largest hidden tax on a one-person project.
3. **Reversibility.** Prefer choices that are cheap to undo. Spend the irreversibility budget on the domain model, not on tooling.

Each decision below records the choice, the reasoning, the cost paid, the alternative rejected, and how hard it would be to change later.

### 13.2 Decision summary

| # | Decision | Choice | Alternative rejected | Reversibility |
|---|---|---|---|---|
| D1 | Language / runtime | TypeScript on Node ≥ 22 | Rust, Haskell, OCaml | High (pure core) |
| D2 | Repo layout | pnpm workspace monorepo | polyrepo | High |
| D3 | GraphQL parsing | `graphql-js` | hand-rolled, `graphql-tools` only | Low (it is the spec) |
| D4 | OpenAPI parsing | `@redocly/openapi-core` | `swagger-parser` | High (behind an adapter) |
| D5 | CLI framework | `commander` | yargs, oclif | High |
| D6 | Distribution | GitHub Action first, App later | App first | High |
| D7 | Storage | Postgres (Neon / Supabase) | SQLite, DynamoDB | Medium (SQL) |
| D8 | ORM / migrations | Drizzle | Prisma, Kysely | Medium |
| D9 | Boundary validation | Zod | io-ts, valibot | High |
| D10 | Dashboard | Astro | Next.js, SvelteKit | High |
| D11 | Hosting | Fly.io or Cloud Run | Vercel-only, Kubernetes | High |
| D12 | Tests | Vitest + fast-check | Jest, node:test | High |
| D13 | Release | Changesets | manual, semantic-release | High |
| D14 | Errors / traces | Sentry + OpenTelemetry | Datadog, none | High |

### 13.3 D1 — TypeScript on Node ≥ 22

**Why.**

- **The ecosystem is JavaScript.** `graphql-js` is the reference implementation of the GraphQL specification. `@redocly/openapi-core` is the most complete OpenAPI 3.1 parser. Probot is the standard GitHub App framework. `npm`/`npx` is the distribution channel for developer CLIs — a tool a developer can try with one command gets tried.
- **One language for everything.** Core, CLI, HTTP service, GitHub integration, dashboard, benchmark harness. No FFI, no extraction, no second build system. That is criterion 2 satisfied completely.
- **The users are JS/TS developers.** Their schemas, their tooling, their CI. Meeting them where they are is worth more than any language's elegance.
- **Performance is not a constraint.** Schemas are kilobytes. The 5-second target is dominated by process startup and parsing, not by the relation. A 10× faster classifier would not change the user experience at all.

**Cost paid.**

- TypeScript is structurally typed and unsound in places (index signatures, `any`, function parameter bivariance). Mitigation: `strict`, no `any` in `core` (lint-enforced), discriminated unions everywhere, Zod at every boundary, and property tests on the relation.
- Node's startup is ~50 ms. Acceptable for a CLI; irrelevant for a hosted service.
- No real proof assistant in the implementation. That is a deliberate trade — see the ADR note at the end of §13.

**Rejected.** Rust (3–4× the code, no GraphQL/OpenAPI/GitHub ecosystem, FFI-free only if you rewrite everything); Haskell (best for the core, worst for the shell — npm, dashboard, and GitHub integration still need JS); OCaml (same, though with Rocq extraction it becomes the right answer for a *verified* product); Lean/Rocq (right for the proof, wrong for the product).

**Reversibility: high.** `classify`, `relation`, and `witnesser` are pure functions over plain data. Porting them to Rust later is a bounded rewrite behind an unchanged interface.

### 13.4 D2 — pnpm workspace monorepo

**Why.** Four packages ship on different cadences but share types: `core`, `cli`, `app`, `web`. A workspace gives one install, one lockfile, one test command, atomic cross-package changes, and a single CI matrix. pnpm specifically because it is fast, disk-efficient, and strict about phantom dependencies — which matters when `core` must not accidentally import `@vouch/app`.

**Rejected.** Polyrepo (version skew for a solo dev is pure cost); npm workspaces (slower, looser); Yarn PnP (tooling friction with Next/Astro and some test runners).

### 13.5 D3 — `graphql-js` for GraphQL

**Why.** It is the reference implementation: using it means spec conformance is *inherited*, not approximated. It gives you `parse`, `buildASTSchema`, `validateSchema`, and `validate` — merged extensions, resolved root types, checked interfaces, and a full set of validation rules. That is weeks of subtle work you do not write.

**The anti-pattern it prevents.** Do not walk the raw AST. The AST is syntax; `buildASTSchema` produces the semantic object. Walk the schema, lower it to VIR, and delete the AST from memory.

**Cost.** It is a large dependency (~1 MB) and its `GraphQLSchema` types are awkward to pattern-match on. Mitigation: one `lower` module that absorbs the awkwardness; nothing downstream sees `graphql-js` types.

**Reversibility: low — and that is fine.** It is the specification, not a preference.

### 13.6 D4 — `@redocly/openapi-core` for OpenAPI 3.1

**Why.** It resolves `$ref`s, bundles multi-file documents, and supports 3.1's JSON-Schema-based types properly. It is actively maintained and is the engine behind a widely used linter, so it is exercised on real documents.

**Rejected.** `swagger-parser` (less active, thinner 3.1 support). Hand-rolled (JSON Schema resolution is a rabbit hole).

**Reversibility: high** — the OpenAPI frontend sits behind the same VIR adapter as GraphQL.

### 13.7 D5 — `commander`, `picocolors`, hand-written renderers

**Why.** `commander` is ~3 KB, stable, has good subcommand and `--help` behavior, and imposes no framework. `picocolors` is tiny and avoids the ESM/CJS friction that `chalk` introduced.

The output is prose, code blocks, and short tables — not a data grid. Hand-written renderers give exact control over what a developer sees in a 40-column terminal and what a reviewer sees in a PR, which is the actual product surface. A table library would fight that.

**Rejected.** `yargs` (more magic, harder to make output deterministic); `oclif` (a framework you adopt and then work around); `clipanion` (fine, smaller community).

### 13.8 D6 — The Action first, the App second

**This is a change from the original plan, and it is the most consequential operational decision.**

A **GitHub Action** runs in the user's CI: it uses their checkout, needs no hosting, no OAuth, no database, no secrets, and no uptime commitment. It is strictly the right v1 distribution for a solo builder — and it lets you say, truthfully, that private schemas never leave the customer's runner.

A **GitHub App** is required only for: org-wide installation, private-schema registry integration, check runs with inline annotations, and comments posted by a bot identity rather than the workflow token. Those are Phase 5 concerns.

So: `vouch` CLI + composite Action in Phase 3; hosted App + registry in Phase 5.

### 13.9 D7 — Postgres

**Why.** The domain is relational: projects → schemas → versions → runs → changes → certificates → clients → consumed paths → shares. That is joins and recursive queries (the version graph is a DAG), which is what Postgres is for. JSONB stores VIR blobs without a second store. Managed Postgres is cheap, boring, backed up, and point-in-time recoverable.

**Rejected.** SQLite (perfect for the CLI's local cache; wrong for a multi-tenant service); DynamoDB (no joins, and the core query *is* a join); S3-only (no queries).

**Reversibility: medium.** The schema is small and SQL is portable; the storage layer sits behind a repository interface.

### 13.10 D8 — Drizzle

**Why.** SQL-shaped, fully typed, no runtime query engine, migrations are plain SQL files you can read. It does not hide the database, which matters when the interesting queries are recursive CTEs over the schema version graph.

**Rejected.** Prisma (excellent DX, but a runtime engine, a schema DSL, and less control over SQL); Kysely (also good — chose Drizzle for the migration story).

### 13.11 D9 — Zod at every boundary

**Why.** Parse, don't validate. One schema definition yields both the TypeScript type and the runtime check for `.vouchrc.json`, registry request bodies, and certificate files. This is what keeps the promise that `core` only ever sees well-formed data.

### 13.12 D10 — Astro for the dashboard

**Why.** The dashboard is read-only, content-heavy, and mostly tables, timelines, and one or two charts. Astro ships zero JavaScript by default, renders to static files, and is trivially hostable. Interactivity is islands, so the deprecation timeline can be a React component while everything else stays static.

**Rejected.** Next.js (more batteries, more weight, and a server this product does not need); SvelteKit (fine, smaller ecosystem for the charting libraries); plain Vite + React (more plumbing for no benefit).

### 13.13 D11 — Fly.io or Cloud Run

**Why.** Scale-to-zero, one container, simple deploys, no cluster, no Kubernetes. The hosted surface is a webhook handler and a small REST API — traffic is bursty and tiny. Pay-for-request is exactly right.

**Rejected.** Kubernetes (operational surface with no payoff at this size); Vercel-only (great for the static dashboard, awkward for a long-running webhook worker).

### 13.14 D12 — Vitest + fast-check

**Why.** Vitest is fast, ESM-native, and needs almost no configuration in a TS monorepo.

`fast-check` is **not optional**. The relation's properties — reflexivity, transitivity, monotonicity, and the self-audit that a "compatible" verdict admits no witness — are the cheapest way to find unsoundness. You cannot enumerate the schema space by hand; you generate it.

### 13.15 D13 — Changesets

**Why.** Monorepo-aware versioning, generated changelogs, independent versions per package, and a clean npm publish with provenance from CI.

### 13.16 D14 — Sentry and OpenTelemetry

**Why.** Sentry catches the exceptions you did not anticipate; OpenTelemetry traces the webhook → run → comment path so you can see where 30 seconds went. Both are opt-in and redacted: no schema contents in either.

### 13.17 What we deliberately do not use

- **No LLM in the product path.** Non-determinism, latency, cost, and — decisively — private schemas. Every verdict must be reproducible offline. This is also a differentiator in a market where every competitor is bolting on "AI."
- **No WASM.** The CLI is a Node program. WASM would add a build target for no benefit at this input size.
- **No Kubernetes, no microservices, no message queue.** One service, one database, one deploy.
- **No GraphQL server for our own API.** The registry is REST: smaller, easier to document, easier to cache, and the users are already comfortable with it.
- **No VS Code extension in v1.** High polish cost, low marginal value while the CLI output is the product.

### 13.18 Research tooling

- **Lean 4 or Rocq** for the mechanized relation and soundness theorem (Phase 6, after the relation is stable). Rocq if the theorem becomes part of the product's trust story, because extraction to OCaml gives a verified artifact you can ship.
- **Z3** for cross-checking the relation on small schemas: encode two schemas as sorts and ask whether a discriminating value exists, then compare with the witness engine. A disagreement is a bug in one of them.
- **fast-check** for the properties above.
- **A hand-built corpus** of ~120 schema pairs with expected verdicts — the most valuable single artifact in the repo.

### 13.19 ADR note — why not Lean/Rocq for the implementation

Recorded here so it is not relitigated every six months.

Formal verification proves *the implementation refines the specification*. For Vouch the specification is the uncertain part: what GraphQL's nullability means in practice, whether enum exhaustiveness should be strict, what "compatible" means for a client you cannot see. A verified implementation of a possibly-wrong model, behind an unverified parser, is not the guarantee a buyer needs.

The guarantee a buyer needs is **a witness they can read**. A four-line client that compiles against v1 and crashes against v2 needs no theorem behind it — it is self-evident. Trust lives at the certificate, and the certificate is deliberately small enough to check independently.

That is why the plan puts Lean/Rocq at the trust boundary (the certifier, and later the mechanized relation) rather than at the top of the stack. It is the CompCert trade: verify the small thing that everything depends on, ship the rest.

### 13.20 Development environment

- Editor: Neovim — `ts_ls` for TypeScript; `conform.nvim` runs `biome-check` on save and `nvim-lint` runs `biomejs`, so the editor and CI share one tool. GraphQL LSP when the frontend lands.
- Runtime: Node 26 (LTS) in development; Node ≥ 22.13 supported and enforced by `engines`; pnpm 12.
- Quality gate: `tsc` (TypeScript 7 — build and typecheck), Biome (lint, format, import order; the `core`-purity rule banning `fs`/`net`/`http` lives in `biome.json`), Vitest.
- Dependencies are installed when the feature that needs them lands: `graphql` (F0.5), `fast-check` (F1.8), `zod` (config), `picocolors` (F0.9), Changesets (first release), coverage (when a threshold exists).
- CI: GitHub Actions, running on Node 22 and Node 24, plus a dogfood job that runs `vouch check` on Vouch's own API schema.
- Local dev: `pnpm dev` runs the app against a dockerised Postgres; `pnpm test` needs no services at all.

### 13.21 Skills to acquire

| Skill | Time | When |
|---|---|---|
| GraphQL SDL semantics and validation rules | 1 week | before Phase 1 |
| Coinductive subtyping implementation | 3–5 days | Phase 1 |
| `graphql-js` schema API | 2 days | Phase 0 |
| GitHub Actions composite actions | 2 days | Phase 3 |
| Postgres + Drizzle | 3 days | Phase 5 |
| OpenAPI 3.1 structure | 1 week | Phase 6 |
| GitHub App / Probot | 3 days | Phase 5 |
| Lean 4 or Rocq (for the theorem) | 2–3 weeks | Phase 6 |

---

## 14. Testing and validation strategy

This is where a checker earns trust, and where most tools under-invest.

### 14.1 Layers

1. **Unit tests** for the IR and diff.
2. **Golden verdict suite** — ~120 hand-curated changes with expected verdicts and rationale. Every bug becomes a new case.
3. **Property tests** — reflexivity (`S ≤ S`), transitivity, and monotonicity (adding a field to an output never breaks a previously-safe change).
4. **Differential/Witness fuzzing** — the soundness self-audit: for every `compatible` verdict, run the witness search anyway. Any found witness is a soundness bug. Run nightly over the benchmark.
5. **Replay tests** — real schema histories from open-source APIs, diffed commit by commit, checked against changelogs and known incidents.
6. **Independent certification** — a separate code path re-checks every emitted witness.
7. **Mechanized soundness** — the relation and its soundness theorem in Lean/Rocq, for the record and for the paper.

### 14.2 Labelling the benchmark

The hardest part. Approach:

- Mine changelogs and release notes for "breaking" markers.
- Use issue trackers and incident reports where available.
- Manual labelling of a stratified sample (100–200 changes) with two passes for agreement.
- Publish the benchmark, methodology, and disagreements.

An honest, small, well-labelled benchmark beats a large, noisy one.

---

## 15. Metrics

### 15.1 Product health

- Time to verdict; schema size supported.
- % of PRs with a verdict; % acknowledged vs. reworked.
- Installations, weekly active repos.

### 15.2 Correctness

- Precision / recall on the benchmark.
- Witness validity rate (must be 100%).
- Soundness-audit hit rate (must be 0; any hit is a P0 bug).

### 15.3 Adoption

- Repos with the app; PRs checked; public mentions.

---

## 16. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| False positives destroy trust | High | Severe | Design for precision over recall; "conditional" verdicts instead of hard breaks; easy suppression with audit trail |
| Unsound relation produces false negatives | Medium | Severe | Self-audit fuzzer nightly; mechanized proof; conservative defaults |
| GraphQL spec ambiguity (e.g., enum exhaustiveness) | High | Medium | Explicit modes; document the assumption; default to strict |
| Incumbents (Buf, Hive) add witnesses | Medium | High | Move fast on the witness + blast radius; own the mobile-client niche |
| "Nobody cares" — adoption failure | High | Severe | Beachhead on teams with mobile clients; public compatibility reports as marketing; free for OSS |
| Registry data is hard to get | High | Medium | Manual `clients.json` works from day one; telemetry is a later upsell |
| Scope creep to every schema language | High | High | Hard rule: GraphQL until Phase 6; OpenAPI only after the benchmark gate |
| Solo burnout | Medium | Severe | Ship a demo every two weeks; keep the scope small; publish progress |
| Semantic changes not covered (defaults, behavior) | Certain | Medium | Explicitly out of scope; report as "behavioral, not checked" |

---

## 17. Deliverables

Twelve deliverables. Each is described by what it is, how it is invoked, who uses it, how they use it in practice, and what "done" means. A deliverable without an acceptance criterion is a wish.

### 17.1 Delivery map

| ID | Deliverable | Phase | Primary user | Distribution |
|---|---|---|---|---|
| D1 | `vouch` CLI | 0 → 3 | Priya (platform) | npm |
| D2 | `@vouch/core` library | 0 → 2 | Vouch itself, third parties | npm, MIT |
| D3 | GitHub Action | 3 | Priya, Dana | GitHub Marketplace |
| D4 | GitHub App | 5 | Priya (org-wide) | hosted |
| D5 | Registry service | 5 | Priya, Sam | hosted |
| D6 | Dashboard | 5 | Priya, Marcus | static web |
| D7 | Certificate format + verifier | 2 | auditors, Sam, third parties | spec + CLI |
| D8 | Type generator | 5 | Marcus, Dana | npm |
| D9 | Benchmark | 4 | researcher-you, competitors | public repo |
| D10 | Documentation | 1 → 6 | everyone | docs site |
| D11 | Soundness artifact | 6 | credibility, paper | repo + writeup |
| D12 | Demo + public report | 6 | marketing, onboarding | web |

### 17.2 D1 — The `vouch` CLI

**What it is.** The product's primary interface. A Node CLI published to npm, installable with `npx vouch` and no account.

**Surface.**

| Command | Purpose | Typical use |
|---|---|---|
| `vouch diff <base> <head>` | Compare two files or git refs | local exploration |
| `vouch check` | CI mode; reads `.vouchrc.json` | Action, CI step |
| `vouch explain <fingerprint>` | Full derivation and witness for one change | debugging a verdict |
| `vouch verify <cert.json>` | Independently validate a certificate | third-party audit |
| `vouch init` | Write a starter config | onboarding |
| `vouch baseline` | Record the current schema as the comparison point | first adoption |
| `vouch publish` | Push a schema version to the registry | Phase 5 |
| `vouch render --html` | Standalone HTML report | sharing with non-engineers |

**Flags.** `--format text|json|markdown|sarif|html` · `--fail-on breaking|conditional|never` · `--strict` / `--permissive` · `--jobs N` · `--timeout MS` · `--config PATH` · `--acknowledge <fp>` · `--quiet` · `--no-color`.

**How it is used.**

1. **Local check before pushing.** `npx vouch diff origin/main HEAD` → a list of changes with verdicts and, for breaks, the witness. Three seconds, no CI round trip.
2. **CI gate.** `npx vouch check` in the workflow. Exit code decides pass/fail. This is the highest-volume use.
3. **Debugging a verdict.** A reviewer disagrees with a `breaking` label → `npx vouch explain sha256:9f2c…` prints the derivation and the witness. The argument ends in one command.
4. **Auditing a certificate.** A partner receives a `vouch.report.json`, runs `npx vouch verify` on the embedded certificates, and confirms the verdicts without trusting the author.

**Acceptance criteria.**

- Two real-world schemas (≥ 200 types) diffed cold in under 2 s.
- `--format json` output is byte-identical across runs and across machines.
- Every exit code in §9.6 is covered by an integration test.
- `diff` and `check` make zero network calls (verified by a test that stubs `net`).
- `--help` output fits in 40 columns.

### 17.3 D2 — `@vouch/core`

**What it is.** The pure library. Everything the CLI, the Action, the App, and the benchmark share.

**Surface.**

```ts
parseGraphQL(files: SourceFile[]): ParsedUnit
lower(parsed: ParsedUnit): VIR
diff(a: VIR, b: VIR): Change[]
classify(changes: Change[], a: VIR, b: VIR): Classified[]
witness(changes: Classified[], a: VIR, b: VIR, opts): Witness[]
shrink(w: Witness, a: VIR, b: VIR): Witness
certify(w: Witness, c: Change, a: VIR, b: VIR): Certificate
```

**How it is used.** Directly by the CLI and App; by third parties who want to embed the relation in their own tooling; by the benchmark harness; and by the future Lean/Rocq cross-check, which compares against `classify` output.

**Acceptance criteria.**

- No `fs`, `net`, `http`, `Date`, or `Math.random` imports anywhere in `core` — enforced by a lint rule, not a convention.
- Every exported function is pure and total over valid input.
- 100% branch coverage on `classify` and `certify`.
- One page of API docs per function, with a runnable example.

### 17.4 D3 — The GitHub Action

**What it is.** A composite Action that runs the CLI in the user's CI and reports the result. **This is the v1 distribution** (see §13.8): no hosting, no OAuth, no data leaving the runner.

**Surface.**

```yaml
# .github/workflows/vouch.yml
- uses: vouch-dev/check@v1
  with:
    base: ${{ github.event.pull_request.base.sha }}
    head: ${{ github.sha }}
    fail-on: breaking      # breaking | conditional | never
    comment: "true"
```

Outputs: `verdict` (`compatible` | `breaking` | `conditional`), `breaking-count`, `report-path`.

**How it is used.** Add one step to the workflow. On a PR it posts a comment with the verdict, the witness, and the blast radius if a registry is configured. On `main` it records a baseline.

**Acceptance criteria.**

- Works on a public repo with the default `GITHUB_TOKEN` and no secrets.
- Comment is posted within 30 s of the PR event for a 200-type schema.
- No schema content is sent anywhere (asserted by a network-blocking test).
- Idempotent: re-running updates the same comment rather than posting a new one.

### 17.5 D4 — The GitHub App (Phase 5)

**What it is.** The org-wide installation for teams that want checks on every repo without editing workflows, plus inline annotations and bot-authored comments.

**Surface.** Permissions: `contents: read`, `pull_requests: write`, `checks: write`. Events: `pull_request` (opened, synchronize, reopened), `push` (default branch), `release`.

**How it is used.** Install once at the org level; select repos. From then on every PR gets a check run with annotations on the exact schema lines, and a comment summarizing the verdict. Teams with the registry get blast radius and clear dates in the same comment.

**Acceptance criteria.**

- Check run appears with per-change annotations linked to file/line.
- Comment edits rather than duplicates on force-push.
- Webhook handling is idempotent by delivery id.
- 99% of runs complete within 60 s.

### 17.6 D5 — The registry service

**What it is.** The server that makes blast radius and clear dates possible: versioned schemas, registered clients, and the mapping between them.

**Surface (REST, versioned).**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/projects/:id/schemas` | store a VIR blob by hash |
| `GET` | `/v1/projects/:id/schemas/:hash` | fetch a version |
| `GET` | `/v1/projects/:id/history` | version DAG |
| `POST` | `/v1/projects/:id/clients` | register a client + consumed paths |
| `GET` | `/v1/projects/:id/compat?from=&to=` | cached compatibility record |
| `GET` | `/v1/projects/:id/runs/:runId` | a stored run + certificates |

**How it is used.** `vouch publish` (or the App on merge to `main`) pushes the new schema version. Mobile teams register a client version with the operations it consumes. On the next breaking change, the run correlates the change with registered clients and reports the blast radius.

**Acceptance criteria.**

- Schema versions are content-addressed and immutable.
- Compatibility records are cached by `(fromHash, toHash)` — a repeated query is a single row read.
- Auth: per-project tokens; no cross-tenant reads (tested).
- Deleting a project deletes its blobs.

### 17.7 D6 — The dashboard

**What it is.** A read-only web app over the registry, for people who are not in the PR.

**Views.**

1. **Timeline** — every schema version, with the verdict of each transition.
2. **Change detail** — the verdict, derivation, witness (rendered as a query and a client snippet), and certificate.
3. **Deprecations** — every deprecated field, what blocks removal, and the projected clear date.
4. **Clients** — registered client versions, last seen, consumed operations, and how far behind the schema they are.
5. **Blast radius** — for a pending change, which clients and what share.

**How it is used.** Priya opens it before planning a release ("what can I remove this quarter?"). Marcus checks whether his shipped app versions are behind. Sam, a partner, checks whether the next release is safe to adopt.

**Acceptance criteria.**

- Static build, no server-side session, loads in under 1 s on a cold cache.
- Every verdict shown links to its certificate.
- Works with JavaScript disabled for the tables.

### 17.8 D7 — Certificate format and verifier

**What it is.** The trust artifact. A self-contained JSON document that proves a verdict, checkable by a third party without trusting Vouch.

**Surface.** `vouch/cert@1` (shape in §9.3). Verified with `vouch verify cert.json`, which exits 0 on accept and 1 on reject with the failing check named.

**How it is used.** Embedded in the report JSON; attached to a release; handed to a partner; stored in the registry; later, checked by a second implementation in Lean/Rocq for the soundness claim. The verifier must be small enough to reimplement — target: under 1,500 lines.

**Acceptance criteria.**

- Verifier rejects a certificate with any of the three checks flipped.
- Verifier rejects a certificate whose `from`/`to` hashes do not match the values it contains.
- The format is documented well enough that an independent implementation passes the test vectors.
- 50 published test vectors (10 valid, 40 tampered in specific ways).

### 17.9 D8 — The type generator

**What it is.** Generates TypeScript, Swift, and Kotlin types from a VIR, embedding the schema hash in the output.

**Why it matters.** The hash is what makes client audit possible: a generated client knows which schema version it was built against, so the registry can say "this app build is 3 breaking changes behind" without any telemetry.

**How it is used.** Mobile teams replace their codegen step. The generator emits a header comment and a constant: `export const VOUCH_SCHEMA = "sha256:aa…"`.

**Acceptance criteria.**

- Output compiles (tsc for TS; swiftc and kotlinc in CI).
- The emitted hash matches the VIR hash exactly.
- Semantics preserved for nullability, enums, unions, and input objects.

### 17.10 D9 — The benchmark

**What it is.** A public dataset of schema pairs with labelled verdicts, a harness, and a leaderboard.

**Format.** JSONL, one record per change:

```json
{"repo":"acme/api","from":"a1b2","to":"c3d4","path":["Order","customerEmail"],
 "kind":"fieldTypeChanged","label":"breaking","note":"clients decode non-optional",
 "source":"release-notes#v2.0.0"}
```

**How it is used.** Run your checker against it and publish precision/recall. Vouch runs it nightly in self-audit mode. Competitors can use it; that is fine — owning the benchmark is worth more than owning the only score.

**Acceptance criteria.**

- ≥ 200 labelled changes across ≥ 5 real repositories.
- Inter-annotator agreement reported (target κ ≥ 0.8 on a 50-item subsample).
- Every record has a `source` citation.
- The harness runs in under 10 minutes on one machine.
- Conflicts and disagreements are published, not hidden.

### 17.11 D10 — Documentation

**What it is.** The written product, and for a developer tool it is half the product.

**Contents.**

- `README.md` — the 30-second demo, install, one screenshot.
- **Compatibility rules reference** — §8.3 expanded to one page per construct, with a runnable schema pair for each.
- **"Why your linter is wrong about nullability"** — the explainer that markets the tool and teaches the variance rule. This is the most important document in the repo.
- **Migration playbook** — the additive-then-deprecate pattern, with real timelines.
- **Certificate spec** — enough to reimplement.
- **Benchmark methodology** — labelling, agreement, limitations.
- **API docs** for `@vouch/core`.

**Acceptance criteria.** A developer who has never heard of the tool can go from landing to a green check in under 10 minutes, following only the README.

### 17.12 D11 — The soundness artifact

**What it is.** The mechanized relation and its soundness theorem, in Lean 4 or Rocq.

**Statement.** If `classify` returns `compatible` for `S → S'`, then for every client `C` well-typed against `S`, `C` remains well-typed against `S'`.

**How it is used.** Credibility with technical buyers; a paper; and a reference definition that the implementation is tested against. It is **not** on the product's critical path — it is scheduled last, after the relation has stopped moving.

**Acceptance criteria.**

- Compiles with no axioms beyond the standard library.
- Covers the structural fragment (nullability, fields, args, enums, unions, interfaces, defaults).
- The recursion case is handled coinductively and documented as such.
- A short writeup explains what is and is not covered.

### 17.13 D12 — Demo and public report

**What it is.** A live demo plus one public "compatibility report" on a well-known open-source GraphQL API, done carefully and credited.

**How it is used.** The demo is the landing page: paste two schemas, see a verdict and a witness. The public report is the credibility artifact that gets shared — it shows the tool working on a real schema nobody can accuse you of inventing.

**Acceptance criteria.**

- Demo runs client-side or in under 2 s server-side.
- Report follows responsible disclosure if it finds anything unreported.
- The subject project is credited and, where possible, contacted first.

### 17.14 Definition of done

A deliverable is done when, and only when:

1. It has an acceptance criterion in this document, and it passes.
2. It has a test that would fail if the behavior regressed.
3. It is documented for its actual user, not for its author.
4. It has been used by someone other than you, at least once.

### 17.15 Delivery schedule

| Phase | Weeks | Deliverables shipped |
|---|---|---|
| 0 — Foundation | 1–2 | D1 skeleton, D2 skeleton |
| 1 — The relation | 3–5 | D2 complete, D1 `diff`/`check` |
| 2 — Witnesses | 6–8 | D1 `explain`/`verify`, D7 |
| 3 — Product shell | 9–11 | D3, D1 complete, D10 v1 |
| 4 — Validation | 12–14 | D9, D10 benchmark docs |
| 5 — Blast radius | 15–18 | D4, D5, D6, D8 |
| 6 — Scale and launch | 19–24 | D11, D12, D10 complete |

---

## 18. Sustainability

- **Free** for open source and for one private repo.
- **Paid** per organization: registry, blast radius, dashboard, SSO.
- **Enterprise**: on-prem runner, custom schema formats, support.
- **Consulting**: compatibility audits for teams migrating to v2.

The wedge is the free CI check; the money is the registry and the migration planning, because that's where the ongoing pain lives.

---

## 19. Open questions

1. **Is the mobile-client pain concentrated enough?** If most GraphQL APIs have no long-lived clients, the beachhead is weaker than assumed. Validate with 10 interviews before Phase 1.
2. **How much of the value is the witness vs. the blast radius?** If it's the blast radius, the product is a registry with a checker attached, and the priorities shift.
3. **Does the Soundness proof matter to buyers, or only to you?** Likely only to you and to credibility — which is still worth it, but schedule it last.
4. **GraphQL vs. OpenAPI as the beachhead.** GraphQL has richer types (better demo) but a smaller market than REST.
5. **Should the CLI be free forever?** Probably yes; the money is in the hosted registry.

---

## Appendix A — The one rule

> **Outputs are covariant. Inputs are contravariant.**

Everything in §8.3 is this sentence applied to a construct. If you remember nothing else, remember the direction flips — and that nullability is a supertype, so making an output nullable is *widening*, not loosening.

## Appendix B — Glossary

- **Covariant** — the subtype relation points the same way as the value flow (output).
- **Contravariant** — the relation points opposite to the value flow (input).
- **Witness** — a minimal client and value that distinguish two schemas.
- **Blast radius** — the clients affected by a change.
- **Clear date** — the projected date a breaking change becomes safe.
- **VIR** — Vouch IR, the format-neutral schema representation.
- **Coinductive** — a relation checked by assuming the pair under test; needed for recursive schemas.

## Appendix C — Prior art to read before Phase 1

- Cardelli, "Type Systems" (variance, in one chapter).
- Amadio & Cardelli, "Subtyping Recursive Types" (coinduction — and the Amber-rule pitfalls).
- The GraphQL specification, especially "Type System" and "Validation."
- The OpenAPI 3.1 specification's schema object.
- Buf's breaking-change rule documentation (the baseline you're beating).
- Apollo/Hive schema-check docs (the incumbent UX).
- Your own WITNESS.md (the witness-and-shrink machinery is the same problem).
