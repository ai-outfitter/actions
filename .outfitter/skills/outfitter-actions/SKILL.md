---
name: outfitter-actions
description: Apply the ai-outfitter/actions design pattern of few profiles, many skills, structured trigger context, and progressive disclosure.
---

# Outfitter Actions

Use this skill when designing, reviewing, or extending GitHub Actions workflows
that launch agents through `ai-outfitter/actions`.

## Design pattern

The scalable pattern is:

1. Keep profiles few and stable.
2. Put task-specific behavior in skills.
3. Pass exact GitHub trigger data into the prompt as `trigger_context`.
4. Let the profile's system prompt activate the relevant skill.
5. Fetch untrusted issue, PR, deployment, or page content only after a skill is
   selected.

## Why

Profiles are identity and policy:

- shared operating rules
- project or organization conventions
- safety and prompt-injection posture
- common tools
- write boundaries

Skills are capability:

- issue planning
- implementation handoff
- KPI reports
- deployment review
- failed-deploy triage
- Slack/report summaries

GitHub Actions are trigger plumbing:

- `on:` events
- checkout
- least-privilege `permissions:`
- secrets
- a single `ai-outfitter/actions` invocation
- a compact `trigger_context` payload

## Progressive disclosure

Skills matter because they keep the active run small. The profile should carry
the shared contract and short activation rules. A selected skill should carry
the detailed workflow instructions.

Progressive disclosure is not only context management. It is also the mechanism
that lets one Outfitter profile and one reusable GitHub Actions workflow be
defined once, then route internally to many different skills and situations.
The workflow can stay generic: pass `trigger_context`, call the same profile,
and let the profile choose whether this run is issue planning, implementation,
KPI reporting, deployment review, or something added later.

Do not load every possible workflow path into the system prompt up front. A KPI
report run does not need deployment review instructions. A failed deployment
investigation does not need issue-planning rules. An issue planning run does
not need weekly report mechanics.

## Trigger context guidance

Keep the initial prompt focused on routing and stable trigger metadata. Adapt
the fields to the events declared by the workflow:

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

Add an explicit trusted hint such as `report_kind: weekly-kpi` when multiple
behaviors share the same GitHub trigger and the event metadata cannot
distinguish them.

Avoid interpolating untrusted bodies into the launch prompt:

- issue body
- PR body
- comments
- deployment logs
- fetched page content

Pass identifiers, then fetch full content with tools after the skill activates.
