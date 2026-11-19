# Git workflow

Solo repository, one product. `main` is always green; every roadmap feature lands through its own branch.

## Branches

`<type>/<roadmap-id>-<slug>`, where `<type>` is the commit type and the ID is copied verbatim from [ROADMAP.md](../ROADMAP.md).

| Branch | For |
|---|---|
| `feat/f0.4-ir-vocabulary` | a roadmap feature |
| `fix/f0.6-reachability-cycle` | a defect found while building a feature |
| `chore/f1.3-rule-table-lint` | tooling that supports a feature |
| `docs/workflow` | documentation only |

- Short-lived: one feature, ideally a day or two.
- **One feature per branch.** A second goal that appears mid-feature gets its own branch off `main`, merged first, then the feature branch rebases onto it.
- **`main` is only updated by merges.** No direct commits, so `git log --first-parent main` stays a readable list of features.

## Lifecycle

```sh
git switch main && git pull --ff-only
git switch -c feat/f0.4-ir-vocabulary

# commits, one goal each

pnpm check && pnpm typecheck && pnpm test && pnpm build

git push -u origin feat/f0.4-ir-vocabulary
```

Then a pull request into `main`. CI ([ci.yml](../.github/workflows/ci.yml)) runs on the push and on the PR. Review the diff, merge, and delete the branch:

```sh
git switch main
git merge --no-ff feat/f0.4-ir-vocabulary
git branch -d feat/f0.4-ir-vocabulary
git push --delete origin feat/f0.4-ir-vocabulary
```

Once CI has run green at least once, protect `main` on GitHub: require a pull request and the CI check before merging.

## Commits

Conventional commits. One goal per commit; the body says why, not what.

```
feat(core): add TypeRef, Span and TypeDef (F0.4)

The IR is the only shape later stages see, so nullability is normalised
into TypeRef here rather than carried as a suffix.

Refs: F0.4
```

Scope is one of `core`, `cli`, `ci`, `docs`, `repo`. The `Refs:` trailer survives merges, so `git log --grep 'Refs: F0.4'` lists every commit for a feature.

## Done means

A branch is mergeable when all four hold:

1. `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build` exit 0.
2. The feature's acceptance criterion in [ROADMAP.md](../ROADMAP.md) is demonstrated — a command run and its output, not an argument.
3. No dependency was added that the feature does not use.
4. Documentation the change invalidates is updated in the same branch.

## Merging

`git merge --no-ff` is the default here (`merge.ff = false` in the repository config). It keeps two properties at once:

- a visible merge commit per feature, so `main` carries a feature-level history;
- every one-goal commit intact inside the feature, so `git bisect` and review stay useful.

Do not squash a reviewed branch, and do not rebase one after it has been pushed — the review history is the evidence.

## Milestone gates

When the last feature of a milestone passes its gate, tag it:

```sh
git tag -a m0 -m "M0 skeleton: vouch diff prints changes with spans"
```

## About the first commits

The first three commits were made on `main` before this convention existed. They are the scaffold; rewriting them would cost more than it returns.
