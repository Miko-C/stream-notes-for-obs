import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-notes-test-"));
const port = await findFreePort();
const origin = `http://127.0.0.1:${port}`;
let stderr = "";

const child = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
    STREAM_NOTES_DATA_DIR: dataDir
  },
  stdio: ["ignore", "ignore", "pipe"]
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForServer(`${origin}/api/state`);

  const pageResponse = await fetch(`${origin}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /<title>配信ノート<\/title>/);

  assert.equal((await fetch(`${origin}/server.js`)).status, 404);
  assert.equal((await fetch(`${origin}/data/state.json`)).status, 404);

  const rejectedResponse = await fetch(`${origin}/api/state`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Origin": "https://example.com"
    },
    body: "{}"
  });
  assert.equal(rejectedResponse.status, 403);

  const savedState = { version: 2, documents: [], updatedAt: 1 };
  const saveResponse = await fetch(`${origin}/api/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin
    },
    body: JSON.stringify(savedState)
  });
  assert.equal(saveResponse.status, 200);
  assert.deepEqual(await (await fetch(`${origin}/api/state`)).json(), savedState);

  const shutdownResponse = await fetch(`${origin}/api/shutdown`, { method: "POST" });
  assert.equal(shutdownResponse.status, 200);
  await waitForExit(child);
  console.log("server ok");
} finally {
  if (!child.killed && child.exitCode === null) child.kill();
  await fs.rm(dataDir, { recursive: true, force: true });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const selectedPort = probe.address().port;
      probe.close(() => resolve(selectedPort));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early. ${stderr}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process may still be binding the local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become ready. ${stderr}`);
}

function waitForExit(processHandle) {
  if (processHandle.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not stop.")), 5_000);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
