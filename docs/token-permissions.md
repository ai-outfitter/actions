# Token permissions

The agent launched by this action runs arbitrary tool calls — `gh`, `git`, shell — with whatever token you hand it. Its inputs (diffs, issue text, PR comments) are untrusted, so assume the worst prompt injection and scope the token so that even a fully hijacked agent can't do more than the job requires.

There are two token strategies. Use the first unless you specifically need the second.

## Strategy 1: the workflow `GITHUB_TOKEN` (default)

If you pass nothing to `github-token`, the action uses the workflow's installation token. This is the safest option:

- **Repo-scoped** — it can only touch the repository the workflow runs in.
- **Short-lived** — it expires when the job finishes; nothing to rotate or leak long-term.
- **Explicitly permissioned** — you declare exactly what it can do with a `permissions:` block, and everything not listed is `none`.

Always set the `permissions:` block explicitly at the workflow or job level; don't rely on the org/repo default (which may be broad write). Recommended sets per use case:

| Use case | `permissions:` |
| --- | --- |
| Scheduled commit review (report to issue) | `contents: read`, `issues: write` |
| PR review with comments | `contents: read`, `pull-requests: write` |
| Path audit posting a commit comment | `contents: read` *(commit comments need `contents: write`; prefer opening an issue with `issues: write`)* |
| Agent that pushes a branch and opens a PR | `contents: write`, `pull-requests: write` |

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
    profile: task-agent
    prompt: "..."
```

If the agent should also *check out* private repos beyond the current one, pass the same token to `actions/checkout`'s `token:` input.

### Why not a human PAT

A PAT from a human account carries every repository and permission that person has, cannot be scoped to "just this bot's job" organizationally, and makes the agent's actions forensically indistinguishable from the human's. If the agent misbehaves — or is prompt-injected into misbehaving — you want the audit log to say the bot did it, and you want revoking the bot to cost nothing.

### GitHub App as a further step

For organizations that want installation-scoped, auto-expiring tokens with a bot identity, a GitHub App (using `actions/create-github-app-token` to mint a token per run) is a stronger version of Strategy 2: tokens live ~1 hour, permissions are declared on the app, and installation is per-repo. The action consumes the minted token through the same `github-token` input. The machine-account PAT remains the simpler path if you don't want to operate an App. See [github-app-agents.md](github-app-agents.md) for the full setup, including @-mention-triggered agents.

## Hardening checklist

- [ ] `permissions:` block declared explicitly on every workflow using this action.
- [ ] Secrets (`ANTHROPIC_API_KEY`, bot PAT) stored as Actions secrets, never in the workflow file or profile catalog.
- [ ] Fine-grained PAT: selected-repos only, minimum permissions, expiration set, owned by the machine account.
- [ ] No `pull_request_target` + write token + untrusted fork code in the same workflow.
- [ ] Untrusted text (PR titles/bodies, issue bodies) is not interpolated into `prompt:` — the agent fetches it with `gh` instead.
- [ ] `profile-source-ref` pinned for any catalog your team doesn't control.
- [ ] For environments-based gating (deploy keys, production secrets), put the agent job behind a GitHub Environment with required reviewers.
