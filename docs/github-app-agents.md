# @-mentionable agents with a GitHub App

A GitHub App gives your agent a first-class bot identity — `@my-outfitter-agent` — without a machine account or a long-lived PAT. Anyone on the team writes `@my-outfitter-agent fix the flaky test in ci.yml` in an issue or PR comment, a workflow picks the mention up, mints a short-lived token as the App, and runs the agent; the reply comment comes from `my-outfitter-agent[bot]`.

## Why an App instead of a machine account

Compared to the [machine-account PAT](bot-account.md) approach:

- **Short-lived tokens** — each run mints an installation token that expires after ~1 hour. There is no standing credential to rotate or leak; the only long-lived secret is the App's private key, which never leaves your Actions secrets.
- **Org-owned** — the App belongs to the organization, not to a pseudo-user. No seat, no password, no 2FA device to manage, and org admins can audit or uninstall it in one place.
- **Declared permissions** — the App's permission set is declared once on the App and caps every token minted from it. Installation is per-repository, so the blast radius is visible in the org's App settings.
- **CI still triggers** — PRs, pushes, and comments made with an installation token trigger other workflows normally (unlike `GITHUB_TOKEN`), so the agent's PRs get CI.

What an App **cannot** do: its `[bot]` user is not a real account, so it can't be *assigned* issues or *requested as a reviewer*. If your trigger is "when the bot is assigned" rather than "when the bot is mentioned", you still need a [machine account](bot-account.md). Mentioning works fine — which is exactly what this pattern uses.

## How the mention actually triggers

There is no "mention webhook → workflow" wiring in GitHub Actions. The trigger is textual:

1. The workflow subscribes to `issue_comment` (fires for comments on both issues and PRs; add `pull_request_review_comment` for inline diff comments).
2. A job-level `if:` checks that the comment body contains `@my-outfitter-agent` and that the author is trusted.
3. The job mints an App token and runs the agent, which replies via `gh`.

