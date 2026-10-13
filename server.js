import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planStop, readSnapshot } from "./lib/listeners.js";

const HOST = "127.0.0.1";
const FIRST_PORT = 3999;
const LAST_PORT = 4010;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(ROOT, "public", "index.html");
const TOKEN_PLACEHOLDER = "__PORT_DESK_TOKEN__";
const SIGNALS = new Set(["SIGTERM", "SIGKILL"]);

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendError(response, status, message) {
  send(response, status, JSON.stringify({ error: message }));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 100_000) {
        reject(Object.assign(new Error("Request is too large."), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function stopProcesses(pids, signal, kill) {
  const stopped = [];
  const failed = [];
  for (const pid of pids) {
    try {
      kill(pid, signal);
      stopped.push(pid);
    } catch (error) {
      if (error.code === "ESRCH") stopped.push(pid);
      else failed.push({ pid, error: error.code === "EPERM" ? "macOS refused to stop this process." : error.message });
    }
  }
  return { stopped, failed };
}

function hasToken(request, token) {
  const given = Buffer.from(String(request.headers["x-port-desk-token"] || ""));
  const wanted = Buffer.from(token);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

function isJson(request) {
  return (request.headers["content-type"] || "").split(";")[0].trim().toLowerCase() === "application/json";
}

export function createServer({ snapshot = readSnapshot, kill = (pid, signal) => process.kill(pid, signal) } = {}) {
  const token = crypto.randomBytes(32).toString("hex");

  async function handle(request, response) {
    // Only the page we serve may talk to us: a rebound DNS name must not read the token.
    if (request.headers.host !== `${HOST}:${request.socket.localPort}`) {
      sendError(response, 403, "Not allowed.");
      return;
    }

    const url = new URL(request.url || "/", `http://${HOST}`);

    if (request.method === "GET" && url.pathname === "/") {
      const page = fs.readFileSync(INDEX, "utf8").replace(TOKEN_PLACEHOLDER, token);
      send(response, 200, page, "text/html; charset=utf-8");
      return;
    }

    if (url.pathname.startsWith("/api/") && !hasToken(request, token)) {
      sendError(response, 403, "Not allowed.");
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/listeners") {
      try {
        const listeners = await snapshot();
        send(response, 200, JSON.stringify({ user: process.env.USER || "", selfPid: process.pid, listeners }));
      } catch (error) {
        sendError(response, 500, error.message || "Could not list listening ports.");
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/stop") {
      if (!isJson(request)) {
        sendError(response, 415, "Send the stop request as JSON.");
        return;
      }
      try {
        const payload = JSON.parse(await readBody(request));
        const signal = payload.signal;
        if (!SIGNALS.has(signal)) {
          sendError(response, 400, "Choose a normal stop or a force stop.");
          return;
        }
        const listeners = await snapshot();
        const plan = planStop(listeners, { pids: payload.pids });
        if (plan.error) {
          sendError(response, 409, plan.error);
          return;
        }
        const result = await stopProcesses(plan.pids, signal, kill);
        const status = result.failed.length ? 207 : 200;
        send(response, status, JSON.stringify(result));
      } catch (error) {
        sendError(response, error.status || 400, "Could not stop that process.");
      }
      return;
    }

    sendError(response, 404, "Not found.");
  }

  return http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent) sendError(response, 500, error.message || "Something went wrong.");
    });
  });
}

function listen(port) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

async function main() {
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    try {
      await listen(port);
      console.log(`Port desk is running at http://${HOST}:${port}`);
      if (process.env.PORT_DESK_EXIT_ON_STDIN_CLOSE === "1") {
        // The menu bar app owns this pipe, so the server never outlives it.
        process.stdin.on("end", () => process.exit(0));
        process.stdin.resume();
      }
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`Ports ${FIRST_PORT}–${LAST_PORT} are all in use.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
