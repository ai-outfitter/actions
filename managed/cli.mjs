import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runManagedNode } from "./runner.mjs";
import { githubEvidence } from "./evidence.mjs";
import { piHarness } from "./pi.mjs";
import { workflowClient, actionsIdentity, gatewayOrigin } from "./client.mjs";

let stateDirectory;
try {
  const gateway = gatewayOrigin(process.env.OUTFITTER_GATEWAY);
  const inferenceURL = new URL(process.env.OUTFITTER_INFERENCE_URL);
  if (inferenceURL.protocol !== "https:" || inferenceURL.origin !== new URL(gateway).origin ||
    inferenceURL.username || inferenceURL.password || inferenceURL.search || inferenceURL.hash)
    throw new Error("Inference must use the configured trusted gateway origin");
  const tempRoot = await realpath(process.env.RUNNER_TEMP ?? "");
  stateDirectory = await mkdtemp(join(tempRoot, "outfitter-managed-"));
  const expected = { runId: process.env.OUTFITTER_RUN_ID, nodeId: process.env.OUTFITTER_NODE_ID, attemptId: process.env.OUTFITTER_ATTEMPT_ID };
  await runManagedNode({ client: workflowClient({ gateway }), expected, harness: piHarness, checkout: process.env.GITHUB_WORKSPACE,
    retainEvidence: githubEvidence({ tempRoot }),
    inference: { url: inferenceURL.href.replace(/\/$/, ""), identity: actionsIdentity, stateDirectory } });
  process.stdout.write("Managed node completed.\n");
} catch {
  process.stderr.write("Managed node failed; no successful completion is asserted.\n");
  process.exitCode = 1;
} finally {
  if (stateDirectory) await rm(resolve(stateDirectory), { recursive: true, force: true });
}
