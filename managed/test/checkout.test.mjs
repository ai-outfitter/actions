import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synchronizeCheckout } from "../checkout.mjs";
const execute = promisify(execFile);
async function fixture(run) {
  const temporary = await mkdtemp(join(tmpdir(), "managed-sync-test-"));
  const remote = join(temporary, "remote"), checkout = join(temporary, "task");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git(temporary, "init", "--quiet", remote);
    await writeFile(join(remote, "file.txt"), "before"); git(remote, "add", ".");
    const commit = () => git(remote, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-am", "change");
    commit(); const parentSha = git(remote, "rev-parse", "HEAD");
    git(temporary, "clone", "--quiet", remote, checkout);
    git(remote, "checkout", "--quiet", "-b", "outfitter/issue");
    await writeFile(join(remote, "file.txt"), "after"); commit();
    const headSha = git(remote, "rev-parse", "HEAD");
    const calls = [];
    const adapter = async (command, args, options) => {
      calls.push({ args, cwd: options.cwd, env: options.env });
      const localArgs = args.map((arg) => arg === "https://github.com/org/repo.git" ? remote : arg);
      return execute(command, localArgs, options);
    };
    await run({ temporary, remote, checkout, git, calls, options: { receipt: { repository: "org/repo", repositoryId: "42", branch: "outfitter/issue", parentSha, headSha }, repository: "org/repo", repositoryId: "42", token: "read-only-test-token", checkout, tempRoot: temporary, expiresAt: Date.now() + 60000, run: adapter, request: async (url, options) => { assert.equal(url, "https://api.github.com/repos/org/repo"); assert.equal(options.redirect, "error"); return Response.json({ id: 42, full_name: "org/repo" }); } } });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
test("trusted fetch checks branch/parent and isolates credential from task Git configuration", async () => fixture(async ({ options, checkout, git, calls }) => {
  git(checkout, "config", "core.worktree", "/never-use-repository-selected-root");
  const receipt = await synchronizeCheckout(options);
  git(checkout, "config", "--unset", "core.worktree");
  assert.equal(receipt.headSha, options.receipt.headSha);
  assert.equal(git(checkout, "rev-parse", "HEAD"), options.receipt.headSha);
  const network = calls.filter((call) => call.env.GIT_CONFIG_VALUE_0);
  assert.equal(network.length, 2);
  assert.ok(network.every((call) => call.cwd !== checkout && !JSON.stringify(call.args).includes(options.token)));
  assert.ok(calls.filter((call) => call.cwd === checkout).every((call) => !JSON.stringify(call.env).includes(options.token) && !call.env.GIT_CONFIG_VALUE_0));
}));
test("wrong identity, ancestry, changed branch and expired lease cannot synchronize", async () => fixture(async ({ options, git, remote, checkout }) => {
  const original = git(checkout, "rev-parse", "HEAD");
  for (const overrides of [{ request: async () => Response.json({ id: 99, full_name: "org/repo" }) }, { repositoryId: "99" }, { expiresAt: 0 }, { receipt: { ...options.receipt, parentSha: "f".repeat(40) } }])
    await assert.rejects(synchronizeCheckout({ ...options, ...overrides }));
  git(remote, "reset", "--hard", options.receipt.parentSha);
  await assert.rejects(synchronizeCheckout(options));
  assert.equal(git(checkout, "rev-parse", "HEAD"), original);
}));
