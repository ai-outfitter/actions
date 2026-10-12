# Managed workflow nodes

Use this separate `ai-outfitter/actions/managed` action for server-approved nodes.
The existing root action remains the optional catalog-based runner. The managed
path never resolves a label, `.agents`, local settings, extension or catalog.

The trusted job pins this public action to an exact commit SHA. Its bundled
OIDC client needs no private webapp checkout or repository secret. Inputs identify the approved gateway/inference URL and dispatched
run/node/attempt; `id-token: write` supplies GitHub OIDC. No provider key or model
choice is passed to the agent. The returned lease must contain an owner-approved
profile `{id,digest,systemPrompt}`, model and capability descriptors. Profile digest
is SHA256 of the UTF8 prompt; the binding enforces the workflow's gpt-6-luna minimum
and available stronger/custom models. Missing context or transport fails closed.

Capabilities default to broker execution through the authenticated lease. An
explicit `execution: workspace` and `operation: read|write|shell|test` enables a
fixed local adapter rooted at the trusted `GITHUB_WORKSPACE`. File operations
reject traversal, symlinks and hard links. Shell/test commands run in the disposable
job sandbox with a small environment allowlist and bounded time/output. **The job
sandbox is their isolation boundary: a working directory is not a filesystem or
network jail.** Use ephemeral isolated runners, never a privileged shared host.
Capability argument/result byte counts and SHA256 digests (not raw contents) are
uploaded as lease-scoped audit evidence before successful completion; each node
is limited to 1000 capability calls. Artifact upload failure prevents completion.

The Pi SDK uses an in-memory model/auth/settings registry, no built-in tools and
no resource discovery. Only approved capabilities and a typed `submit_outputs`
tool are exposed. Failed execution, missing/invalid output or expiry cannot assert
completion. The harness currently caps its context at 32768 and output at 4096
text tokens; these are conservative runner limits, not upstream model specs.

Integration remains incomplete until approved lease context, scoped tools and
artifact endpoints, dispatch and resident transports are deployed and validated. Neither
mocked provider tests nor the real Pi SDK loop against a local fake inference
server proves live issue-to-merge operation. The bundled client was promoted unchanged from the reviewed workflow adapter
at webapp commit `0ca5494d95c559e9e13d1d8b0c7e975f81ef0844`; the old webapp CLI
remains a compatibility reference, not a runtime dependency.

Run `npm ci --prefix managed --ignore-scripts` and `npm test --prefix managed`.

## Thin repository entrypoint

Generate `.github/workflows/outfitter-managed-node.yml` from a trusted JSON file:

```json
{"actionSha":"<reviewed 40-character actions commit>","gateway":"https://<approved-gateway>","inferenceUrl":"https://<approved-gateway>/v1"}
```

```sh
mkdir -p /path/to/target-repository/.github/workflows
node managed/job-template.mjs operator-config.json > /path/to/target-repository/.github/workflows/outfitter-managed-node.yml
```

The generated JSON is valid YAML. Commit it to the target repository, then have
an organization owner approve its immutable repository/workflow/ref/SHA dispatch
allowlist and executor binding. Only run, node and attempt IDs are dispatch
inputs. Node instructions, profile, model and capabilities arrive from the
approved lease; this file contains no issue chain or task-specific prompts.

The job uses a GitHub-hosted disposable runner, a read-only checkout without
persisted credentials, and OIDC. Repository mutations must use approved broker
capabilities. A branch/commit capability remains a prerequisite for implementation;
this template does not silently grant shell access to a write token. The source
checkout is the workflow run's SHA; task code from another branch must be read
through approved capabilities before making changes.

Do not install this entrypoint or disable the playground's legacy issue chain
until dispatch, resident review, scoped mutations and evidence delivery are ready.
At cutover, preserve `test.yml` and repository protections and activate only one
issue chain. Keep this action and its dependencies draft until the real workflow
has been demonstrated; a generated entrypoint is not live execution evidence.
