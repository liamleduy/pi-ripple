// Central queue broker. One process, all changes. NDJSON over a unix socket.
// Client -> broker ops: register, enqueue, steer, busy, idle, list
// Broker -> client ops: run, steer, state, agents
import net from "node:net";
import { appendFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SOCK = process.env.RIPPLE_SOCK ?? join(homedir(), ".pi", "ripple", "broker.sock");
const LOG = join(dirname(SOCK), "log.jsonl");

type Msg = { from: string; text: string };
type Agent = { queue: Msg[]; socket?: net.Socket; busy: boolean; cwd?: string };

const changes = new Map<string, Map<string, Agent>>();
const send = (s: net.Socket | undefined, m: object) => s?.writable && s.write(JSON.stringify(m) + "\n");
const log = (m: object) => { try { appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...m }) + "\n"); } catch {} };

function agent(change: string, name: string): Agent {
  let c = changes.get(change);
  if (!c) changes.set(change, (c = new Map()));
  let a = c.get(name);
  if (!a) c.set(name, (a = { queue: [], busy: false }));
  return a;
}

// Send next queue item to an idle, connected agent. Marks busy optimistically so we never double-send.
function dispatch(a: Agent) {
  if (!a.socket || a.busy || !a.queue.length) return;
  a.busy = true;
  send(a.socket, { op: "run", msg: a.queue.shift() });
}

function pushState(change: string) {
  const c = changes.get(change)!;
  const members = [...c].map(([name, a]) => ({ name, busy: a.busy, queued: a.queue.length, up: !!a.socket }));
  for (const a of c.values()) send(a.socket, { op: "state", queue: a.queue, members });
}

const targets = (change: string, to: string, from: string) =>
  to === "*" ? [...(changes.get(change) ?? [])].filter(([n]) => n !== from).map(([n]) => n) : [to];

export function start() {
  const server = net.createServer((sock) => {
    let change = "", name = "", buf = "";
    sock.on("data", (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        let m: any;
        try { m = JSON.parse(line); } catch { continue; }
        log({ ...m, change: m.change ?? change, agent: name });
        switch (m.op) {
          case "register": {
            change = m.change; name = m.agent;
            const a = agent(change, name);
            a.socket = sock; a.cwd = m.cwd; a.busy = false;
            dispatch(a); pushState(change);
            break;
          }
          case "enqueue":
            // ponytail: plain FIFO append. Queue policy (priority/dedupe) goes here.
            for (const t of targets(change, m.to, name)) {
              const a = agent(change, t);
              a.queue.push({ from: m.from ?? name, text: m.text });
              dispatch(a);
            }
            pushState(change);
            break;
          case "steer":
            for (const t of targets(change, m.to, name))
              send(agent(change, t).socket, { op: "steer", msg: { from: m.from ?? name, text: m.text } });
            break;
          case "busy": agent(change, name).busy = true; pushState(change); break;
          case "idle": { const a = agent(change, name); a.busy = false; dispatch(a); pushState(change); break; }
        }
      }
    });
    sock.on("close", () => {
      const a = changes.get(change)?.get(name);
      if (a && a.socket === sock) { a.socket = undefined; a.busy = false; pushState(change); }
      scheduleExit();
    });
    sock.on("error", () => {});
  });

  let timer: NodeJS.Timeout | undefined;
  const scheduleExit = () => {
    clearTimeout(timer);
    server.getConnections((_, n) => {
      if (n === 0 && process.env.RIPPLE_NO_EXIT !== "1")
        timer = setTimeout(() => { try { unlinkSync(SOCK); } catch {} process.exit(0); }, 10 * 60_000);
    });
  };

  mkdirSync(dirname(SOCK), { recursive: true });
  // If another broker is alive, bow out; otherwise clear the stale socket.
  const probe = net.connect(SOCK);
  probe.on("connect", () => process.exit(0));
  probe.on("error", () => {
    try { unlinkSync(SOCK); } catch {}
    server.listen(SOCK);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
