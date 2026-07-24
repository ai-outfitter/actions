# Token permissions

The agent launched by this action runs arbitrary tool calls — `gh`, `git`, shell — with whatever token you hand it. Its inputs (diffs, issue text, PR comments) are untrusted, so assume the worst prompt injection and scope the token so that even a fully hijacked agent can't do more than the job requires.

There are three recommended credential options plus one shortcut. Default to the first; move to a stronger credential only when the job needs a capability listed in its row.

| Credential                              | Recommended when                                                                                                                                                      | Setup                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Workflow `GITHUB_TOKEN`                 | **Default.** Single-repo jobs that read, comment, label, or open issues/PRs that don't need CI: triage, reviews, reports.                                             | Strategy 1 below                            |
| Fine-grained PAT from a machine account | The agent must be **assignable**, @-mentionable, a distinct reviewer, or its PRs must trigger CI — assignment-driven implementation.                                  | [bot-account.md](bot-account.md)            |
| GitHub App installation token           | **Org-scale**: many repos under one centrally managed policy, short-lived per-run tokens, no seat. Not assignable — pair with a machine account for assignment flows. | [github-app.md](github-app.md)              |
| PAT from your own account               | **Not recommended.** Works through the same `github-token` input — acceptable for a quick trial on a personal repo, nothing more.                                     | [Why not a human PAT](#why-not-a-human-pat) |

## What each credential's workflows look like

- **`GITHUB_TOKEN` workflows read the repository and write conversation.** The
  run comments, labels, or opens an issue or PR, and nothing it creates needs
  to trigger further CI: issue triage on open, a PR review when a draft is
  marked ready, a scheduled commit review that files an issue, a path audit
  on push. Everything stays in the one repository the workflow lives in.
- **Machine-account workflows act like a teammate.** A human assigns the bot
  an issue or PR; the agent implements the change on a branch, pushes as its
  own identity, and opens a draft PR that runs CI like anyone else's. Reviews
  and comments read as the bot, and the audit trail separates its work from
  humans'. On self-hosted forges (Gitea, Forgejo), machine accounts have no
  seat cost or terms limit, so one account per persona is practical — see
  [bot-account.md](bot-account.md#self-hosted-forges-gitea-forgejo-and-friends).
- **GitHub App workflows are fleet automation.** The same reusable workflow is
  installed across many repositories under one org-managed policy: nightly
  reports across a portfolio, org-wide dependency or convention sweeps, a
  platform agent serving every product repo. Each run mints its own
  short-lived token; nothing long-lived exists to rotate per repo.
- **A personal PAT is the ten-minute trial.** It gets an experiment running on
  your own repository with zero setup, but it carries everything your account
  can touch and blends the agent's actions into your identity. Switch to one
  of the rows above before the workflow does real work.

## Strategy 1: the workflow `GITHUB_TOKEN` (default)

If you pass nothing to `github-token`, the action uses the workflow's installation token. This is the safest option:

- **Repo-scoped** — it can only touch the repository the workflow runs in.
- **Short-lived** — it expires when the job finishes; nothing to rotate or leak long-term.
- **Explicitly permissioned** — you declare exactly what it can do with a `permissions:` block, and everything not listed is `none`.

Always set the `permissions:` block explicitly at the workflow or job level; don't rely on the org/repo default (which may be broad write). Recommended sets per use case:

| Use case                                    | `permissions:`                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Scheduled commit review (report to issue)   | `contents: read`, `issues: write`                                                                         |
| PR review with comments                     | `contents: read`, `pull-requests: write`                                                                  |
| Path audit posting a commit comment         | `contents: read` _(commit comments need `contents: write`; prefer opening an issue with `issues: write`)_ |
| Agent that pushes a branch and opens a PR   | `contents: write`, `pull-requests: write`                                                                 |
| Issue triage on GitHub Models (no API keys) | `contents: read`, `issues: write`, `models: read`                                                         |

One permission deserves a note: `models: read` lets the same `GITHUB_TOKEN` authenticate inference against [GitHub Models](https://docs.github.com/en/github-models), making the token both the agent's acting credential and its model credential. It is read-only — it grants no new write surface — but it does mean a single `permissions:` block now describes everything the run can do _and_ what it thinks with. See the README's "Using GitHub Models (no API keys)" section.

Known limitations of `GITHUB_TOKEN`:

- Events it creates (pushes, PRs, comments) **do not trigger other workflows**. That's a deliberate recursion guard — if you need the agent's PRs to run CI, you need Strategy 2.
- It acts as `github-actions[bot]`; it can't be assigned issues, @-mentioned, or given a distinct reviewer identity.
- It cannot push to a branch protected by rules that exclude the Actions app, and can't touch other repositories.

## Strategy 2: fine-grained PAT from a dedicated machine account

When the agent needs its own identity (assignable, mentionable, PRs that trigger CI, cross-repo access), create a machine account (see [bot-account.md](bot-account.md)) and issue a **fine-grained personal access token** from it. Never use a classic PAT — classic scopes like `repo` are all-or-nothing across every repository the account can reach.

When creating the fine-grained PAT:

1. **Resource owner**: your organization (this also lets org admins list and revoke it).
2. **Repository access**: "Only select repositories" — list exactly the repos the agent works in. Never "All repositories".
3. **Repository permissions** — grant the minimum for the job, mirroring the table above:
   - Reviewer agents: `Contents: Read`, `Pull requests: Read and write`, `Metadata: Read` (implied).
   - Task-completing agents: add `Contents: Read and write` so it can push branches, plus `Issues: Read and write` if it works issues.
   - Grant `Workflows: Read and write` **only** if the agent must edit files under `.github/workflows/` — this is effectively the keys to CI; leave it off by default.
4. **Organization permissions**: none, unless the agent genuinely manages org resources.
5. **Expiration**: set one (90 days is a reasonable ceiling) and rotate. Fine-grained PATs support expiry precisely so a leaked token has a bounded life.

Store the PAT as an Actions secret (repo-level, or org-level restricted to the repos that need it) and pass it in:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    github-token: ${{ secrets.OUTFITTER_BOT_TOKEN }}
    agent: task-agent
    prompt: "..."
```

If the agent should also _check out_ private repos beyond the current one, pass the same token to `actions/checkout`'s `token:` input.

### Why not a human PAT

A fine-grained PAT from your own account does work — pass it through the same `github-token` input — and it is the fastest way to trial the action on a personal repository. Beyond that trial it is not recommended: a human PAT carries every repository and permission that person has, cannot be scoped to "just this bot's job" organizationally, and makes the agent's actions forensically indistinguishable from the human's. If the agent misbehaves — or is prompt-injected into misbehaving — you want the audit log to say the bot did it, and you want revoking the bot to cost nothing.

### GitHub App as a further step

For organizations that want installation-scoped, auto-expiring tokens with a bot identity, a GitHub App (using `actions/create-github-app-token` to mint a token per run) is a stronger version of Strategy 2: tokens live ~1 hour, permissions are declared on the app, and installation is per-repo. The action consumes the minted token through the same `github-token` input. The machine-account PAT remains the simpler path if you don't want to operate an App — and the only path when the agent must be assignable. See [github-app.md](github-app.md) for setup and guardrails.

## Hardening checklist

- [ ] `permissions:` block declared explicitly on every workflow using this action.
- [ ] Secrets (`ANTHROPIC_API_KEY`, bot PAT) stored as Actions secrets, never in the workflow file or agent catalog.
- [ ] Fine-grained PAT: selected-repos only, minimum permissions, expiration set, owned by the machine account.
- [ ] No `pull_request_target` + write token + untrusted fork code in the same workflow.
- [ ] Untrusted text (PR titles/bodies, issue bodies) is not interpolated into `prompt:` — the agent fetches it with `gh` instead.
- [ ] `source-ref` pinned for any source your team doesn't control.
- [ ] For environments-based gating (deploy keys, production secrets), put the agent job behind a GitHub Environment with required reviewers.
