# Running the agent under a dedicated GitHub account

By default the action acts as `github-actions[bot]` via the workflow token. To give your agent its own identity — so it can be assigned issues, requested as a reviewer, @-mentioned, and produce PRs that trigger CI — run it under a dedicated **machine account**.

## Why a dedicated account

- **Identity & audit** — every comment, commit, and PR is attributed to the bot. Reviews read as "outfitter-bot approved", and the audit log separates agent actions from human ones.
- **Blast radius** — the account is only ever granted the repos and roles the agent needs. Revoking or suspending it disables the agent everywhere at once without touching any human's access.
- **Triggerability** — PRs and pushes made with a machine-account PAT trigger workflows normally (unlike `GITHUB_TOKEN`), so the agent's PRs get CI.
- **Assignability** — "when a PR is assigned to X, run the agent" needs an X that is a real account.

GitHub's terms allow one machine account per user for this purpose; on GitHub Enterprise Cloud, use a dedicated managed user instead.

## Setup

1. **Create the account** — e.g. `myorg-outfitter-bot`, with an email your team controls (a shared alias like `outfitter-bot@myorg.com`). Enable 2FA and store the credentials in your team's secret manager; no human should use this account interactively.
2. **Invite it to the organization** with the least role that works. Give it repository access via a team so membership is reviewable — `Write` on the repos it must push to, `Triage`/`Read` where it only comments (note: PR comments and reviews via API need at least read access plus the PAT's `Pull requests: write` permission).
3. **Issue a fine-grained PAT** from the bot account, scoped to only the repositories the agent works in, with the minimum permissions — see [token-permissions.md](token-permissions.md#strategy-2-fine-grained-pat-from-a-dedicated-machine-account). If your org requires approval for fine-grained PATs, an org admin approves it once.
4. **Store the PAT** as an Actions secret (e.g. `OUTFITTER_BOT_TOKEN`) at the repo level, or org level restricted to selected repositories.
5. **Wire it into the workflow**:

```yaml
jobs:
  agent:
    # Only run when the bot account itself was assigned
    if: github.event.assignee.login == 'myorg-outfitter-bot'
    runs-on: ubuntu-latest
    permissions: {} # the PAT carries the access; the workflow token gets none
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.OUTFITTER_BOT_TOKEN }} # pushes happen as the bot
          fetch-depth: 0
      - uses: ai-outfitter/actions@v1
        with:
          github-token: ${{ secrets.OUTFITTER_BOT_TOKEN }}
          git-user-name: myorg-outfitter-bot
          git-user-email: outfitter-bot@myorg.com
          profile: task-agent
          profile-source: my-org/outfitter-catalog
          profile-source-ref: v1.2.0
          prompt: >-
            You are assigned issue #${{ github.event.issue.number }} in
            ${{ github.repository }}. Read it with `gh issue view`, implement
            the change on a branch named agent/issue-${{ github.event.issue.number }},
            push it, and open a draft PR that references the issue.
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Because `actions/checkout` is given the bot's token and the git identity is set to the bot, commits and pushes are attributed to the machine account, and the resulting PR triggers CI like any human-opened PR.

## Guardrails for the bot account

- **Branch protection still applies.** Don't exempt the bot from required reviews on protected branches; let it open PRs that humans merge. The agent proposing changes and a human approving them is the point of the workflow.
- **CODEOWNERS** — leave the bot out of CODEOWNERS so its approval never satisfies a required-review rule by itself.
- **Recursion guard** — when the bot's PRs trigger workflows that could re-invoke the agent, gate agent jobs with `if: github.actor != 'myorg-outfitter-bot'` (or an equivalent label check) so the agent doesn't respond to itself.
- **Rotate the PAT** on a schedule (fine-grained PATs have expiry; use it) and immediately if a workflow log ever suggests the token was echoed.
- **Review its footprint periodically** — the org's people/teams pages and the PAT list under the org's settings show exactly what the bot can reach; prune repos it no longer works in.
