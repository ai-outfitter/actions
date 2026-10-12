import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
const execute = promisify(execFile);
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

/** Internal trusted adapter only; never register this function as an agent tool. */
export async function synchronizeCheckout({ receipt, repository, repositoryId, token, checkout, tempRoot, expiresAt, now = Date.now, run = execute, request = fetch }) {
  if (!receipt || receipt.repository !== repository || receipt.repositoryId !== repositoryId ||
      !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
      !/^[1-9][0-9]*$/.test(repositoryId ?? "") || !sha(receipt.headSha) || !sha(receipt.parentSha) ||
      !/^outfitter\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(receipt.branch ?? "") ||
      receipt.branch.includes("..") || receipt.branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock")) ||
      typeof token !== "string" || !token || !Number.isSafeInteger(expiresAt) || expiresAt <= now())
    throw new Error("Invalid approved checkout receipt");
  const root = await realpath(checkout);
  const gitDirectory = join(root, ".git");
  if (!(await lstat(gitDirectory)).isDirectory()) throw new Error("Expected an isolated checkout Git directory");
  const temporary = await mkdtemp(join(await realpath(tempRoot), "outfitter-checkout-"));
  const env = { PATH: process.env.PATH, LANG: "C", HOME: temporary, XDG_CONFIG_HOME: temporary,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  async function git(args, cwd, network = false) {
    const remaining = expiresAt - now();
    if (remaining <= 0) throw new Error("Expired checkout lease");
    const networkEnv = network ? { GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      GIT_CONFIG_KEY_1: "http.followRedirects", GIT_CONFIG_VALUE_1: "false", GIT_CONFIG_KEY_2: "credential.helper", GIT_CONFIG_VALUE_2: "" } : {};
    const taskRoot = cwd === root ? ["--git-dir", gitDirectory, "--work-tree", root] : [];
    const result = await run("git", [...taskRoot, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
      { cwd, env: { ...env, ...networkEnv }, timeout: Math.min(30000, remaining), maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  }
  try {
    const remaining = expiresAt - now();
    if (remaining <= 0) throw new Error("Expired checkout lease");
    const response = await request(`https://api.github.com/repos/${repository}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      redirect: "error", signal: AbortSignal.timeout(Math.min(15000, remaining)),
    });
    if (!response.ok) throw new Error("Repository identity unavailable");
    const body = await response.text();
    if (body.length > 128 * 1024) throw new Error("Repository metadata exceeds limit");
    const metadata = JSON.parse(body);
    if (String(metadata.id) !== repositoryId || typeof metadata.full_name !== "string" || metadata.full_name.toLowerCase() !== repository.toLowerCase())
      throw new Error("Repository identity changed");
    await git(["init", "--quiet"], temporary);
    const remote = `https://github.com/${repository}.git`;
    await git(["fetch", "--no-tags", "--depth=2", remote, receipt.headSha], temporary, true);
    if (await git(["rev-parse", "FETCH_HEAD"], temporary) !== receipt.headSha) throw new Error("Fetched head mismatch");
    const ancestry = (await git(["rev-list", "--parents", "-n", "1", receipt.headSha], temporary)).split(" ");
    if (ancestry.length !== 2 || ancestry[1] !== receipt.parentSha) throw new Error("Commit ancestry mismatch");
    const branch = await git(["ls-remote", "--refs", remote, `refs/heads/${receipt.branch}`], temporary, true);
    if (branch !== `${receipt.headSha}\trefs/heads/${receipt.branch}`) throw new Error("Remote branch changed");
    // No credential enters commands that can read the agent-modified checkout configuration.
    await git(["-c", "protocol.file.allow=always", "fetch", "--no-tags", temporary, receipt.headSha], root);
    await git(["checkout", "--detach", "--force", receipt.headSha], root);
    const actual = await git(["rev-parse", "HEAD"], root);
    if (actual !== receipt.headSha || await git(["status", "--porcelain", "--untracked-files=all"], root)) throw new Error("Checkout does not match approved commit");
    return { headSha: actual, parentSha: receipt.parentSha, branch: receipt.branch };
  } catch {
    // Git stderr and environment can contain credentials; never forward either.
    throw new Error("Approved checkout synchronization failed");
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
