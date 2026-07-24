# Pull request implementation on demand

GitHub Copilot's coding agent turns "assign the issue to Copilot" into a draft
PR. This page documents how to build the same loop with this action — an agent
that implements pull requests — without waiting on the one identity that can
actually be assigned issues (a [machine account](bot-account.md)) or standing
up a webhook server.

The canonical entry point is
[`examples/pull-request-implementation.yml`](../examples/pull-request-implementation.yml):
one `workflow_dispatch` workflow that starts **or continues** an
agent-implemented PR, invokable three ways.

## Why dispatch instead of assignment

Assignment is the Copilot UX, but as a *mechanism* it is the weakest trigger
available to third parties:

- `on: issues` can only filter by activity `types:` — "assigned to *my* bot"
  must be checked in a job-level `if:`, so every assignment event in the repo
  spawns a run that usually no-ops. Skipped jobs bill no minutes (they are
  never acquired by a runner), but the run-history noise and queue latency
  compound as repos and agents multiply.
- Only a real user can be assigned. A GitHub App's `[bot]` identity cannot be
  — Copilot appears assignable only because GitHub special-cases its own
  first-party actor. So assignment-driven flows force the machine-account
  setup cost onto every adopter.

`workflow_dispatch` inverts both problems: runs happen only when asked for,
GitHub enforces the permission gate (dispatching requires write access), typed
inputs carry the work order, and — because `workflow_dispatch` is an explicit
exception to the `GITHUB_TOKEN` recursion guard — **a plain-token workflow can
dispatch it**. That last property is what makes the triage handoff below work
with no extra credentials.

## Three ways in

**1. From the issue-triage agent.** Give the triage workflow's `GITHUB_TOKEN`
`actions: write` and let the triage agent hand off issues that are fit and
ready:

```bash
gh workflow run pull-request-implementation.yml -f issue=123
```

See [`examples/issue-triage-dispatch.yml`](../examples/issue-triage-dispatch.yml)
for the full triage workflow. The judgment step (triage, read-only-ish) and
the write step (implementation) stay in separate workflows with separate blast
radii.

**2. From a laptop — yours or a local agent's.** Anyone with write access, or
any local agent acting with their credentials, can start a PR from a plain
task description with no issue at all:

```bash
gh workflow run pull-request-implementation.yml \
  -f task="add a --json flag to the list command"
```

This is the piece assignment-driven designs can't offer: local agents submit
implementation runs directly — no issue ceremony, no bot account.

**3. Continue an existing agent PR.** Review feedback arrives; send the agent
back to its own branch:

```bash
gh workflow run pull-request-implementation.yml \
  -f pr=45 -f task="address the review comments"
```

The agent checks the PR out with `gh pr checkout`, addresses the task and
unresolved review threads, and pushes to the same `agent/**` branch.

## Which credential

The dispatch *trigger* needs nothing special. The credential question is about
the implementation job itself, because it pushes a branch and opens a PR — see
[token-permissions.md](token-permissions.md) for the full decision table:

1. **Plain `GITHUB_TOKEN` (start here — what the example ships).** Zero
   credential setup: `contents: write` to push the `agent/**` branch,
   `pull-requests: write` plus the repo setting **"Allow GitHub Actions to
   create and approve pull requests"** (Settings → Actions → General) to open
   the draft PR. One behavior to understand, not a blocker: because
   `GITHUB_TOKEN` events don't trigger workflows, runs on the agent's PR are
   held until a maintainer clicks **"Approve and run"**. That is the same
   human CI gate Copilot's coding agent uses by default — a review checkpoint,
   and arguably the right posture while you're building trust in the loop.
   Attribution is `github-actions[bot]`.
2. **GitHub App token — the upgrade when the approval click gets old.** Mint
   per run with `actions/create-github-app-token` ([github-app.md](github-app.md)).
   The draft PR then **triggers CI and your PR-review agent automatically**
   (App events are not suppressed the way `GITHUB_TOKEN`'s are), attribution
   is your own `[bot]`, still no seat and no server — at the cost of one-time
   App registration and a private key to protect.
3. **Machine-account PAT** — everything the App token does, plus the bot
   becomes assignable/mentionable ([bot-account.md](bot-account.md)). Choose
   it when you *also* want the assignment UX; the same implementation agent
   serves both `assigned-task-agent.yml` and this workflow.

## The safety envelope

Copilot's own hardening is the reference design; the example copies what
generic Actions can express:

- **Draft PRs only, humans merge.** The agent never approves or merges its
  own work; keep it out of CODEOWNERS and behind branch protection.
- **`agent/**` branch namespace** — the agent creates and pushes only its own
  branches; protect everything else.
- **Least-privilege `permissions:`** — `contents: write` +
  `pull-requests: write` on the default setup; shrink to `permissions: {}`
  when an App token or PAT carries the access instead.
- **Human CI gate by default** — with the plain workflow token, the agent's
  PR checks wait for a maintainer's approval, mirroring Copilot's default.
  Upgrading to an App token removes that gate; compensate with required
  checks, branch protection, and the PR-review agent.
- **IDs in, bodies never** — the prompt carries issue/PR *numbers*; the agent
  fetches content with `gh` and treats it as data. The `task` input is free
  text, but dispatching requires write access, so it carries
  collaborator-level trust — keep it short and put detail in the issue.
  Never relay third-party text through `task`.
- **`timeout-minutes` and per-item `concurrency`** — bound runaway runs and
  serialize repeat dispatches for the same issue/PR.
- What we can't reproduce from Copilot: its egress firewall. A hijacked agent
  with `contents: write` can still exfiltrate repo content; compensate with
  single-repo tokens, no extra secrets in env, and review-before-merge.

## Relationship to assignment

[`assigned-task-agent.yml`](../examples/assigned-task-agent.yml) remains the
right shape when your team wants the issue-sidebar UX and already operates a
machine account — it is sugar over the same implementation agent. Teams
starting fresh should start dispatch-first and add assignment later if anyone
misses it. The migration ladder is: workflow token (this page's default) →
App token (automatic CI on agent PRs) → machine account (assignment UX) →
webhook-server App only when no-op volume or cross-repo policy genuinely
demands pre-compute filtering.
