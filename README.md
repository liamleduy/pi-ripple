# pi-ripple

**Cross-repo features for [pi](https://github.com/badlogic/pi-mono): one agent per repo, coordinated through a shared prompt queue.**

When a single agent is handed a change that spans several repos, it tends to fail in one of two ways: it reads everything and exhausts its context, or it focuses on the first repo and does a worse job on the rest. pi-ripple avoids both. Each repo gets its own pi runtime that owns only that repo, and the agents (and you) talk through a queue.

> **Status: early (v0.1).** The broker is covered by a test. The cmux spawning and the full multi-agent flow are new and have had limited real-world use. Expect rough edges and please open issues.

## How it works

```
 pi (repo A, origin) ─┐                       ┌─ pi (repo B)
 pi (repo C) ─────────┼── unix socket ─ broker ┼─ ...
                      └───────────────────────┘
```

1. Open pi in any repo and describe the task.
2. If the change touches another repo, the agent plans what that repo needs and calls `ripple_spawn`. A new cmux pane opens running pi in the other repo. The pane stays open when the task finishes.
3. The spawned agent receives the spec as its first queued prompt, then plans and implements it in its own repo, with its own context.
4. Agents ask questions, confirm interfaces and announce spec changes by sending messages to each other's queues.

### The prompt queue

Every agent has an input queue held by a small local broker. You and other agents append to it; items run automatically, one at a time, when the agent finishes its current work.

| Message type | Behavior |
| --- | --- |
| **queue** | Appended to the end of the target's queue. Runs when the target is idle. Use for tasks, questions, confirmations. |
| **steer** | Not queued. Delivered immediately as context. If the target is busy it lands before the next model call; if idle it is added to context **without** starting a turn. Use for spec or context changes. |
| **broadcast** | Either type addressed to `all` reaches every other agent in the change. |

Your own input keeps working as usual: **Enter** while the agent is busy is a native pi steer; **Alt+Enter** (follow-up) appends to the shared queue.

The queue is plain FIFO today. The broker is the single place where queue policy (priorities, dedupe) would live.

## Install

```bash
pi install git:github.com/lalalkila/pi-ripple
```

Requirements:
- [pi](https://github.com/badlogic/pi-mono) 1.5 or newer
- [cmux](https://github.com/manaflow-ai/cmux): run pi inside it (`cmux pi`). cmux is the only supported multiplexer for now.
- Node 22.6+ (the broker runs TypeScript directly; developed on Node 24)

## Usage

Start pi in a repo inside cmux and ask for the feature as you normally would. The agent decides when to bring in other repos.

### Tools available to the agent

| Tool | Purpose |
| --- | --- |
| `ripple_spawn { repo, task }` | Open a pi agent in another repo and queue its first task. The task should be self-contained: what to change, interfaces, constraints. |
| `ripple_send { to, text, mode? }` | Message one agent or `all`. `mode` is `queue` (default) or `steer`. |
| `ripple_agents {}` | List agents in this change with busy/idle state and queue length. |

The agent is also told, via the system prompt, to edit only its own repo and to use these tools for anything elsewhere.

### Commands

```
/ripple                          show change id, agents, queue lengths
/ripple send  <agent|all> <text> append a prompt to an agent's queue
/ripple steer <agent|all> <text> send a context/spec update without queueing
```

A widget above the editor shows the agents in the change (`*` marks busy, the number is queue length) and your queued items.

## Concepts

- **Change**: a group of agents working on one cross-repo feature. A change id is created when the first agent starts and passed to every agent it spawns via `PI_RIPPLE_CHANGE`.
- **Agent**: one pi runtime, named after its repo folder (`PI_RIPPLE_AGENT`).
- **Broker**: a background process that owns all queues. It listens on `~/.pi/ripple/broker.sock`, starts automatically on first use, and exits after 10 minutes with no connected agents.

## Files and debugging

Everything the broker handles is appended to `~/.pi/ripple/log.jsonl`:

```bash
tail -f ~/.pi/ripple/log.jsonl
```

Set `RIPPLE_SOCK` to use a different socket path.

## Development

```bash
git clone https://github.com/lalalkila/pi-ripple
cd pi-ripple
npm test                                   # broker test
pi -e ./extensions/ripple/index.ts         # try it without installing
```

Layout:

```
extensions/ripple/
  index.ts    pi extension: tools, commands, hooks, widget
  broker.ts   queue broker (unix socket, NDJSON)
  client.ts   broker client + autostart
  cmux.ts     cmux pane spawning
test/broker.test.ts
```

## License

MIT
