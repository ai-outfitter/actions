# Running the agent as a GitHub App

A GitHub App gives the agent installation-scoped, auto-expiring tokens with
its own bot identity. Tokens minted per run live about an hour, permissions
are declared once on the app, and installation is per-repository — the
strongest credential posture for org-scale automation.

## When to choose an App

- **Many repositories, one policy** — permissions live on the app; installing
  it on a repo is the whole grant. No per-repo PAT sprawl.
- **Short-lived tokens** — a leaked token expires within the hour; there is no
  standing credential to rotate besides the app's private key.
- **Org-controlled** — admins see, audit, suspend, or uninstall the app
  centrally; no seat is consumed.
- **Triggerability** — pushes and PRs made with an installation token trigger
  workflows normally, so agent PRs get CI.

Known limitation: an App is not a user. It cannot be **assigned** issues or
PRs, join teams, or be granted roles the way an account can. For
assignment-driven flows ("when the bot is assigned, implement it"), use a
[machine account](bot-account.md) instead — or alongside, using the App for
everything that doesn't need assignability.

## Setup

1. **Create the app** under the organization (Settings → Developer settings →
   GitHub Apps): give it a clear name (`myorg-outfitter`), disable webhooks,
   and grant the minimum repository permissions for the job — mirror the
   tables in [token-permissions.md](token-permissions.md). Leave
   `Workflows: Read and write` off unless the agent must edit
   `.github/workflows/`.
2. **Install it** on only the repositories the agent works in — never "All
   repositories".
3. **Store the credentials**: the app ID as a repo or org variable
   (`OUTFITTER_APP_ID`) and the app's private key as an Actions secret
   (`OUTFITTER_APP_PRIVATE_KEY`).
4. **Mint a token per run** and pass it through the same `github-token`
   input:

```yaml
jobs:
  agent:
    runs-on: ubuntu-latest
    permissions: {} # the app token carries the access; the workflow token gets none
    steps:
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ vars.OUTFITTER_APP_ID }}
          private-key: ${{ secrets.OUTFITTER_APP_PRIVATE_KEY }}
      - uses: actions/checkout@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          fetch-depth: 0
      - uses: ai-outfitter/actions@v1
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          git-user-name: myorg-outfitter[bot]
          git-user-email: myorg-outfitter[bot]@users.noreply.github.com
          profile: task-agent
          profile-source: my-org/outfitter-catalog
          profile-source-ref: v1.2.0
          prompt: "..."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Guardrails

- **Recursion guard** — gate agent jobs with
  `if: github.actor != 'myorg-outfitter[bot]'` so the app's own pushes and
  PRs don't re-invoke the agent.
- **Branch protection still applies** — let the app open PRs that humans
  merge; don't exempt it from required reviews.
- **Protect the private key** — it can mint tokens for every installation.
  Store it only as an Actions secret, rotate it if exposure is suspected, and
  prefer org-level secrets restricted to the repos that run the agent.
- **Review installations periodically** — the app's installation page lists
  exactly what it can reach; prune repos it no longer works in.
