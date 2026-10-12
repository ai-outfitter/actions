import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceExecutor } from "../workspace.mjs";
test("approved workspace operations reject traversal/symlinks/expiry and omit provider credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "managed-outside-"));
  let now = 1000;
  try {
    await writeFile(join(outside, "secret"), "outside");
    await symlink(outside, join(root, "escape"));
    await symlink(join(outside, "secret"), join(root, "alias"));
    execFileSync("mkfifo", [join(root, "pipe")]);
    const execute = await workspaceExecutor(root, { expiresAt: 60000 }, () => now);
    await assert.rejects(execute("read", { path: "pipe" }), /Invalid workspace file/);
    await execute("write", { path: "code.txt", content: "real change" });
    assert.deepEqual(await execute("read", { path: "code.txt" }), { content: "real change" });
    for (const path of ["../secret", join(outside, "secret"), "escape/secret", "alias"])
      await assert.rejects(execute("read", { path }));
    assert.deepEqual(await execute("test", { command: "test -f code.txt" }), { exitCode: 0, stdout: "", stderr: "" });
    process.env.MANAGED_TEST_PROVIDER_SECRET = "hidden";
    const result = await execute("shell", { command: 'printf "%s" "${MANAGED_TEST_PROVIDER_SECRET-unset}"' });
    delete process.env.MANAGED_TEST_PROVIDER_SECRET;
    assert.equal(result.stdout, "unset");
    now = 60001;
    await assert.rejects(execute("write", { path: "code.txt", content: "late" }), /Expired/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
