import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { githubEvidence } from "../evidence.mjs";

test("GitHub retention binds artifact to run/attempt/actual head and redacts credentials", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "evidence-test-"));
  const env = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", ACTIONS_RUNTIME_TOKEN: "secret-runtime-token", GITHUB_STEP_SUMMARY: join(tempRoot, "summary") };
  const lease = { runId: "managed-run", nodeId: "implement", attemptId: "attempt", definitionHash: "a".repeat(64) };
  const evidence = { model: "gpt-6-luna", profileDigest: "b".repeat(64), failed: false,
    audit: [{type: "checkout", headSha: "c".repeat(40)}], transcript: [{role: "assistant", content: "secret-runtime-token eyJabc.def.ghi"}] };
  const logs = [];
  try {
    const retain = githubEvidence({ tempRoot, env, log: (value) => logs.push(value), artifact: {
      uploadArtifact: async (name, files, directory, options) => {
        assert.match(name, /^managed-evidence-[a-f0-9]{64}$/); assert.equal(options.retentionDays, 7);
        assert.equal(files.length, 3);
        const metadata = JSON.parse(await readFile(join(directory, "metadata.json"), "utf8"));
        assert.equal(metadata.runId, "123"); assert.equal(metadata.runAttempt, "2"); assert.equal(metadata.attemptId, "attempt"); assert.equal(metadata.checkoutHeadSha, "c".repeat(40));
        const transcript = await readFile(join(directory, "transcript.jsonl"), "utf8");
        assert.doesNotMatch(transcript, /secret-runtime-token|eyJabc/); assert.match(transcript, /REDACTED/);
        return {id: 7, digest: "archive-digest"};
      },
    } });
    const receipt = await retain(lease, evidence);
    assert.equal(receipt.artifactUrl, "https://github.com/owner/repo/actions/runs/123/artifacts/7");
    assert.equal(JSON.parse(logs[0]).evidence.artifactId, 7);
    assert.match(await readFile(env.GITHUB_STEP_SUMMARY, "utf8"), /archive-digest/);
    assert.deepEqual(await readdir(tempRoot), ["summary"]);
    await assert.rejects(retain(lease, {...evidence, transcript: []}), /Missing execution transcript/);
    const failing = githubEvidence({tempRoot, env, artifact: {uploadArtifact: async () => {throw new Error("upload unavailable");}}});
    await assert.rejects(failing(lease, evidence), /upload unavailable/);
    assert.deepEqual(await readdir(tempRoot), ["summary"]);
  } finally { await rm(tempRoot, {recursive:true,force:true}); }
});
