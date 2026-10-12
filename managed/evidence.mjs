import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";

/** Run-owned evidence retention, independent of platform object storage. */
export function githubEvidence({ tempRoot, env = process.env, artifact = new DefaultArtifactClient(), log = console.log }) {
  const repository = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  const runAttempt = env.GITHUB_RUN_ATTEMPT;
  if (env.GITHUB_SERVER_URL !== "https://github.com" || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^\d+$/.test(runId ?? "") || !/^\d+$/.test(runAttempt ?? "")) throw new Error("GitHub run identity required for evidence retention");
  const secrets = Object.entries(env).filter(([key, value]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key) && value?.length >= 6).map(([, value]) => value);
  const encode = (value) => {
    let text = JSON.stringify(value);
    for (const secret of secrets) text = text.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
    return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
      .replace(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED_KEY]");
  };
  return async (lease, evidence) => {
    if (!Array.isArray(evidence.transcript) || !evidence.transcript.length) throw new Error("Missing execution transcript");
    const name = `managed-evidence-${createHash("sha256").update(lease.attemptId).digest("hex")}`;
    const metadata = { repository, runId, runAttempt, workflowRunId: lease.runId, nodeId: lease.nodeId, attemptId: lease.attemptId,
      definitionHash: lease.definitionHash, model: evidence.model, profileDigest: evidence.profileDigest,
      checkoutHeadSha: evidence.audit.findLast((entry) => entry.type === "checkout")?.headSha ?? null, failed: evidence.failed };
    const contents = {
      "metadata.json": encode(metadata),
      "execution-audit.jsonl": evidence.audit.map(encode).join("\n") + "\n",
      "transcript.jsonl": evidence.transcript.map(encode).join("\n") + "\n",
    };
    if (Object.values(contents).reduce((size, value) => size + Buffer.byteLength(value), 0) > 20 * 1024 * 1024) throw new Error("Execution evidence exceeds retention limit");
    const directory = await mkdtemp(join(tempRoot, "outfitter-evidence-"));
    try {
      const files = [];
      for (const [filename, content] of Object.entries(contents)) {
        const path = join(directory, filename); await writeFile(path, content, { mode: 0o600, flag: "wx" }); files.push(path);
      }
      const uploaded = await artifact.uploadArtifact(name, files, directory, { retentionDays: 7 });
      if (!Number.isSafeInteger(uploaded.id) || uploaded.id <= 0) throw new Error("Missing GitHub artifact receipt");
      const receipt = { ...metadata, artifactId: uploaded.id, artifactName: name,
        artifactUrl: `https://github.com/${repository}/actions/runs/${runId}/artifacts/${uploaded.id}`,
        digest: uploaded.digest ?? null };
      log(JSON.stringify({ evidence: receipt }));
      if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `\nManaged evidence: [artifact ${uploaded.id}](${receipt.artifactUrl})\n\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\`\n`);
      return receipt;
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
