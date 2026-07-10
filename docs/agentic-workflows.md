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

## Add this design skill to a platform profile

Register this repository as a catalog source alongside your own profiles:

```yaml
# ~/.outfitter/settings.yml
default_profile: platform
default_agent: pi
profile_sources:
  - github: ai-outfitter/actions
    ref: v1
    path: .outfitter
  - path: ./profiles
```

Select the published skill by its folder-derived ID. The platform profile does
not need to inherit a profile from this repository:

```yaml
# ~/.outfitter/profiles/platform/profile.yml
id: platform
label: Platform

controls:
  skills:
    - outfitter-actions
```

After `outfitter sync`, use the platform profile to set up or review agentic
workflows in a repository.

## Keep GitHub Actions thin

GitHub Actions should provide:

- `on:` events
- checkout and authentication
- least-privilege `permissions:`
- one `ai-outfitter/actions` invocation
- trusted trigger metadata

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
        workflow: ${{ github.workflow }}
        run_id: ${{ github.run_id }}
        event_name: ${{ github.event_name }}
        event_action: ${{ github.event.action || '' }}
        schedule: ${{ github.event.schedule || '' }}
        ref_name: ${{ github.ref_name }}
        sha: ${{ github.sha }}
        issue_number: ${{ github.event.issue.number || '' }}
        issue_labels: ${{ toJSON(github.event.issue.labels.*.name) }}
        assignee: ${{ github.event.assignee.login || '' }}
        deployment_status: ${{ github.event.deployment_status.state || '' }}
        environment_url: ${{ github.event.deployment_status.environment_url || '' }}
```

Adapt the fields to the events declared by the workflow. Add a trusted hint such
as `report_kind: weekly-kpi` when event metadata alone cannot distinguish two
scheduled behaviors.

## Route in the system prompt

Keep activation rules short and deterministic. Detailed mechanics belong in
the skills they activate.

```text
Use trigger_context to select only the skill needed for this run.
- issues/opened with fix, feat, or idea labels: use issue-planning.
- issues/assigned to the platform account: use issue-implementation.
- schedule with report_kind weekly-kpi: use kpi-reporting.
- deployment_status success: use deployment-review.
- deployment_status failure: use failed-deployment-triage.
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

Pass stable identifiers instead. After routing, let the selected skill retrieve
only what it needs with trusted tools such as `gh`. Untrusted content remains
data and cannot choose the agent's workflow or override profile policy.

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

On a successful release or deployment, activate a smoke-test or persona-review
skill against the live, staging, or preview URL. On failure, activate a
failed-deployment skill that gathers logs and either investigates directly or
opens a well-scoped issue.

These situations require different skills, but they do not inherently require
different identities, profiles, or copies of the same GitHub Actions job.
