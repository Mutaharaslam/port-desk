import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";

const SERVER_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");

const LISTENERS = [
  {
    ports: [5173],
    where: "This Mac only",
    title: "app",
    command: "node",
    commandLine: "node vite.js",
    path: "/Users/me/app",
    pids: [100],
    canStop: true,
    blockedReason: null,
    shared: false,
  },
];

async function start(t) {
  const kills = [];
  const server = createServer({
    snapshot: async () => LISTENERS,
    kill: (pid, signal) => kills.push([pid, signal]),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { server, kills, port: server.address().port };
}

function request(port, { method = "GET", path: urlPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function pageToken(port) {
  const page = await request(port);
  const match = page.text.match(/name="port-desk-token" content="([0-9a-f]{64})"/);
  assert.ok(match, "the page should carry a 64 character hex token");
  return match[1];
}

const JSON_HEADERS = (token) => ({ "Content-Type": "application/json", "X-Port-Desk-Token": token });
const stopBody = JSON.stringify({ pids: [100], signal: "SIGTERM" });

test("the page embeds a random token and no placeholder", async (t) => {
  const { port } = await start(t);
  const page = await request(port);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes("__PORT_DESK_TOKEN__"));
  assert.match(page.text, /name="port-desk-token" content="[0-9a-f]{64}"/);
});

test("each server instance gets its own token", async (t) => {
  const first = await start(t);
  const second = await start(t);
  assert.notEqual(await pageToken(first.port), await pageToken(second.port));
});

test("the API refuses a request without the token or with a wrong one", async (t) => {
  const { port } = await start(t);
  assert.equal((await request(port, { path: "/api/listeners" })).status, 403);
  const wrong = await request(port, { path: "/api/listeners", headers: { "X-Port-Desk-Token": "0".repeat(64) } });
  assert.equal(wrong.status, 403);
});

test("the API serves listeners when the token matches", async (t) => {
  const { port } = await start(t);
  const token = await pageToken(port);
  const response = await request(port, { path: "/api/listeners", headers: { "X-Port-Desk-Token": token } });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text).listeners, LISTENERS);
});

test("a request with a foreign Host header is refused even with a valid token", async (t) => {
  const { port } = await start(t);
  const token = await pageToken(port);
  const api = await request(port, { path: "/api/listeners", headers: { Host: "evil.example", "X-Port-Desk-Token": token } });
  assert.equal(api.status, 403);
  const page = await request(port, { headers: { Host: "evil.example" } });
  assert.equal(page.status, 403);
  assert.ok(!/[0-9a-f]{64}/.test(page.text), "a refused page must not leak the token");
});

test("a stop request without the token never reaches kill", async (t) => {
  const { port, kills } = await start(t);
  const response = await request(port, {
    method: "POST",
    path: "/api/stop",
    headers: { "Content-Type": "application/json" },
    body: stopBody,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(kills, []);
});

test("a stop request that is not JSON is refused before it reads the body", async (t) => {
  const { port, kills } = await start(t);
  const token = await pageToken(port);
  const response = await request(port, {
    method: "POST",
    path: "/api/stop",
    headers: { "Content-Type": "text/plain", "X-Port-Desk-Token": token },
    body: stopBody,
  });
  assert.equal(response.status, 415);
  assert.deepEqual(kills, []);
});

test("a valid stop request signals the listed process", async (t) => {
  const { port, kills } = await start(t);
  const token = await pageToken(port);
  const response = await request(port, { method: "POST", path: "/api/stop", headers: JSON_HEADERS(token), body: stopBody });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { stopped: [100], failed: [] });
  assert.deepEqual(kills, [[100, "SIGTERM"]]);
});

function runServer(env) {
  const child = spawn(process.execPath, [SERVER_JS], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  const firstLine = new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
      const end = text.indexOf("\n");
      if (end !== -1) resolve(text.slice(0, end));
    });
    child.once("error", reject);
    child.once("exit", () => reject(new Error("the server exited before it printed its address")));
  });
  return { child, firstLine };
}

test("prints its address and exits when stdin closes if asked to", async (t) => {
  const { child, firstLine } = runServer({ PORT_DESK_EXIT_ON_STDIN_CLOSE: "1" });
  t.after(() => child.kill());
  assert.match(await firstLine, /^Port desk is running at http:\/\/127\.0\.0\.1:\d+$/);
  child.stdin.end();
  const [code] = await once(child, "exit", { signal: AbortSignal.timeout(5000) });
  assert.equal(code, 0);
});

test("keeps running when stdin closes if not asked to", async (t) => {
  const { child, firstLine } = runServer({});
  t.after(() => child.kill());
  await firstLine;
  child.stdin.end();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(child.exitCode, null);
});
