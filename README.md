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
          agent: reviewer
          source: my-org/outfitter-catalog
          source-ref: v1.2.0
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
- [`preview-environment-review.yml`](examples/preview-environment-review.yml) — review a PR's deployed preview environment in a real browser

## Workflow-design skill

This repository publishes the standalone `outfitter-actions` skill for setting
up and reviewing agentic workflows. Register the repository as an Outfitter
catalog source:

```yaml
# ~/.outfitter/settings.yml
sources:
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

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `prompt` | yes | — | Prompt passed to the agent in print mode (`pi -p "<prompt>"`). |
| `agent` | no | — | Agent slug to run. An `agent:<slug>` label on the triggering issue or PR wins over this; with neither, the catalog's `default_agent` applies. |
| `source` | no | — | Catalog to resolve from: `owner/repo` shorthand, a git URI, or a path inside the checkout. Defaults to the repo's `.agents/`, then a payload at the repo root, then `<owner>/.agents`. |
| `source-ref` | no | — | Tag/branch/commit to pin a remote source. Pin catalogs you don't own. |
| `harness` | no | `pi` | Harness to launch: `pi`, `claude`, or `codex`. |
| `browser` | no | `none` | `chrome` provides a Chromium binary for the run and exports `CHROME_PATH`/`PLAYWRIGHT_MCP_EXECUTABLE_PATH`/`PUPPETEER_EXECUTABLE_PATH` for browser MCP servers. See [Browser access](#browser-access). |
| `github-token` | no | `github.token` | Token exported as `GH_TOKEN`/`GITHUB_TOKEN` for the agent's `gh`/`git` calls. |
| `git-user-name` / `git-user-email` | no | — | Git identity for commits the agent makes. |
| `outfitter-version` | no | `latest` | `@ai-outfitter/outfitter` version to install. |
| `strict` | no | `false` | Fail when profile controls can't be translated by the adapter. |
| `working-directory` | no | `.` | Directory the agent runs in. |
| `transcript-artifact` | no | `outfitter-transcript` | Artifact name for the agent's full session transcript as self-contained HTML (pi only). `""` disables. |

Model provider credentials (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are passed as `env:` on the step, matching whatever provider the profile's `controls` select. Store them as repository or organization secrets.

## Browser access

Set `browser: chrome` to let the agent drive a real browser — for example to
review a PR's deployed preview environment. The action does not start the
browser itself; it makes sure a Chromium binary exists and exports its path
(`CHROME_PATH`, `PLAYWRIGHT_MCP_EXECUTABLE_PATH`,
`PUPPETEER_EXECUTABLE_PATH`), then the profile supplies the driver: declare a
browser MCP server in the catalog's `mcp.json` and select it from the agent's
`mcp:` frontmatter.

Each server picks up the exported path differently.
[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
reads no environment variable for this — its documented option is
`--executablePath` — so wrap it in a shell that expands `$CHROME_PATH`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "sh",
      "args": [
        "-c",
        "exec npx -y chrome-devtools-mcp@latest --headless --executablePath \"$CHROME_PATH\" --chromeArg=--no-sandbox"
      ]
    }
  }
}
```

The [Playwright MCP](https://github.com/microsoft/playwright-mcp) reads
`PLAYWRIGHT_MCP_EXECUTABLE_PATH` directly, so no wrapper is needed:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--headless", "--no-sandbox"]
    }
  }
}
```

**Pin the server version, and mind where `npx` resolves from.** The examples
above say `@latest` for brevity; pin a version in a real catalog, because an
unversioned `npx` both runs whatever upstream published today and prefers a
package resolved from the current directory — which, for a reviewing agent, is
the pull request's own checkout. A PR that commits `node_modules/.bin/chrome-devtools-mcp`
would otherwise run with the agent step's environment, including model
credentials. The action defends its own install step the same way (pinned
version, run outside the workspace).

**On `--no-sandbox`:** self-hosted and Forgejo runners commonly execute jobs
as root inside a container, and Chrome refuses to launch its sandbox as root
— without the flag the browser never starts. The tradeoff is real: disabling
the sandbox removes Chrome's process isolation, so a malicious page the agent
visits is one renderer exploit away from the runner (and the job's tokens).
Point the agent only at pages you deploy yourself, and drop the flag on
runners where jobs run as a regular user (GitHub-hosted images do; the
sandbox works there).

A browser already on the runner is used as-is (GitHub-hosted Ubuntu images
ship Chrome); otherwise the action installs Chromium with a pinned Playwright
release (`npx playwright@<version> install --with-deps chromium`), which most
self-hosted and Forgejo runner images need. Pass the page under review the same way as any
other value: interpolate it into `prompt:`, or set `env: PREVIEW_URL:` on the
step and tell the prompt to open `$PREVIEW_URL` — step env reaches the agent
and its MCP servers with no action support. One profile caveat: a
`state_persistence` policy that sets `mcp.json: error` blocks the injected
server — leave it writable in browser profiles.

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
worked on — see [`examples/issue-triage-dispatch.yml`](examples/issue-triage-dispatch.yml). Viewing the artifact
requires being logged in to GitHub with access to the repository, so the link
is safe to post on public issues; artifacts expire with the repository's
retention setting (default 90 days).

Transcripts contain whatever the agent saw and did — issue text, file
contents, command output. With the default workflow token that is content
from the same repository, but review before enabling on jobs whose profile
reads anything more sensitive than the repo the link is posted in.

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
- Pin `source-ref` for catalogs you don't own — profiles can inject extensions, CLI args, and environment variables into the agent launch ([trust and review](https://github.com/ai-outfitter/outfitter/blob/main/docs/documentation/profile-repository.md#trust-and-review)).
- Don't run this action on `pull_request_target` with a write token against untrusted fork code.

## How it works

Each run installs `@ai-outfitter/outfitter`, writes a minimal `~/.outfitter/settings.yml` on the runner (the agent and harness plus the resolved `source`), syncs remote catalogs, then executes:

```bash
outfitter run <agent> --harness pi -- -p "<prompt>"
```

Outfitter composes the agent's configuration and launches `pi` in print mode; `pi` inherits `GH_TOKEN`, does its work with `gh`/`git`/the tools the profile grants, prints its result to the job log, and exits. The runner is discarded afterwards — nothing persists between runs except what the agent pushed through the token.

## License

MIT
