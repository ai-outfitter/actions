# ai-outfitter/actions

Run an [Outfitter](https://github.com/ai-outfitter/outfitter) profile from GitHub Actions. Outfitter assembles the profile (context, prompts, skills, extensions) and launches the agent CLI — [`pi`](https://github.com/earendil-works/pi-coding-agent) by default — in headless print mode (`pi -p`), so the agent does one unit of work per workflow run and exits.

Wire it to any workflow trigger and you have your own Copilot-style reviewer or task agent:

- **On a cron** — review the commits that landed since the last run.
- **When a PR is undrafted** (`ready_for_review`) — run a full review before humans look.
- **When a commit touches a sensitive path** — audit changes to `infra/`, `auth/`, migrations, etc.
- **When a PR or issue is assigned to your bot account** — have the agent complete the task and push a PR.

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
- [`pr-ready-for-review.yml`](examples/pr-ready-for-review.yml) — review when a PR leaves draft
- [`path-audit.yml`](examples/path-audit.yml) — audit pushes to specific directories
- [`assigned-task-agent.yml`](examples/assigned-task-agent.yml) — complete work when an issue/PR is assigned to the bot account

## Bundled workflow-design profile

This repository ships a small `outfitter-actions` profile for designing and
reviewing workflows built on this action. It includes the `outfitter-actions`
skill, which captures the recommended pattern: few profiles, many skills, and
structured GitHub trigger context passed into the prompt.

Most users should add the skill to their existing Outfitter platform profile so
the guidance is available inside the profile they already use to design and
maintain automation:

```yaml
# .outfitter/profiles/platform.yml
id: platform
label: Platform
controls:
  pi:
    skills:
      - .outfitter/skills/outfitter-actions
```

Then the platform profile can be launched from a workflow as usual:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    profile: platform
    profile-source: .outfitter/profiles
    prompt: |
      Review this workflow design and suggest how to keep it dry.

      trigger_context:
        repository: ${{ github.repository }}
        workflow: ${{ github.workflow }}
        event_name: ${{ github.event_name }}
        event_action: ${{ github.event.action || '' }}
        ref_name: ${{ github.ref_name }}
        sha: ${{ github.sha }}
```

The bundled `outfitter-actions` profile is intentionally small: it exists as a
copyable reference and as a direct profile for repos that only want this
workflow-design guidance, without tying the skill to a project-specific catalog.

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

Model provider credentials (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are passed as `env:` on the step, matching whatever provider the profile's `controls` select. Store them as repository or organization secrets.

## Scoping what the agent can do

You are handing a language-model agent a token and a shell. Treat the token as the blast radius and keep it as small as the job allows. **Read [docs/token-permissions.md](docs/token-permissions.md) before granting anything beyond the defaults.**

The short version:

1. **Prefer the workflow's own `GITHUB_TOKEN`** with an explicit least-privilege [`permissions:` block](https://docs.github.com/en/actions/using-jobs/assigning-permissions-to-jobs). It is repo-scoped, short-lived, and revoked when the job ends. A read-only reviewer needs nothing more than `contents: read` + `pull-requests: write`.
2. **When the agent must act as its own identity** — open PRs that trigger other workflows, be assignable, be @-mentionable — create a **dedicated machine account** and give the action a **fine-grained PAT** from that account, restricted to the specific repositories and the minimum permission set. See [docs/bot-account.md](docs/bot-account.md).
3. **Never use a human's PAT.** A personal token inherits everything that person can touch, and actions taken with it are indistinguishable from the human's.

### Trust boundaries to keep in mind

- The prompt, the diff under review, and issue/PR text are all **untrusted input** to the agent. Assume prompt injection: a PR under review can contain text that tries to redirect the agent. The token's scope — not the prompt — is your real control.
- Avoid interpolating attacker-controlled text (PR titles, issue bodies) directly into `prompt:` via `${{ }}`. Reference the PR/issue by number and let the agent fetch content with `gh`, so the untrusted text stays data rather than becoming workflow-file code.
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
