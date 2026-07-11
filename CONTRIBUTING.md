# Contributing

This repository ships one composite GitHub Action ([action.yml](action.yml))
that runs an Outfitter profile headless in CI, plus the documentation,
examples, and scripts around it.

## Layout

```text
action.yml      the composite action — inputs, provider setup, agent launch
docs/           token scoping, bot accounts, GitHub App setup, workflow design
examples/       complete copy-paste workflows, one file per shape
scripts/        helpers workflows can fetch, e.g. validate-triage.sh
.outfitter/     the outfitter-actions skill, published as a profile catalog
```

## Expectations

- **Conventional commits.** Releases are cut by release-please from commit
  messages; `feat:`/`fix:` drive the version bump.
- **Change the action, change its surface.** A new or changed `action.yml`
  input must update the README's inputs section and any affected example.
- **Examples stay complete and runnable.** Each example is a full workflow a
  consumer can copy, with `permissions:` and token guidance in comments.
- **Verify side effects, not exit codes.** Workflow changes should be
  validated end to end on a fork or test repository — a green agent run is
  not proof of work (see `scripts/validate-triage.sh`).
- **Token scope is load-bearing.** Anything widening what the agent's token
  can do must be reflected in [docs/token-permissions.md](docs/token-permissions.md).

## Scope

The action stays a thin launcher: install Outfitter, write settings, run the
profile. Behavior belongs in profiles and skills (catalogs such as
`ai-outfitter/default-profiles`); agent-runtime features belong in
`ai-outfitter/outfitter`. If a change adds branching logic to `action.yml`
for one use case, it probably belongs in a profile instead.
