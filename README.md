# Agents Tasks

Configure, queue and monitor GitHub Copilot CLI agents from a browser.
Zero npm dependencies, no build step.

![Board](docs/ui-running.png)

## Requirements

- Node.js ≥ 22.5 (`node:sqlite`)
- `copilot` on `PATH`, signed in
- `gh` signed in (optional, for the remaining allowance)

## Run

```bash
npm start      # web UI on http://127.0.0.1:4317
```

Add a task with **+** in the Queued lane or **Ctrl+N**. Edit a queued task's prompt with ✎ on its tile or in its dialog; once it starts, the prompt is fixed. Starts in **Manual** mode: press ▶ on a queued task. Switch to **Auto** to run queued tasks as slots free up.

Tiles can be dragged between lanes:

| Move | Effect |
| --- | --- |
| Queued → Working | start now |
| Queued → Finished | cancel |
| Working → Queued | stop the agent, pause it (On hold until ▶) |
| Working → Finished | stop the agent |
| Finished → Queued | retry (Auto runs it when a slot frees) |
| Finished → Working | retry and start now |

Every finished tile can be dragged. If its task is already queued or working again, the drop adds a copy of the task instead.

The UI adapts to phones and tablets: on narrow screens the configuration starts collapsed so the board comes first, and the lanes stack. Dragging needs a mouse; on touch screens use the tile buttons instead.

A terminal UI is planned once the web UI is settled. The core is UI-agnostic; see [the extension skill](.github/skills/extend-agents-tasks/SKILL.md).

## Test

```bash
npm test             # offline, uses test/fixtures/fake-copilot.mjs
npm run verify:ui    # headless Chrome against a running fake-agent server; see the skill
```

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` / `HOST` | `4317` / `127.0.0.1` (no auth — keep it local) |
| `DB_FILE` | `./data/control-room.db` |
| `COPILOT_BIN` | `copilot` |
| `COPILOT_HOME` | `~/.copilot` (token usage source) |
| `GH_BIN` | `gh` (remaining allowance source) |

The agent working directory is a runtime setting (default `./workspaces`).

The dollar cost in the top bar is AIC × **Price per AIC** (Agent configuration, default $0.01). It is an estimate, not your GitHub bill.

The two **left** stats show your monthly Copilot AI Credit allowance still unused, in dollars and in percent (hover for AIC and reset date). It comes from `gh api /copilot_internal/user` (undocumented GitHub endpoint), covers your whole Copilot account and refreshes every 60 s. Shows n/a if `gh` fails.

## Guarantees

- Agent CPU/RAM in the top bar is measured live (`ps`) over each agent's whole process tree; CPU is a share of all cores. Shown as n/a where `ps` is unavailable.
- Token usage comes from the Copilot session store. It is never estimated: a run with no data shows "not reported yet" (still running) or "unavailable" (finished).
- Each run gets a throwaway workspace and may access the whole agent working directory (`--add-dir`); other paths need approval and are denied. `git push`, `gh` and `git remote` are always denied, agent `git` cannot see this repo, built-in MCPs are disabled.
- Web access (`web_fetch`) is off by default. Blocked websites (`--deny-url`) apply to it and to shell commands like `curl`. The CLI cannot enforce an allow-list: with the shell enabled, every unblocked site is reachable.

See [ARCHITECTURE.md](ARCHITECTURE.md).