The `@` in the comment resolves to the App's bot user for display/autocomplete, but as far as Actions is concerned it's just a substring you match. That also means the guard on *who* wrote the comment is your only access control — see [Guardrails](#guardrails).

## Setup

1. **Create the App** — org settings → Developer settings → GitHub Apps → New GitHub App. Name it what you want the mention to be (`my-outfitter-agent`; the bot user becomes `my-outfitter-agent[bot]`). Disable webhooks (Actions is doing the event handling), and set it to "Only on this account".
2. **Declare permissions** — the App-level permissions cap every token it mints. Mirror the [least-privilege table](token-permissions.md#strategy-1-the-workflow-github_token-default): a comment-answering agent needs `Contents: Read`, `Issues: Read and write`, `Pull requests: Read and write`; add `Contents: Read and write` only if it should push branches.
3. **Install the App** on the organization, restricted to **selected repositories** — only the repos the agent works in.
4. **Generate a private key** on the App page and store it as an Actions secret (e.g. `OUTFITTER_APP_PRIVATE_KEY`), alongside the App ID (`OUTFITTER_APP_ID`, fine as a variable).
5. **Add the workflow**:

```yaml
# .github/workflows/mention-agent.yml
name: Outfitter mention agent
on:
  issue_comment:
    types: [created]

permissions: {} # the App token carries the access; the workflow token gets none

jobs:
  agent:
    # Only run for a mention, and only from someone with a real role in the repo
    if: >-
      contains(github.event.comment.body, '@my-outfitter-agent') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v2
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
          git-user-name: my-outfitter-agent[bot]
          git-user-email: my-outfitter-agent[bot]@users.noreply.github.com
          profile: task-agent
          profile-source: my-org/outfitter-catalog
          profile-source-ref: v1.2.0
          prompt: >-
            You were mentioned in ${{ github.repository }}
            ${{ github.event.issue.pull_request && 'pull request' || 'issue' }}
            #${{ github.event.issue.number }}, comment id
            ${{ github.event.comment.id }}. Read the thread with
            `gh issue view ${{ github.event.issue.number }} --comments`, do what
            the mentioning comment asks, and reply on the thread with
            `gh issue comment`. If the task needs code changes, push a branch
            named agent/issue-${{ github.event.issue.number }} and open a draft PR.
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Note the prompt references the comment **by id** and lets the agent fetch it with `gh` — the comment body is attacker-influenced text and must not be interpolated into the workflow via `${{ }}` (see [trust boundaries](token-permissions.md)).

For exact commit attribution (avatar, verified link to the App), git needs the bot user's numeric id in the email: `<id>+my-outfitter-agent[bot]@users.noreply.github.com`, where the id comes from `gh api '/users/my-outfitter-agent[bot]' --jq .id`. The plain form above works; commits just won't link to the App's avatar.

### Scoping tokens per job

`actions/create-github-app-token` can narrow below the App's ceiling per run — useful when one App serves several workflows:

```yaml
- uses: actions/create-github-app-token@v2
  with:
    app-id: ${{ vars.OUTFITTER_APP_ID }}
    private-key: ${{ secrets.OUTFITTER_APP_PRIVATE_KEY }}
    permission-contents: read
    permission-issues: write # this job only answers on the thread
```

## Guardrails

- **Gate on `author_association`** as above — `issue_comment` fires for *any* commenter, including drive-by accounts on public repos. Without the check, anyone who can comment can invoke your agent (and spend your tokens). `COLLABORATOR` covers outside collaborators; drop it if you want members only.
- **Recursion guard** — the agent's own comments contain its name in context. The `author_association` check plus `types: [created]` mostly covers it, but if the App's comments could re-match, add `github.event.comment.user.type != 'Bot'` to the `if:`.
- **The comment is untrusted input.** The mention gate controls *who* can start the agent, not *what* the thread tells it to do — quoted text, pasted logs, and earlier comments can all attempt prompt injection. The App's permissions, not the prompt, are the real control; keep them minimal.
- **Acknowledge fast if runs are long** — an eyes reaction (`gh api --method POST /repos/{owner}/{repo}/issues/comments/{id}/reactions -f content=eyes`) as a first step tells the mentioner the agent heard them.
- Branch protection, CODEOWNERS, and rotation guidance from [bot-account.md](bot-account.md#guardrails-for-the-bot-account) apply unchanged — humans merge what the agent proposes.

## Gitea / Forgejo

Neither Gitea nor Forgejo implements the GitHub App concept — there are no installable apps, no `[bot]` users, no installation tokens. The same UX is built from simpler parts, and one part is actually *better*:

- **Identity**: create a regular user (`my-outfitter-agent`) and issue a **scoped access token** from it (Gitea ≥ 1.19 / Forgejo support token scopes such as `write:repository`, `write:issue`). This is the [machine-account pattern](bot-account.md), and it's the only option — but since the bot is a real user, it **can** be assigned issues and requested as a reviewer, which GitHub Apps can't.
- **Trigger**: Gitea Actions and Forgejo Actions are largely workflow-syntax-compatible and both emit `issue_comment` events, so the workflow above ports with these changes:
  - Replace the `actions/create-github-app-token` step with the bot's token from a repo/org secret: `github-token: ${{ secrets.OUTFITTER_BOT_TOKEN }}`.
  - `author_association` is not reliably populated; gate on an explicit allowlist of usernames or a team-membership API check instead.
  - The runner ships a `gh`-incompatible forge, so use a profile whose agent talks to the API via `tea` (Gitea CLI), `fj` (Forgejo CLI), or plain `curl` against the Gitea/Forgejo API — `gh` only speaks GitHub.
- **Token lifetime**: forge tokens are long-lived; there is no per-run minting. Set a calendar to rotate, exactly as with a GitHub PAT.
- **Mentions**: `@my-outfitter-agent` notifies the bot user like any mention, but as on GitHub the workflow trigger is the textual match in the `issue_comment` payload, not the notification.

Verify event support against your forge's version — Actions on Gitea/Forgejo is younger than GitHub's and event coverage has grown release by release.
