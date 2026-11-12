import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { connect, type Client } from "./client.ts";
import { spawnPane } from "./cmux.ts";

type Member = { name: string; busy: boolean; queued: number; up: boolean };

export default function (pi: ExtensionAPI) {
  const agent = process.env.PI_RIPPLE_AGENT ?? basename(process.cwd());
  const change = process.env.PI_RIPPLE_CHANGE ?? randomUUID().slice(0, 8);
  let client: Client | undefined;
  let busy = false;
  let members: Member[] = [];
  let setWidget: ((lines?: string[]) => void) | undefined;

  const fmt = (m: { from: string; text: string }, kind = "") =>
    m.from === "user"
      ? m.text
      : `[ripple${kind} from ${m.from}] ${m.text}\n\n(Reply with ripple_send to "${m.from}" if you need to answer or confirm.)`;

  const render = (queue: { from: string; text: string }[]) => {
    const lines = [`ripple ${change} · you=${agent} · ` + members.map((m) => `${m.name}${m.busy ? "*" : ""}(${m.queued})`).join(" ")];
    for (const q of queue) lines.push(`  ↳ queued from ${q.from}: ${q.text.replace(/\s+/g, " ").slice(0, 70)}`);
    setWidget?.(members.length > 1 || queue.length ? lines : undefined);
  };

  pi.on("session_start", async (_e, ctx) => {
    setWidget = (l) => ctx.ui.setWidget("ripple", l);
    client = await connect((m) => {
      if (m.op === "run") pi.sendUserMessage(fmt(m.msg));
      else if (m.op === "steer")
        pi.sendMessage(
          { customType: "ripple-steer", content: fmt(m.msg, " steer"), display: true },
          { deliverAs: busy ? "steer" : "nextTurn" }, // idle: land in context, don't wake agent
        );
      else if (m.op === "state") { members = m.members; render(m.queue); }
    });
    client.send({ op: "register", change, agent, cwd: process.cwd() });
  });
  pi.on("session_shutdown", () => client?.close());
  pi.on("agent_start", () => { busy = true; client?.send({ op: "busy" }); });
  pi.on("agent_settled", () => { busy = false; client?.send({ op: "idle" }); });

  // User alt+enter (follow-up) joins the shared queue. Plain steer stays native.
  pi.on("input", (e) => {
    if (e.source === "interactive" && e.streamingBehavior === "followUp") {
      client?.send({ op: "enqueue", to: agent, from: "user", text: e.text });
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", (e) => ({
    systemPrompt:
      e.systemPrompt +
      `\n\n## ripple (cross-repo)\nYou are agent "${agent}" and own ONLY the repo at ${process.cwd()}. Never edit other repos. ` +
      `If the task needs changes elsewhere: plan what the other repo must do, call ripple_spawn (new repo) or ripple_send (existing agent) with a self-contained spec. ` +
      `Use mode "steer" for context/spec updates that need no action; "queue" for work or questions. to:"all" broadcasts. Check ripple_agents for members.`,
  }));

  pi.registerTool(defineTool({
    name: "ripple_spawn",
    label: "Ripple spawn",
    description: "Open a new pi agent in another repo (new cmux pane, stays open) and queue its first task. Task must be self-contained: what to change, interfaces, constraints.",
    parameters: Type.Object({
      repo: Type.String({ description: "Path to the other repo (absolute or relative to cwd)" }),
      task: Type.String({ description: "What the agent in that repo must plan and implement" }),
    }),
    async execute(_id, p) {
      const cwd = resolve(process.cwd(), p.repo);
      const name = basename(cwd);
      if (members.some((m) => m.name === name))
        return { content: [{ type: "text", text: `Agent "${name}" already exists. Use ripple_send.` }], details: {} };
      client!.send({ op: "enqueue", to: name, from: agent, text: p.task });
      spawnPane(name, cwd, { PI_RIPPLE_CHANGE: change, PI_RIPPLE_AGENT: name });
      return { content: [{ type: "text", text: `Spawned "${name}" in ${cwd}; task queued.` }], details: {} };
    },
  }));

  pi.registerTool(defineTool({
    name: "ripple_send",
    label: "Ripple send",
    description: "Send a message to another agent in this change (or all). queue = appended to their prompt queue; steer = context/spec note injected without queueing.",
    parameters: Type.Object({
      to: Type.String({ description: 'Agent name, or "all"' }),
      text: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("queue"), Type.Literal("steer")])),
    }),
    async execute(_id, p) {
      client!.send({ op: p.mode === "steer" ? "steer" : "enqueue", to: p.to === "all" ? "*" : p.to, text: p.text });
      return { content: [{ type: "text", text: `Sent (${p.mode ?? "queue"}) to ${p.to}.` }], details: {} };
    },
  }));

  pi.registerTool(defineTool({
    name: "ripple_agents",
    label: "Ripple agents",
    description: "List agents in this change with busy state and queue length.",
    parameters: Type.Object({}),
    async execute() {
      const t = members.map((m) => `${m.name}: ${m.up ? (m.busy ? "busy" : "idle") : "down"}, queued ${m.queued}`).join("\n");
      return { content: [{ type: "text", text: t || "(none)" }], details: {} };
    },
  }));

  pi.registerCommand("ripple", {
    description: "/ripple [send|steer <to|all> <text>] — status or message other agents",
    handler: async (args, ctx) => {
      const [verb, to, ...rest] = args.trim().split(/\s+/);
      if ((verb === "send" || verb === "steer") && to && rest.length) {
        client?.send({ op: verb === "steer" ? "steer" : "enqueue", to: to === "all" ? "*" : to, from: "user", text: rest.join(" ") });
        return;
      }
      ctx.ui.notify(`change ${change}\n` + members.map((m) => `${m.name}: ${m.up ? (m.busy ? "busy" : "idle") : "down"}, queued ${m.queued}`).join("\n"), "info");
    },
  });
}
