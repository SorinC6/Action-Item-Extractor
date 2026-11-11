import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const host = "127.0.0.1";

export async function startApp(databasePath, providerEnv) {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", host, "-p", "0"],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        ...providerEnv,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { spawnError = error; });
  const closed = new Promise((resolve) => child.once("close", resolve));

  async function stop() {
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill();
    }
    const forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000);
    try {
      await closed;
      return stdout;
    } finally {
      clearTimeout(forceStop);
    }
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !spawnError && child.exitCode === null && child.signalCode === null) {
    const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) {
      try {
        const response = await fetch(`${url}/api/notes`, { signal: AbortSignal.timeout(500) });
        await response.text();
        if (response.ok) return { url, stop };
      } catch {
        // The server may still be starting.
      }
    }
    await delay(50);
  }
  await stop();
  assert.fail(`Next.js did not start.\n${spawnError ?? ""}\n${stdout}\n${stderr}`);
}
