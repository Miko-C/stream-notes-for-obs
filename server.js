import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeInteractionState,
  sanitizeInteractionState
} from "./interaction.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.PORT || process.argv[2] || 4177);
const dataDir = process.env.STREAM_NOTES_DATA_DIR
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "StreamNotes")
    : path.join(rootDir, "data"));
const shouldMigrateLegacyState = !process.env.STREAM_NOTES_DATA_DIR;
const statePath = path.join(dataDir, "state.json");
const pidPath = path.join(dataDir, "server.pid");
const legacyStatePath = path.join(rootDir, "data", "state.json");
const interactionClients = new Set();
const interactionClientSequences = new Map();
let interactionRevision = 0;
let interactionState = sanitizeInteractionState();
let shuttingDown = false;

const publicFiles = new Set([
  "index.html",
  "app.js",
  "parser.js",
  "state.js",
  "interaction.js",
  "stage-layout.js",
  "styles.css",
  "favicon.svg"
]);
const katexPublicPrefix = "node_modules/katex/dist/";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"]
]);

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedHost(request.headers.host)) {
      sendError(response, 403, "Forbidden");
      return;
    }

    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);

    if (requestUrl.pathname === "/api/state") {
      await handleStateRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/interaction") {
      await handleInteractionRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/interaction/events") {
      handleInteractionEvents(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/shutdown") {
      handleShutdownRequest(request, response);
      return;
    }

    const filePath = resolvePublicFile(requestUrl.pathname);
    if (!filePath) {
      sendError(response, 404, "Not found");
      return;
    }

    const data = await fs.readFile(filePath);
    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    response.end(data);
  } catch (error) {
    const status = error?.code === "ENOENT" || error instanceof URIError ? 404 : 500;
    sendError(response, status, status === 404 ? "Not found" : "Internal server error");
    if (status === 500) console.error(error);
  }
});

server.listen(port, host, async () => {
  const actualPort = server.address()?.port || port;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(pidPath, String(process.pid), "ascii");
  console.log(`Stream Notes:   http://${host}:${actualPort}/`);
  console.log(`OBS source URL: http://${host}:${actualPort}/?view=overlay`);
  console.log(`Data directory: ${dataDir}`);
});

async function handleStateRequest(request, response) {
  if (request.method === "GET") {
    const data = await readSavedState();

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(data);
    return;
  }

  if (request.method === "POST") {
    if (!isTrustedMutationRequest(request)) {
      sendError(response, 403, "Forbidden");
      return;
    }
    const body = await readRequestBody(request);
    JSON.parse(body || "{}");
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, body || "{}", "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end('{"ok":true}');
    return;
  }

  response.writeHead(405, {
    "Content-Type": "application/json; charset=utf-8",
    "Allow": "GET, POST"
  });
  response.end('{"error":"Method not allowed"}');
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleInteractionRequest(request, response) {
  if (request.method === "GET") {
    sendJson(response, interactionState);
    return;
  }

  if (request.method === "POST") {
    if (!isTrustedMutationRequest(request)) {
      sendError(response, 403, "Forbidden");
      return;
    }
    const body = await readRequestBody(request);
    const patch = JSON.parse(body || "{}");
    const clientId = typeof patch.clientId === "string" ? patch.clientId.slice(0, 120) : "";
    const sequence = Number(patch.sequence || 0);

    if (clientId && Number.isSafeInteger(sequence) && sequence > 0) {
      const lastSequence = interactionClientSequences.get(clientId) || 0;
      if (sequence <= lastSequence) {
        sendJson(response, { type: "snapshot", state: interactionState });
        return;
      }
      interactionClientSequences.set(clientId, sequence);
      if (interactionClientSequences.size > 200) {
        interactionClientSequences.clear();
        interactionClientSequences.set(clientId, sequence);
      }
    }

    interactionRevision += 1;
    interactionState = mergeInteractionState(interactionState, patch, interactionRevision);
    const event = createInteractionPatchEvent(patch, clientId, sequence);
    broadcastInteractionEvent(event);
    sendJson(response, event);
    return;
  }

  response.writeHead(405, {
    "Content-Type": "application/json; charset=utf-8",
    "Allow": "GET, POST"
  });
  response.end('{"error":"Method not allowed"}');
}

function handleInteractionEvents(request, response) {
  if (request.method !== "GET") {
    response.writeHead(405, { "Allow": "GET" });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
  const patchMode = requestUrl.searchParams.get("format") === "patch";
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });
  const initialState = patchMode
    ? { type: "snapshot", state: interactionState }
    : interactionState;
  response.write(`data: ${JSON.stringify(initialState)}\n\n`);
  const client = { response, patchMode };
  interactionClients.add(client);

  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(keepAlive);
    interactionClients.delete(client);
  });
}

function createInteractionPatchEvent(patch, clientId, sequence) {
  const normalizedPatch = {};
  for (const key of ["pointer", "callout", "drawing", "scroll", "output"]) {
    if (Object.hasOwn(patch, key)) normalizedPatch[key] = interactionState[key];
  }
  return {
    type: "patch",
    patch: normalizedPatch,
    revision: interactionRevision,
    clientId,
    sequence
  };
}

function broadcastInteractionEvent(event) {
  const patchMessage = `data: ${JSON.stringify(event)}\n\n`;
  let snapshotMessage = "";
  for (const client of interactionClients) {
    if (client.patchMode) {
      client.response.write(patchMessage);
      continue;
    }
    snapshotMessage ||= `data: ${JSON.stringify(interactionState)}\n\n`;
    client.response.write(snapshotMessage);
  }
}

function sendJson(response, value) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function readSavedState() {
  try {
    return await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (shouldMigrateLegacyState && path.resolve(statePath) !== path.resolve(legacyStatePath)) {
    try {
      const legacyState = await fs.readFile(legacyStatePath, "utf8");
      JSON.parse(legacyState);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(statePath, legacyState, "utf8");
      return legacyState;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Legacy state could not be migrated.", error);
    }
  }

  return "{}";
}

function resolvePublicFile(requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const normalizedPath = relativePath.replaceAll("\\", "/");

  if (publicFiles.has(normalizedPath)) {
    return path.resolve(rootDir, normalizedPath);
  }

  if (normalizedPath.startsWith(katexPublicPrefix)) {
    const katexRoot = path.resolve(rootDir, katexPublicPrefix);
    const filePath = path.resolve(rootDir, normalizedPath);
    const relativeToKatex = path.relative(katexRoot, filePath);
    if (!relativeToKatex.startsWith("..") && !path.isAbsolute(relativeToKatex)) return filePath;
  }

  return null;
}

function isAllowedHost(value = "") {
  try {
    const hostname = new URL(`http://${value}`).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function isTrustedMutationRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const requestHost = String(request.headers.host || "").toLowerCase();
    return originUrl.protocol === "http:"
      && originUrl.host.toLowerCase() === requestHost
      && (originUrl.hostname === "127.0.0.1" || originUrl.hostname === "localhost");
  } catch {
    return false;
  }
}

function handleShutdownRequest(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { "Allow": "POST" });
    response.end();
    return;
  }
  if (!isTrustedMutationRequest(request)) {
    sendError(response, 403, "Forbidden");
    return;
  }

  sendJson(response, { ok: true });
  setTimeout(shutdown, 30);
}

function sendError(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  response.end(message);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const client of interactionClients) client.response.end();
  server.close(async () => {
    try {
      if ((await fs.readFile(pidPath, "ascii")).trim() === String(process.pid)) {
        await fs.unlink(pidPath);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") console.error(error);
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
