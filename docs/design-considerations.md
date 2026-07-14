# Design considerations: structuring agent workflows as they multiply

The [examples](../examples/) each show one standalone workflow. That is the
right shape for your first agent, but by the third one every workflow file is
duplicating the same four things:

1. the bot account identity (login, git name/email),
2. the recursion guard (`github.actor != '<bot>'`),
3. the checkout + `permissions: {}` + action-invocation boilerplate, and
4. a long inline `prompt:` block.

Each of those is a seam you can factor along. The options below are ordered
roughly by how far you're scaling; they compose, and most repos should adopt
them in sequence rather than jumping to the last one.

## 1. Per-automation profiles: move prompts out of workflow YAML

The cheapest, highest-leverage change, and composable with everything below.

An inline `prompt:` puts the "what to do" inside CI config — hard to review,
impossible to iterate on without pushing a workflow change. Instead, define a
dedicated Outfitter profile per automation (`pr-reviewer`, `issue-implementer`,
`milestone-scribe`, …) whose `append_system_prompt` carries the full
instructions, and shrink the workflow prompt to just the event coordinates:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    profile: pr-reviewer
    profile-source: .outfitter/profiles
    prompt: "Review pull request #${{ github.event.pull_request.number }} in ${{ github.repository }}."
```

Benefits:

- Prompt changes go through the same review lane as the rest of the profile
  catalog, with a diff that is prose, not YAML escaping.
- Profiles are testable locally: `outfitter run --profile pr-reviewer` against
  a real PR exercises the exact instructions CI will use.
- A remote profile catalog gives you cross-repo prompt reuse for free —
  automation prompts move to the catalog, and each repo's workflow pins the
  catalog with `profile-source-ref`.
- Keeping the interpolated portion of the prompt down to identifiers (issue
  and PR numbers) also shrinks the prompt-injection surface — see
  [token-permissions.md](token-permissions.md).

## 2. One reusable workflow, thin trigger stubs

Factor the mechanics — checkout with the bot token, `permissions: {}`, git
identity, the action invocation, secret wiring — into a single
[`workflow_call`](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
workflow inside the repo:

```yaml
# .github/workflows/agent-run.yml
name: Agent run
on:
  workflow_call:
    inputs:
      profile: { type: string, required: true }
      prompt: { type: string, required: true }
    secrets:
      OUTFITTER_BOT_TOKEN: { required: true }
      ANTHROPIC_API_KEY: { required: true }

jobs:
  run:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.OUTFITTER_BOT_TOKEN }}
          fetch-depth: 0
      - uses: ai-outfitter/actions@v1
        with:
          github-token: ${{ secrets.OUTFITTER_BOT_TOKEN }}
          git-user-name: myorg-outfitter-bot
          git-user-email: outfitter-bot@myorg.com
          profile: ${{ inputs.profile }}
          profile-source: .outfitter/profiles
          prompt: ${{ inputs.prompt }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Each automation becomes a ~15-line stub holding only its trigger, guard, and
concurrency group:

```yaml
# .github/workflows/agent-implementer.yml
name: Implementer
on:
  issues:
    types: [assigned]

jobs:
  implement:
    if: >-
      github.event.assignee.login == 'myorg-outfitter-bot' &&
      github.actor != 'myorg-outfitter-bot'
    concurrency:
      group: implementer-issue-${{ github.event.issue.number }}
    uses: ./.github/workflows/agent-run.yml
    secrets: inherit
    with:
      profile: issue-implementer
      prompt: "You are assigned issue #${{ github.event.issue.number }} in ${{ github.repository }}."
```

Adding an agent means writing a trigger stub, not re-deriving the token model.
The invariants that matter — empty workflow-token permissions, bot identity,
recursion guard convention — are asserted in one place.

Known constraint: reusable workflows cannot own triggers, so event routing
stays in the stubs. That is fine — triggers are the part that legitimately
varies per automation.

## 3. Org-level reusable workflows

When a second repo wants the same agent suite, host the reusable workflow
centrally — in this repo or a dedicated `myorg/workflows` repo — and call it
cross-repo with a pinned ref:

```yaml
uses: myorg/workflows/.github/workflows/agent-run.yml@v1
```

Pair it with:

- **Org-level secrets** (`OUTFITTER_BOT_TOKEN`, `ANTHROPIC_API_KEY`) restricted
  to selected repositories, so onboarding a repo is an allow-list change
  rather than secret duplication. The PAT itself must still be scoped to those
  repositories — see [bot-account.md](bot-account.md).
- **An org variable for the bot login** (`vars.OUTFITTER_BOT`), so guard
  conditions stop hardcoding the account name per file.

A repo then adopts the whole suite by copying a few trigger stubs, and a fix
to the token handling ships everywhere via a version bump. The trade-off is
the usual one for shared workflows: a bad change breaks every consumer at
once, so the shared repo needs the same pin-and-review discipline this
action's README prescribes for profile sources — consumers pin `@v1`-style
tags, and the shared repo treats workflow changes as releases.

## 4. Single dispatcher workflow (generally avoid)

The opposite consolidation: one `agent.yml` listing every trigger, with a
routing step mapping event → profile + prompt. It looks appealing — one file
to read — but in practice:

- every event type tangles into shared `if:` logic,
- concurrency groups become awkward to scope per automation,
- one syntax error takes down all agents at once, and
- GitHub's UI files every run under a single workflow name, so run history
  stops being navigable.

It only starts winning when routing is genuinely dynamic — e.g. a label
`agent:reviewer` selects the profile by name. Even then, a small registry
file driving a job matrix inside per-trigger stubs captures most of the value
without the tangle. Either way there is a hard limit: workflow triggers must
be static YAML, so no config file or registry can add a new trigger without a
workflow edit.

## Recommended sequence

1. **Per-automation profiles from day one** — pure improvement, touches
   nothing structural.
2. **A repo-local reusable workflow at two-to-three agents**, when the
   boilerplate duplication becomes real.
3. **Promote it to org level when a second repo adopts the suite** — that is
   the point where copy-paste divergence starts to cost.
4. **Skip the dispatcher** unless routing-by-label becomes a real requirement.

Throughout, keep a naming convention (`agent-*.yml`) so agent entry points
are discoverable, and keep the security invariants — `permissions: {}`,
recursion guards, comment-only reviews, machine-account PAT — defined in
exactly one place. That single point of definition, more than any file
layout, is what keeps a growing fleet of agentic workflows maintainable.
