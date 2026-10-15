# Agents Tasks

Configure, queue and monitor GitHub Copilot CLI or Claude Code agents from a browser.
Zero npm dependencies, no build step.

![Board](docs/ui-running.png)

## Requirements

- Node.js ≥ 22.5 (`node:sqlite`)
- For GitHub Copilot: `copilot` on `PATH`, signed in; `gh` signed in (optional, for the remaining allowance)
- For Claude Code: `claude` on `PATH`, signed in (`claude auth`) or `ANTHROPIC_API_KEY` set

## Run

```bash
npm start      # web UI on http://127.0.0.1:4317
```

Pick the **AI assistant** (Claude Code, the default, or GitHub Copilot) in Agent configuration; each has its own model and effort. The choice is saved as soon as you pick it and applies to tasks started afterwards; every run records which assistant ran it.

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

### Scheduling

Set **Start at** in the task dialog to run a task at a given time, and **Repeat** (every hour, day, weekday or week) to run it again from then on. Repeats keep the local wall-clock time, also across daylight-saving changes.

- A scheduled task waits in the Queued lane ("Starts Thu 23:00", "↻ Every day") and starts at its time in **Manual and Auto** mode. If no slot is free, it shows "Due: waiting for a slot" and starts first when one frees. ▶ starts it early.
- After each run, a repeating task goes back to the queue for its next occurrence; each occurrence is a new run on the board. Stopping or failing one run does not end the series. To end it, edit the task to *Never*, drag it from Queued to Finished, or delete it. Dragging a running repeating task back to Queued pauses it (On hold) until ▶.
- If the server was not running at a start time, the task runs once as soon as it starts again; missed repeats are not caught up one by one.
- Times are checked every 5 s, so a task starts up to a few seconds after its time.

The UI adapts to phones and tablets: on narrow screens the configuration starts collapsed so the board comes first, and the lanes stack. Dragging needs a mouse; on touch screens use the tile buttons instead.

A terminal UI is planned once the web UI is settled. The core is UI-agnostic; see [the extension skill](.claude/skills/extend-agents-tasks/SKILL.md).

## Test

```bash
npm test             # offline, uses test/fixtures/fake-copilot.mjs
npm run verify:ui    # headless Chrome against a running fake-agent server
```

How to run the app against the fake CLI and verify a change: [the verify skill](.claude/skills/verify-agents-tasks/SKILL.md).

### Skills for coding agents

`.claude/skills/` holds [agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) for working on this repo. Both Claude Code and GitHub Copilot (CLI and coding agent) load them from there:

