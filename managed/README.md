# Managed workflow nodes

Use this separate `ai-outfitter/actions/managed` action for server-approved nodes.
The existing root action remains the optional catalog-based runner. The managed
path never resolves a label, `.agents`, local settings, extension or catalog.

The trusted job pins this action and a clean webapp adapter checkout to exact
commit SHAs. Inputs identify the approved gateway/inference URL and dispatched
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

Integration remains incomplete until the gateway supplies approved lease.context,
the adapter exposes invoke, and the scoped tools endpoint is deployed. Neither
mocked provider tests nor the real Pi SDK loop against a local fake inference
server proves live issue-to-merge operation. The standalone client remains owned
by the pinned workflow package until the shared SDK transport is available.

Run `npm ci --prefix managed --ignore-scripts` and `npm test --prefix managed`.
