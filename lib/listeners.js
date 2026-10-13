import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SYSTEM_COMMANDS = new Set([
  "ControlCenter",
  "rapportd",
  "sharingd",
  "identityservicesd",
  "Finder",
  "Dock",
  "SystemUIServer",
  "WindowServer",
  "loginwindow",
  "UserEventAgent",
  "distnoted",
  "cfprefsd",
  "trustd",
  "runningboardd",
  "mDNSResponder",
  "symptomsd",
  "wifid",
  "airportd",
  "bluetoothd",
  "coreaudiod",
  "cloudd",
  "bird",
  "tccd",
  "sandboxd",
  "fseventsd",
  "hidd",
  "corebrightnessd",
  "WindowManager",
  "mediaremoted",
  "chronod",
  "dasd",
  "assistantd",
  "homed",
  "timed",
  "ntpd",
  "powerd",
  "configd",
  "syslogd",
  "logd",
  "securityd",
  "amfid",
  "launchd",
  "kernel_task",
  "syspolicyd",
  "notifyd",
  "locationd",
  "parsed",
  "CommCenter",
  "imagent",
  "apsd",
  "lsd",
  "pkd",
  "containermanagerd",
  "secd",
  "authd",
  "talagentd",
  "NotificationCenter",
  "Spotlight",
  "mds",
  "mds_stores",
  "corespotlightd",
  "siriactionsd",
  "siriknowledged",
  "replayd",
  "AirPlayXPCHelper",
  "UniversalControl",
  "universalaccessd",
  "knowledge-agent",
  "duetexpertd",
  "audioanalyticsd",
  "nsurlsessiond",
  "opendirectoryd",
  "diskarbitrationd",
  "endpointsecurityd",
  "watchdogd",
  "usbd",
  "thermalmonitord",
  "coreservicesd",
]);

const BLOCKED_PATH_PREFIXES = ["/System/", "/usr/libexec/", "/usr/sbin/", "/sbin/", "/Library/Apple/"];

const BLOCKED_APP_MARKERS = ["/Cursor.app/", "/Visual Studio Code.app/", "/Codex.app/"];

const MANAGED_BY_ROOT = /nginx|caddy|httpd|apache|mysqld|postgres|mariadbd|redis-server/i;

export function parseLsof(output) {
  const processes = [];
  let current = null;

  for (const line of output.split("\n")) {
    if (!line) continue;
    const kind = line[0];
    const value = line.slice(1);
    if (kind === "p") {
      current = { pid: Number(value), command: "", user: "", names: [] };
      processes.push(current);
      continue;
    }
    if (!current) continue;
    if (kind === "c") current.command = value;
    else if (kind === "L") current.user = value;
    else if (kind === "n") current.names.push(value);
  }

  return processes;
}

export function parsePs(output) {
  const processes = new Map();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    processes.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      user: match[3],
      command: match[4].trim(),
    });
  }
  return processes;
}

export function parseAddress(name) {
  const v6 = name.match(/^\[([^\]]+)\]:(\d+)$/);
  if (v6) return { host: v6[1], port: Number(v6[2]) };
  const v4 = name.match(/^(.*):(\d+)$/);
  if (v4 && v4[1] !== "") return { host: v4[1], port: Number(v4[2]) };
  return null;
}

export function projectLabel(cwd, command) {
  if (!cwd || cwd === "/" || cwd.startsWith("/private/var") || cwd.includes("/Application Support/")) {
    return command;
  }
  if (/\/(bin|sbin|libexec)$/.test(cwd)) return command;
  const base = path.basename(cwd);
  return base || command;
}

function whereLabel(hosts) {
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  const anywhere = new Set(["*", "0.0.0.0", "::"]);
  if (hosts.length && hosts.every((host) => loopback.has(host))) return "This Mac only";
  if (hosts.length && hosts.every((host) => anywhere.has(host))) return "All interfaces";
  return hosts.join(", ");
}

const PORT_DESK_SERVERS = [`${path.sep}port-desk${path.sep}server.js`, "/Port desk.app/Contents/Resources/server/server.js"];

function isPortDesk(commandLine, pid, selfPid) {
  return pid === selfPid || PORT_DESK_SERVERS.some((marker) => commandLine.includes(marker));
}

function blockedReasonFor(proc, info, parent, selfPid, user) {
  const commandLine = info?.command || proc.command;
  if (isPortDesk(commandLine, proc.pid, selfPid)) return "This is Port desk.";
  if (proc.user !== user) return "Another account owns this process.";
  if (/Cursor Helper|\/Cursor\.app\//.test(commandLine) || proc.command.startsWith("Cursor")) {
    return "This belongs to Cursor. Quit Cursor if you need the port.";
  }
  if (BLOCKED_APP_MARKERS.some((marker) => commandLine.includes(marker))) {
    return "This belongs to an open app. Quit that app if you need the port.";
  }
  if (SYSTEM_COMMANDS.has(proc.command) || BLOCKED_PATH_PREFIXES.some((prefix) => commandLine.startsWith(prefix))) {
    return "macOS uses this. Stopping it can break system features.";
  }
  if (parent && parent.user === "root" && MANAGED_BY_ROOT.test(parent.command)) {
    return "A root service manages this and will start it again. Quit that app, for example Herd, to free the port.";
  }
  return null;
}

