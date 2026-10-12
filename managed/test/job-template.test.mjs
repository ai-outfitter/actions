import assert from "node:assert/strict";
import test from "node:test";
import { managedJob } from "../job-template.mjs";
const config = { actionSha: "a".repeat(40), gateway: "https://gateway.example", inferenceUrl: "https://gateway.example/v1" };
test("job permits only managed dispatch IDs and cannot persist a repository write credential", () => {
  const job = managedJob(config);
  assert.deepEqual(Object.keys(job.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(job.on.workflow_dispatch.inputs), ["runId", "nodeId", "attemptId"]);
  assert.deepEqual(job.permissions, { contents: "read", "id-token": "write" });
  assert.equal(job.jobs.node.steps[0].with["persist-credentials"], false);
  assert.equal(job.jobs.node.steps.at(-1).uses, `ai-outfitter/actions/managed@${config.actionSha}`);
  assert.doesNotMatch(JSON.stringify(job), /adapter|secrets\.|\.agents/);
});
test("rejects mutable action revisions and configuration expression injection", () => {
  for (const changes of [{ actionSha: "main" }, { gateway: "http://gateway.example" },
    { gateway: "https://gateway.example/base" }, { inferenceUrl: "https://other.example/v1" },
    { inferenceUrl: "https://gateway.example/${{ secrets.TOKEN }}" }, { gateway: "https://user:pass@gateway.example" }])
    assert.throws(() => managedJob({ ...config, ...changes }));
});
