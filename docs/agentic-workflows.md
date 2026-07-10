# Designing agentic workflows

Use `ai-outfitter/actions` as thin GitHub trigger plumbing around a stable
Outfitter profile. Let the profile define identity and policy, and let focused
skills provide progressively disclosed task behavior.

## Few profiles, many skills

Profiles should remain few and stable. They define:

- shared operating rules and repository conventions
- safety and prompt-injection posture
- common tools and environment
- model and reasoning controls
- write boundaries
- concise skill-activation rules

Skills should be numerous and focused. They define capabilities such as:

- issue planning and implementation handoff
- KPI and activity reporting
- deployment or preview review
- failed-deployment investigation
- release preparation
- optional Slack or report summaries

Adding a new agentic situation should usually add a skill and one activation
rule. Do not create another profile when the identity, permissions, tools, and
policy have not changed.

Within that rule, err on the side of fewer, larger skills that route
internally to different references. One deployment skill can route success and
failure paths to separate runbooks; one incident skill can route several
failure modes. Point those references at existing human-facing documentation
instead of writing agent-only copies, and split a skill only when its
description can no longer say when it applies. A profile can also
[append its own references](https://github.com/ai-outfitter/outfitter/blob/main/docs/documentation/skills.md#profile-added-references)
to a skill it selects, so specializing a shared skill for one repository does
not require forking it.

This repository publishes these rules as the standalone `outfitter-actions`
skill; the [README](../README.md#workflow-design-skill) shows how to add the
catalog source and select the skill from your own profile. The example
workflows live in the skill's
[`assets/`](../.outfitter/skills/outfitter-actions/assets/) folder — loaded
automatically with the skill, adapted when scaffolding, and the same
templates the README links for humans.

## Keep GitHub Actions thin

GitHub Actions should provide:

- `on:` events
- checkout and authentication
- least-privilege `permissions:`
- one `ai-outfitter/actions` invocation
- workflow-owned trigger metadata

The initial prompt should contain a small routing contract and exact event
context, not every possible task procedure:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    profile: platform
    profile-source: my-org/outfitter-catalog
    profile-source-ref: v1.2.0
    prompt: |
      Handle this GitHub event using the profile's system-prompt rules.
      Treat trigger_context as routing metadata, select only the relevant
      skill, then fetch the source material that skill needs with trusted tools.

      trigger_context:
        repository: ${{ github.repository }}
        event_name: ${{ github.event_name }}
        event_action: ${{ github.event.action || '' }}
        issue_number: ${{ github.event.issue.number || '' }}
        issue_labels: ${{ toJSON(github.event.issue.labels.*.name) }}
        assignee: ${{ github.event.assignee.login || '' }}
        deployment_status: ${{ github.event.deployment_status.state || '' }}
        environment_url: ${{ github.event.deployment_status.environment_url || '' }}
```

Include a field only when a routing rule or the selected skill reads it; adapt
the set to the events declared by the workflow. Add a workflow-owned hint such as
`report_kind: weekly-kpi` when event metadata alone cannot distinguish two
scheduled behaviors.

## Route in the system prompt

Keep activation rules short and deterministic. Detailed mechanics belong in
the skills they activate.

```text
Use trigger_context to select only the skill needed for this run.
- issues/opened with fix, feat, or idea labels: use issue-planning.
- issues/assigned to the platform account: use issue-implementation.
- schedule with report_kind weekly-kpi: use kpi-reporting.
- deployment_status success or failure: use deployment-review.
Fetch full event content only after selecting the skill.
```

Progressive disclosure is both a context-management strategy and an
architecture strategy. One profile and one reusable workflow can serve many
situations because each run loads only the relevant skill.

## Keep untrusted sources out of the initial prompt

Do not interpolate these values into the launch prompt:

- issue or pull request bodies
- comments
- commit messages or diffs
- deployment logs
- fetched page content
- repository-provided skill references

Pass stable identifiers instead. Even inside `trigger_context`, values such as
labels, logins, and branch names are user-influenced — route on them as opaque
identifiers, never as instructions. After routing, let the selected skill
retrieve only what it needs with trusted tools such as `gh`. Untrusted content
remains data and cannot choose the agent's workflow or override profile
policy.

## Common extensions

### Issue planning and implementation

On issue creation, activate an issue-planning skill for `fix`, `feat`, or `idea`
labels. Let it investigate, propose a plan in a comment, and assign the platform
account when implementation is ready. An assignment event can then activate an
implementation skill using the same profile and workflow.

### Weekly KPI report

On a schedule, activate a KPI-reporting skill. It can collect repository
traffic, stars, forks, issues, pull requests, and commit activity; write a dated
report under `docs/reports/`; commit it; and optionally post a concise summary
to Slack when that integration is configured.

### Deployment review

On any deployment event, activate one deployment-review skill that routes on
`deployment_status`: success routes to a smoke-test or persona-review
reference against the live, staging, or preview URL; failure routes to a
triage reference that gathers logs and either investigates directly or opens a
well-scoped issue. One skill, two references — not two skills.

These situations require different skills or references, but they do not
inherently require different identities, profiles, or copies of the same
GitHub Actions job.