function titleFor(row) {
  const line = `${row.command} ${row.commandLine || ""} ${row.parentCommand || ""}`;
  if (/Herd\.app/.test(row.parentCommand || "")) return "Herd";
  if (/Cursor Helper|\/Cursor\.app\//.test(line) || row.command.startsWith("Cursor")) return "Cursor";
  if (/Code Helper|Visual Studio Code\.app/.test(line)) return "VS Code";
  if (/docker/i.test(line) || /com\.docker\.docker/.test(row.cwd || "")) return "Docker";
  return projectLabel(row.cwd, row.command);
}

function displayPath(row) {
  const title = titleFor(row);
  if (title === "Docker" || title === "Herd" || title === row.command) return null;
  if (!row.cwd || projectLabel(row.cwd, row.command) === row.command) return null;
  return row.cwd;
}

function cwdFromLsof(output) {
  const directories = new Map();
  for (const proc of parseLsof(output)) {
    const directory = proc.names.find((name) => name.startsWith("/"));
    if (directory) directories.set(proc.pid, directory);
  }
  return directories;
}

export function buildSnapshot({ lsofText, psText, cwdText = "", selfPid, user }) {
  const processes = parsePs(psText);
  const directories = cwdFromLsof(cwdText);
  const rows = [];

  for (const proc of parseLsof(lsofText)) {
    const info = processes.get(proc.pid);
    const parent = info ? processes.get(info.ppid) : null;
    const commandLine = info?.command || proc.command;
    const blockedReason = blockedReasonFor(proc, info, parent, selfPid, user);
    const cwd = directories.get(proc.pid) || null;
    const parentCommand = parent?.command || "";
    const ports = new Map();

    for (const name of proc.names) {
      const address = parseAddress(name);
      if (!address) continue;
      if (!ports.has(address.port)) ports.set(address.port, new Set());
      ports.get(address.port).add(address.host);
    }

    for (const [port, hosts] of ports) {
      rows.push({
        port,
        hosts: [...hosts],
        pid: proc.pid,
        command: proc.command,
        commandLine,
        parentCommand,
        cwd,
        canStop: blockedReason === null,
        blockedReason,
      });
    }
  }

  return groupRows(rows);
}

function groupRows(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = [row.command, row.commandLine, row.parentCommand, row.cwd, row.canStop, row.blockedReason].join("\0");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const listeners = [];
  for (const items of buckets.values()) {
    const byPid = new Map();
    for (const item of items) {
      if (!byPid.has(item.pid)) {
        byPid.set(item.pid, { ...item, ports: new Set(), hosts: new Set() });
      }
      const record = byPid.get(item.pid);
      record.ports.add(item.port);
      for (const host of item.hosts) record.hosts.add(host);
    }

    const byPorts = new Map();
    for (const record of byPid.values()) {
      const portKey = [...record.ports].sort((a, b) => a - b).join(",");
      if (!byPorts.has(portKey)) byPorts.set(portKey, []);
      byPorts.get(portKey).push(record);
    }

    for (const records of byPorts.values()) {
      const sample = records[0];
      const hosts = [...new Set(records.flatMap((record) => [...record.hosts]))];
      listeners.push({
        ports: [...sample.ports].sort((a, b) => a - b),
        where: whereLabel(hosts),
        title: titleFor(sample),
        command: sample.command,
        commandLine: sample.commandLine,
        path: displayPath(sample),
        pids: records.map((record) => record.pid).sort((a, b) => a - b),
        canStop: sample.canStop,
        blockedReason: sample.blockedReason,
      });
    }
  }

  const collapsed = collapseProtected(listeners);

  const portOwners = new Map();
  for (const listener of collapsed) {
    for (const port of listener.ports) portOwners.set(port, (portOwners.get(port) || 0) + 1);
  }
  for (const listener of collapsed) {
    listener.shared = listener.ports.some((port) => portOwners.get(port) > 1);
  }

  collapsed.sort((a, b) => {
    if (a.canStop !== b.canStop) return a.canStop ? -1 : 1;
    return a.ports[0] - b.ports[0];
  });

  return collapsed;
}

function collapseProtected(listeners) {
  const result = [];
  const groups = new Map();
  for (const listener of listeners) {
    if (listener.canStop) {
      result.push(listener);
      continue;
    }
    const key = `${listener.title}\0${listener.blockedReason}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, listener);
      result.push(listener);
      continue;
    }
    existing.ports = [...new Set([...existing.ports, ...listener.ports])].sort((a, b) => a - b);
    existing.pids = [...new Set([...existing.pids, ...listener.pids])].sort((a, b) => a - b);
    if (existing.where !== listener.where) existing.where = null;
    if (existing.command !== listener.command) existing.command = existing.title;
    existing.path = null;
  }
  return result;
}

export function planStop(listeners, { pids }) {
  if (!Array.isArray(pids) || pids.length === 0 || pids.length > 40) {
    return { error: "Choose a server from the list." };
  }
  if (!pids.every((pid) => Number.isInteger(pid) && pid > 0)) {
    return { error: "A process id was not valid." };
  }

  const wanted = [...new Set(pids)].sort((a, b) => a - b);
  const entry = listeners.find(
    (item) => item.pids.length === wanted.length && item.pids.every((pid, index) => pid === wanted[index]),
  );
  if (!entry) return { error: "Those processes are not listening anymore." };
  if (!entry.canStop) return { error: entry.blockedReason };
  return { pids: entry.pids };
}

export async function readSnapshot({ selfPid = process.pid, user = process.env.USER || "" } = {}) {
  const [lsof, ps, cwd] = await Promise.all([
    execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLn"], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }),
    execFileAsync("ps", ["-ax", "-o", "pid=,ppid=,user=,command="], { timeout: 8000, maxBuffer: 16 * 1024 * 1024 }),
    execFileAsync("lsof", ["-nP", "-d", "cwd", "-Fpn"], { timeout: 8000, maxBuffer: 16 * 1024 * 1024 }).catch(() => ({ stdout: "" })),
  ]);

  return buildSnapshot({
    lsofText: lsof.stdout,
    psText: ps.stdout,
    cwdText: cwd.stdout,
    selfPid,
    user,
  });
}
