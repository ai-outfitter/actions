import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { runManagedNode } from "./runner.mjs";
import { piHarness } from "./pi.mjs";

let stateDirectory;
try {
  const root = await realpath(process.env.OUTFITTER_ADAPTER_ROOT ?? "");
  const sha = process.env.OUTFITTER_ADAPTER_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Pinned adapter revision required");
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  if (head !== sha || dirty) throw new Error("Adapter checkout is not the pinned clean revision");
  const modulePath = join(root, "catalog/workflows/issue-to-triage-resident/actions/client.mjs");
  const { workflowClient, actionsIdentity, gatewayOrigin } = await import(pathToFileURL(modulePath));
  const gateway = gatewayOrigin(process.env.OUTFITTER_GATEWAY);
  const inferenceURL = new URL(process.env.OUTFITTER_INFERENCE_URL);
  if (inferenceURL.protocol !== "https:" || inferenceURL.origin !== new URL(gateway).origin ||
    inferenceURL.username || inferenceURL.password || inferenceURL.search || inferenceURL.hash)
    throw new Error("Inference must use the configured trusted gateway origin");
  const tempRoot = await realpath(process.env.RUNNER_TEMP ?? "");
  stateDirectory = await mkdtemp(join(tempRoot, "outfitter-managed-"));
  const expected = { runId: process.env.OUTFITTER_RUN_ID, nodeId: process.env.OUTFITTER_NODE_ID, attemptId: process.env.OUTFITTER_ATTEMPT_ID };
  await runManagedNode({ client: workflowClient({ gateway }), expected, harness: piHarness, checkout: process.env.GITHUB_WORKSPACE,
    inference: { url: inferenceURL.href.replace(/\/$/, ""), identity: actionsIdentity, stateDirectory } });
  process.stdout.write("Managed node completed.\n");
} catch {
  process.stderr.write("Managed node failed; no successful completion is asserted.\n");
  process.exitCode = 1;
} finally {
  if (stateDirectory) await rm(resolve(stateDirectory), { recursive: true, force: true });
}
