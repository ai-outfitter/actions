import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, dirname, basename } from "node:path";
import { execFile } from "node:child_process";
const inside = (root, path) => { const value = relative(root, path); return value !== ".." && !value.startsWith("../") && !isAbsolute(value); };
export async function workspaceExecutor(checkout, lease, now = Date.now) {
  const root = await realpath(checkout);
  return async (operation, args) => {
    const remaining = lease.expiresAt - now();
    if (!Number.isSafeInteger(lease.expiresAt) || remaining <= 0) throw new Error("Expired workspace lease");
    if (operation === "shell" || operation === "test") {
      if (typeof args.command !== "string" || !args.command || args.command.length > 10000) throw new Error("Invalid command");
      // Shell is approved execution in a disposable job sandbox, not a filesystem jail.
      const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TMPDIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      return await new Promise((resolveResult, reject) => {
        let expired = false;
        const child = execFile("/bin/bash", ["--noprofile", "--norc", "-c", args.command],
          { cwd: root, env, detached: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            clearTimeout(timer);
            // Also reap background descendants after the declared operation finishes.
            try { process.kill(-child.pid, "SIGKILL"); } catch {}
            if (expired || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return reject(new Error("Workspace command exceeded execution limit"));
            resolveResult({ exitCode: error ? typeof error.code === "number" ? error.code : 1 : 0, stdout, stderr });
          });
        const timer = setTimeout(() => { expired = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, Math.min(60000, remaining));
      });
    }
    if (!["read", "write"].includes(operation) || typeof args.path !== "string" || !args.path || isAbsolute(args.path)) throw new Error("Invalid workspace operation");
    const requested = resolve(root, args.path);
    if (!inside(root, requested)) throw new Error("Path outside approved checkout");
    const parent = await realpath(dirname(requested));
    if (!inside(root, parent)) throw new Error("Path outside approved checkout");
    const path = resolve(parent, basename(requested));
    const file = await open(path, constants.O_NOFOLLOW | constants.O_NONBLOCK | (operation === "read" ? constants.O_RDONLY : constants.O_WRONLY | constants.O_CREAT), 0o600);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error("Invalid workspace file");
      if (operation === "read") return { content: await file.readFile("utf8") };
      if (typeof args.content !== "string" || Buffer.byteLength(args.content) > 1024 * 1024) throw new Error("Invalid file content");
      await file.truncate(0); await file.writeFile(args.content);
      return { written: Buffer.byteLength(args.content) };
    } finally { await file.close(); }
  };
}
