import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, parseAddress, planStop } from "../lib/listeners.js";

const lsofText = `
p100
cnode
Lme
n127.0.0.1:5173
f12
p200
cControlCenter
Lme
n*:5000
p300
cnginx-arm64
Lme
n127.0.0.1:80
p301
cnginx-arm64
Lme
n127.0.0.1:80
p400
cnode
Lother
n*:3000
p500
cnode
Lme
n127.0.0.1:3999
p600
cpython3
Lme
n[::1]:8765
p700
cCursor
Lme
n127.0.0.1:52485
p800
ccom.docker
Lme
n*:5432
n*:6379
`.trim();

const psText = `
100 50 me node /Users/me/Projects/app/node_modules/vite/bin/vite.js
50 1 me npm run dev
200 1 me /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter
300 10 me nginx: worker process
301 10 me nginx: worker process
10 1 root nginx: master process /Applications/Herd.app/Contents/Resources/nginx-arm64
400 1 other node server.js
500 1 me node /Users/me/Projects/port-desk/server.js
600 1 me /usr/local/bin/python3 -m http.server 8765
700 1 me Cursor Helper (Plugin): extension-host
800 1 me /Applications/Docker.app/Contents/MacOS/com.docker.backend services
`.trim();

const cwdText = `
p100
ncwd-not-a-path
n/Users/me/Projects/app
p500
n/Users/me/Projects/port-desk
p600
n/Users/me/Projects/demo
p800
n/Users/me/Library/Containers/com.docker.docker/Data
`.trim();

function snapshot() {
  return buildSnapshot({ lsofText, psText, cwdText, selfPid: 500, user: "me" });
}

test("parses an ipv6 listen address", () => {
  assert.deepEqual(parseAddress("[::1]:8765"), { host: "::1", port: 8765 });
});

test("lets you stop your own project server and refuses system, root-managed, foreign, and itself", () => {
  const listeners = snapshot();
  const byTitle = Object.fromEntries(listeners.map((entry) => [entry.title, entry]));

  assert.equal(byTitle.app.canStop, true);
  assert.deepEqual(byTitle.app.ports, [5173]);
  assert.equal(byTitle.app.path, "/Users/me/Projects/app");
  assert.equal(byTitle.app.where, "This Mac only");

  assert.equal(byTitle.demo.canStop, true);
  assert.equal(byTitle.demo.where, "This Mac only");

  assert.equal(byTitle.Docker.title, "Docker");
  assert.deepEqual(byTitle.Docker.ports, [5432, 6379]);
  assert.equal(byTitle.Docker.path, null);
  assert.equal(byTitle.Docker.canStop, true);

  assert.match(byTitle.ControlCenter.blockedReason, /macOS uses this/);
  assert.equal(byTitle.Herd.title, "Herd");
  assert.match(byTitle.Herd.blockedReason, /root service/);
  assert.deepEqual(byTitle.Herd.pids, [300, 301]);
  assert.match(byTitle.node.blockedReason, /Another account/);
  assert.match(byTitle["port-desk"].blockedReason, /Port desk/);
  assert.match(byTitle.Cursor.blockedReason, /Cursor/);
});

test("puts stoppable servers before protected ones", () => {
  const listeners = snapshot();
  const firstProtected = listeners.findIndex((entry) => !entry.canStop);
  assert.ok(listeners.slice(0, firstProtected).every((entry) => entry.canStop));
  assert.ok(listeners.slice(firstProtected).every((entry) => !entry.canStop));
});

test("protects the Port desk that runs from inside the app bundle", () => {
  const listeners = buildSnapshot({
    lsofText: ["p900", "cnode", "Lme", "n127.0.0.1:4001"].join("\n"),
    psText: "900 1 me /Users/me/Applications/Port desk.app/Contents/Resources/node /Users/me/Applications/Port desk.app/Contents/Resources/server/server.js",
    selfPid: 1,
    user: "me",
  });
  assert.equal(listeners[0].canStop, false);
  assert.match(listeners[0].blockedReason, /This is Port desk/);
});

test("refuses a stop that the snapshot does not allow", () => {
  const listeners = snapshot();
  assert.deepEqual(planStop(listeners, { pids: [100] }).pids, [100]);
  assert.match(planStop(listeners, { pids: [200] }).error, /macOS/);
  assert.match(planStop(listeners, { pids: [999] }).error, /not listening/);
  assert.match(planStop(listeners, { pids: [300] }).error, /not listening/);
});
