# pi-ripple

Cross-repo features for [pi](https://github.com/badlogic/pi-mono): one agent per repo, coordinated through a shared prompt queue.

```
pi install git:github.com/lalalkila/pi-ripple     # run pi inside cmux
```

- Open pi in any repo and give it a task. If other repos are affected it calls `ripple_spawn`, which opens a new cmux pane running pi in that repo (kept open) and queues a task for it.
- Every agent has a prompt queue held by a small broker (`~/.pi/ripple/broker.sock`, log at `log.jsonl`). The user and other agents append to it; items auto-run when the agent settles.
- `ripple_send` (`queue` or `steer`, to one agent or `all`) for questions, confirmations, spec changes. Steer to an idle agent lands in its context without starting a turn.
- You: Enter while busy = native steer; Alt+Enter = append to the queue. `/ripple` shows status, `/ripple send|steer <to|all> <text>`.
