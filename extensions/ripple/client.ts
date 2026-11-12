import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

export const SOCK = process.env.RIPPLE_SOCK ?? join(homedir(), ".pi", "ripple", "broker.sock");

export type Client = { send(m: object): void; close(): void };

const tryConnect = () =>
  new Promise<net.Socket | null>((res) => {
    const s = net.connect(SOCK);
    s.once("connect", () => res(s));
    s.once("error", () => res(null));
  });

/** Connect to the broker, spawning it detached if it isn't running. */
export async function connect(onMsg: (m: any) => void): Promise<Client> {
  let sock = await tryConnect();
  if (!sock) {
    const broker = fileURLToPath(new URL("./broker.ts", import.meta.url));
    spawn(process.execPath, [broker], { detached: true, stdio: "ignore", env: process.env }).unref();
    for (let i = 0; i < 30 && !sock; i++) {
      await new Promise((r) => setTimeout(r, 100));
      sock = await tryConnect();
    }
  }
  if (!sock) throw new Error("ripple: cannot reach broker at " + SOCK);
  const s = sock;
  let buf = "";
  s.on("data", (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { onMsg(JSON.parse(line)); } catch {}
    }
  });
  s.on("error", () => {});
  return { send: (m) => void s.write(JSON.stringify(m) + "\n"), close: () => s.destroy() };
}
