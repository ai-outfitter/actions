# ai-outfitter/actions

Run an [Outfitter](https://github.com/ai-outfitter/outfitter) profile from GitHub Actions. Outfitter assembles the profile (context, prompts, skills, extensions) and launches the agent CLI — [`pi`](https://github.com/earendil-works/pi-coding-agent) by default — in headless print mode (`pi -p`), so the agent does one unit of work per workflow run and exits.

Wire it to any workflow trigger and you have your own Copilot-style reviewer or task agent:

- **On a cron** — review the commits that landed since the last run.
- **When a PR is undrafted** (`ready_for_review`) — run a full review before humans look.
- **When a commit touches a sensitive path** — audit changes to `infra/`, `auth/`, migrations, etc.
- **When a PR or issue is assigned to your bot account** — have the agent complete the task and push a PR.
- **On demand** (`workflow_dispatch`) — start or continue an agent-implemented PR, dispatched by an issue-triage agent, `gh workflow run`, or a local agent.

## Quick start

```yaml
# .github/workflows/pr-review.yml
name: Agent review
on:
  pull_request:
    types: [ready_for_review]

permissions:
  contents: read
  pull-requests: write # let the agent comment on the PR

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ai-outfitter/actions@v1
        with:
          profile: reviewer
          profile-source: my-org/outfitter-catalog
          profile-source-ref: v1.2.0
          prompt: >-
            Review pull request #${{ github.event.pull_request.number }} in
            ${{ github.repository }}. Use `gh pr diff` and `gh pr view` to read
            it, then post your findings as a PR comment with `gh pr comment`.
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

More triggers in [`examples/`](examples/):

- [`scheduled-commit-review.yml`](examples/scheduled-commit-review.yml) — cron review of recent commits
- [`review-undrafted-pr.yml`](examples/review-undrafted-pr.yml) — review when a PR leaves draft
- [`path-audit.yml`](examples/path-audit.yml) — audit pushes to specific directories
- [`assigned-task-agent.yml`](examples/assigned-task-agent.yml) — complete work when an issue/PR is assigned to the bot account
- [`pull-request-implementation.yml`](examples/pull-request-implementation.yml) — start or continue an agent PR on `workflow_dispatch`; see [docs/pull-request-implementation.md](docs/pull-request-implementation.md)
- [`issue-triage-dispatch.yml`](examples/issue-triage-dispatch.yml) — triage new issues and hand fit ones off to the implementation workflow
- [`issue-triage-github-models.yml`](examples/issue-triage-github-models.yml) — triage new issues on GitHub Models, no API keys required

## Workflow-design skill

This repository publishes the standalone `outfitter-actions` skill for setting
up and reviewing agentic workflows. Register the repository as an Outfitter
catalog source:

```yaml
# ~/.outfitter/settings.yml
profile_sources:
  - github: ai-outfitter/actions
    ref: v1
    path: .outfitter
  - path: ./profiles
```

Then select the skill by ID from your own platform profile:

```yaml
# ~/.outfitter/profiles/platform/profile.yml
id: platform
label: Platform

controls:
  skills:
    - outfitter-actions
```

The profile does not inherit anything from this repository. The skill guides
the agent toward a few stable profiles, many progressively disclosed skills,
structured trigger context, and reusable workflows instead of a separate
profile and Actions job for every situation. See
[Designing agentic workflows](docs/agentic-workflows.md).

Running more than a couple of these in one repo or org? See
[docs/design-considerations.md](docs/design-considerations.md) for how to
structure a growing set of agent workflows.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `prompt` | yes | — | Prompt passed to the agent in print mode (`pi -p "<prompt>"`). |
| `profile` | yes | — | Outfitter profile id (`outfitter run --profile`). |
| `profile-source` | no | — | Where the profile comes from: `owner/repo` shorthand, a git URI, or a path inside the checkout (e.g. `.outfitter/profiles`). |
| `profile-source-ref` | no | — | Tag/branch/commit to pin a remote source. Pin catalogs you don't own. |
| `agent` | no | `pi` | Agent adapter: `pi` or `claude`. |
| `github-token` | no | `github.token` | Token exported as `GH_TOKEN`/`GITHUB_TOKEN` for the agent's `gh`/`git` calls. |
| `git-user-name` / `git-user-email` | no | — | Git identity for commits the agent makes. |
| `outfitter-version` | no | `latest` | `@ai-outfitter/outfitter` version to install. |
| `strict` | no | `false` | Fail when profile controls can't be translated by the adapter. |
| `working-directory` | no | `.` | Directory the agent runs in. |
| `transcript-artifact` | no | `outfitter-transcript` | Artifact name for the agent's full session transcript as self-contained HTML (pi only). `""` disables. |

Model provider credentials (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are passed as `env:` on the step, matching whatever provider the profile's `controls` select. Store them as repository or organization secrets. Alternatively, run on [GitHub Models](#using-github-models-no-api-keys) with no secrets at all.

## Session transcripts

In print mode the agent's reasoning is invisible: the job log shows only its
final printed line, and the issue or PR shows only its side effects. To keep
the full decision trail, the action saves the agent's session (every prompt,
tool call, and response) as a self-contained HTML page — pi's native
`--export` — and uploads it as a workflow artifact named by
`transcript-artifact` (on by default; pi only). The export runs even when the
agent step fails, which is when a transcript matters most.

The artifact's download link is exposed as the `transcript-artifact-url`
output, so a follow-up step can post it back to the issue or PR the agent
worked on — see [`examples/issue-triage-github-models.yml`](examples/issue-triage-github-models.yml),
which appends it to the agent's own triage comment. Viewing the artifact
requires being logged in to GitHub with access to the repository, so the link
is safe to post on public issues; artifacts expire with the repository's
retention setting (default 90 days).

Transcripts contain whatever the agent saw and did — issue text, file
contents, command output. With the default workflow token that is content
from the same repository, but review before enabling on jobs whose profile
reads anything more sensitive than the repo the link is posted in.

## Using GitHub Models (no API keys)

The agent doesn't have to call a paid provider. [GitHub Models](https://docs.github.com/en/github-models) serves hosted models authenticated by the workflow's own `GITHUB_TOKEN`. No secrets to create, store, or rotate. Three parts:

**1. Grant the permission.** Add `models: read` to the workflow's `permissions:` block. The same short-lived installation token that scopes the agent's `gh` calls then also authenticates inference; it's a read-only permission, so it adds nothing to the token's blast radius.

```yaml
permissions:
  contents: read
  issues: write
  models: read
```

**2. Describe the provider to `pi`.** Commit a provider config (e.g. `.github/models.json`) pointing at the GitHub Models endpoint. The `$GITHUB_TOKEN` reference is resolved from the environment at runtime — this action exports `GITHUB_TOKEN` on the agent step, so no extra wiring is needed:

```json
{
  "providers": {
    "github-models": {
      "baseUrl": "https://models.github.ai/inference",
      "api": "openai-completions",
      "apiKey": "$GITHUB_TOKEN",
      "authHeader": true,
      "models": [
        { "id": "openai/gpt-4.1-mini", "name": "GPT-4.1 mini (GitHub Models)", "reasoning": false }
      ]
    }
  }
}
```

**3. Install it before the action step.** `pi` reads custom providers from `~/.pi/agent/models.json`:

```yaml
- name: Configure GitHub Models provider for pi
  run: |
    mkdir -p "$HOME/.pi/agent"
    cp .github/models.json "$HOME/.pi/agent/models.json"
```

Then select the provider in the profile's `controls` (`provider: github-models`, `model: openai/gpt-4.1-mini`). See [`examples/issue-triage-github-models.yml`](examples/issue-triage-github-models.yml) for a complete workflow.

**Choosing a model.** Three gotchas found by running this in anger:

- Check the model id exists in the live catalog (`curl -s https://models.github.ai/catalog/models`) — the catalog is a subset of what GitHub Models markets, and a missing id fails at inference time with `404 unknown_model`, not at startup.
- Some models are wire-incompatible with `pi`'s OpenAI adapter: DeepSeek V3 returns the nonstandard finish reason `tool_call` (singular) on tool calls, which aborts the run.
- Small open-weight models may not hold an agentic loop at all: Llama 4 Maverick fabricated tool results in a single completion and exited green having done nothing. If the job must *act* (label, comment, push), verify the model actually drives the tools before trusting a green run.

**Mind the limits.** GitHub Models' included tier has low per-day request caps and tight context/output token limits per request, and organizations can disable GitHub Models entirely. It fits event-driven, one-shot jobs — issue triage, small classifications — not high-volume review loops or long agentic sessions. For those, use a paid provider key.

## Scoping what the agent can do

You are handing a language-model agent a token and a shell. Treat the token as the blast radius and keep it as small as the job allows. **Read [docs/token-permissions.md](docs/token-permissions.md) before granting anything beyond the defaults.**

The short version:

1. **Prefer the workflow's own `GITHUB_TOKEN`** with an explicit least-privilege [`permissions:` block](https://docs.github.com/en/actions/using-jobs/assigning-permissions-to-jobs). It is repo-scoped, short-lived, and revoked when the job ends. A read-only reviewer needs nothing more than `contents: read` + `pull-requests: write`.
2. **When the agent must act as its own identity** — open PRs that trigger other workflows, be assignable, be @-mentionable — create a **dedicated machine account** and give the action a **fine-grained PAT** from that account, restricted to the specific repositories and the minimum permission set. See [docs/bot-account.md](docs/bot-account.md).
3. **Never use a human's PAT.** A personal token inherits everything that person can touch, and actions taken with it are indistinguishable from the human's.

### Trust boundaries to keep in mind

- The prompt, the diff under review, and issue/PR text are all **untrusted input** to the agent. Assume prompt injection: a PR under review can contain text that tries to redirect the agent. The token's scope — not the prompt — is your real control.
- Avoid interpolating attacker-controlled text (PR titles, issue bodies) directly into `prompt:` via `${{ }}`. Reference the PR/issue by number and let the agent fetch content with `gh`, so the untrusted text stays data rather than becoming workflow-file code.
- When the agent posts text derived from untrusted input (issue bodies, diffs) back through `gh`, its profile should require `--body-file` with a quoted heredoc, never inline `--body "..."` — backticks in a double-quoted body are executed by the shell, turning quoted issue text into command execution on the runner. (Observed live: a comment restating `` `outfitter sync` `` ran the command.)
- Pin `profile-source-ref` for catalogs you don't own — profiles can inject extensions, CLI args, and environment variables into the agent launch ([trust and review](https://github.com/ai-outfitter/outfitter/blob/main/docs/documentation/profile-repository.md#trust-and-review)).
- Don't run this action on `pull_request_target` with a write token against untrusted fork code.

## How it works

Each run installs `@ai-outfitter/outfitter`, writes a minimal `~/.outfitter/settings.yml` on the runner (default profile/agent plus your `profile-source`), syncs remote catalogs, then executes:

```bash
outfitter run --profile <profile> --agent pi -- -p "<prompt>"
```

Outfitter composes the profile into agent configuration and launches `pi` in print mode; `pi` inherits `GH_TOKEN`, does its work with `gh`/`git`/the tools the profile grants, prints its result to the job log, and exits. The runner is discarded afterwards — nothing persists between runs except what the agent pushed through the token.

## License

MIT
