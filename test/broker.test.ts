import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sock = join(mkdtempSync(join(tmpdir(), "ripple-")), "b.sock");
process.env.RIPPLE_SOCK = sock;
const { connect } = await import("../extensions/ripple/client.ts");

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test("queue FIFO, broadcast, steer bypass", async () => {
  const got: Record<string, any[]> = { a: [], b: [], c: [] };
  const mk = async (n: string) => {
    const c = await connect((m) => m.op !== "state" && got[n].push(m));
    c.send({ op: "register", change: "x", agent: n });
    return c;
  };
  const a = await mk("a"), b = await mk("b"), c = await mk("c");
  await wait();

  // enqueue to busy agent: held in FIFO, released one per idle
  b.send({ op: "busy" });
  a.send({ op: "enqueue", to: "b", text: "1" });
  a.send({ op: "enqueue", to: "b", text: "2" });
  await wait();
  assert.equal(got.b.length, 0);
  b.send({ op: "idle" }); await wait();
  assert.deepEqual(got.b.map((m) => m.msg.text), ["1"]);
  b.send({ op: "idle" }); await wait();
  assert.deepEqual(got.b.map((m) => m.msg.text), ["1", "2"]);

  // broadcast skips sender, idle targets run immediately
  a.send({ op: "enqueue", to: "*", text: "all" }); await wait();
  assert.equal(got.a.length, 0);
  assert.equal(got.c.at(-1).msg.text, "all");

  // steer bypasses queue, even to a busy agent
  c.send({ op: "busy" });
  a.send({ op: "steer", to: "c", text: "spec" }); await wait();
  assert.deepEqual(got.c.at(-1), { op: "steer", msg: { from: "a", text: "spec" } });

  [a, b, c].forEach((x) => x.close());
});

test.after(() => process.exit(0));
