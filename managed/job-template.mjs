import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Render once under operator control, commit, then approve that exact workflow SHA. */
export function managedJob({ actionSha, gateway, inferenceUrl }) {
  if (!/^[a-f0-9]{40}$/.test(actionSha ?? "")) throw new Error("Exact action SHA required");
  if ([gateway, inferenceUrl].some((value) => typeof value !== "string" || value.includes("${{"))) throw new Error("Trusted literal HTTPS URLs required");
  const origin = new URL(gateway);
  const inference = new URL(inferenceUrl);
  for (const url of [origin, inference]) {
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href.includes("${{"))
      throw new Error("Trusted literal HTTPS URLs required");
  }
  if (origin.pathname !== "/" || inference.origin !== origin.origin) throw new Error("Inference must use gateway origin");
  return {
    name: "Outfitter managed node",
    on: { workflow_dispatch: { inputs: Object.fromEntries(["runId", "nodeId", "attemptId"].map((id) => [id, { required: true, type: "string", description: `Managed ${id}` }])) } },
    permissions: { contents: "read", "id-token": "write" },
    jobs: { node: {
      "runs-on": "ubuntu-latest", "timeout-minutes": 30,
      steps: [
        { uses: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262", with: { ref: "${{ github.sha }}", "persist-credentials": false } },
        { uses: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", with: { "node-version": "24" } },
        { uses: `ai-outfitter/actions/managed@${actionSha}`, with: {
          gateway: origin.origin, "inference-url": inference.href,
          "run-id": "${{ inputs.runId }}", "node-id": "${{ inputs.nodeId }}", "attempt-id": "${{ inputs.attemptId }}",
        } },
      ],
    } },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // JSON is also valid YAML; emitting data prevents shell/YAML interpolation of configuration.
  process.stdout.write(`${JSON.stringify(managedJob(JSON.parse(await readFile(process.argv[2], "utf8"))), null, 2)}\n`);
}