- `extend-agents-tasks`: layering, recipes for new operations/settings/backends, rules that must not regress
- `verify-agents-tasks`: test suite, running against the fake CLI, headless UI check

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` / `HOST` | `4317` / `127.0.0.1` (no auth — keep it local) |
| `DB_FILE` | `./data/control-room.db` |
| `COPILOT_BIN` | `copilot` |
| `CLAUDE_BIN` | `claude` |
| `COPILOT_HOME` | `~/.copilot` (token usage source) |
| `GH_BIN` | `gh` (remaining allowance source) |

The agent working directory is a runtime setting (default `./workspaces`).

The dollar cost in the top bar adds up both assistants. A Copilot run costs AIC × **Price per AIC** (Agent configuration, default $0.01). A Claude Code run costs what Claude Code reports (`total_cost_usd`), priced at API rates; on a Pro/Max subscription that is an estimate, not a charge. Neither is your actual bill. The AIC stat counts Copilot runs only and is hidden while Claude Code is selected.

The **left** stats follow the selected assistant:

- **Claude Code:** how much of your subscription's **5-hour** limit (first stat) and **weekly** limit (second stat) is left, in percent. Each is labelled with when it resets and which window, e.g. "01:20 PM (5H)" and "SAT 04:00 PM (WEEK)". Hover for the full reset dates. Claude Code reports these with every API response (`rate_limit_event`). They update during each task and whenever the page is loaded or reloaded: the server then makes one tiny `claude` call (Haiku, no tools, nothing saved, stopped as soon as the limits arrive) at most once a minute, however many tabs reload. That call counts against the 5-hour window like any other. Usage elsewhere on the same subscription shows up at the next update; hover for when the reading was taken. A window whose reset time has passed shows 100%. Claude reports a share of the limit, not a token count. API-key accounts have no such limits and show n/a.
- **GitHub Copilot:** your monthly AI Credit allowance still unused, in dollars and in percent (hover for AIC and reset date). It comes from `gh api /copilot_internal/user` (undocumented GitHub endpoint), covers your whole Copilot account and refreshes every 60 s. Shows n/a if `gh` fails.

## Environment variables

Agents do not inherit the server's environment. They receive only:

- `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`/`TMP`/`TEMP`, `LANG`, `LANGUAGE`, `TZ`, `TERM`, `LC_*`, `XDG_*`
- proxy and CA settings: `HTTP(S)_PROXY`, `NO_PROXY`, `ALL_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`
- Copilot and GitHub sign-in: `COPILOT_*`, `GH_HOST`, `GH_TOKEN`, `GITHUB_TOKEN`
- on Windows, the system variables Node needs (`SYSTEMROOT`, `COMSPEC`, `APPDATA`, …)
- the names you add under **Also pass these variables** in the Environment variables section (e.g. `JAVA_HOME`, `GOPATH`). Values come from the server's environment; a name that is not set there is skipped.

Cloud keys, `SSH_AUTH_SOCK` and everything else stay out. `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` and `GITHUB_TOKEN` are always **secret**: the CLI can sign in with them, but they are stripped from the agent's shell and redacted from its output. Add more under **Secret environment variables**.

## Guarantees

- The server answers only requests addressed to itself: a `Host` or `Origin` other than localhost/127.0.0.1/[::1] (or the bind address) on its own port gets a 403. Other websites open in your browser cannot create or start tasks, and DNS rebinding is refused.
- Agent CPU/RAM in the top bar is measured live (`ps`) over each agent's whole process tree; CPU is a share of all cores. Shown as n/a where `ps` is unavailable.
- Token usage comes from the Copilot session store, or for Claude Code from its final `result` event. It is never estimated: a run with no data shows "not reported yet" (still running) or "unavailable" (finished).
- Agents get a minimal environment; see [Environment variables](#environment-variables).
- Each run gets a throwaway workspace and may access the whole agent working directory (`--add-dir`); other paths need approval and are denied. `git push`, `gh` and `git remote` are always denied, agent `git` cannot see this repo, MCP servers are disabled.
- Web access (`web_fetch`) is off by default. Neither CLI can enforce an allow-list: with the shell enabled, every unblocked site is reachable.

| | GitHub Copilot | Claude Code |
| --- | --- | --- |
| Tools | `--available-tools` | `--tools`; file tools allowed only in the workspace and working directory |
| Prompts | `--allow-all-tools` within the permission flags | `--permission-mode dontAsk`: anything not allowed is denied |
| Denied commands | `--deny-tool shell(…)` | `--disallowedTools Bash(…)` |
| Blocked websites | `--deny-url`: web access **and** shell commands like `curl` | `WebFetch(domain:…)`: web access **only**, `curl` can still reach them |
| Secrets | passed, hidden from the shell and redacted (`--secret-env-vars`) | not passed at all; its own API key is removed from the shell (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`) |
| Untrusted workspace | never trusted (`COPILOT_ALLOW_ALL=1`) | `--safe-mode`, `--setting-sources user`: no CLAUDE.md, skills, hooks or plugins from it |
| MCP | `--disable-builtin-mcps` | `--strict-mcp-config` without servers |

See [ARCHITECTURE.md](ARCHITECTURE.md).
