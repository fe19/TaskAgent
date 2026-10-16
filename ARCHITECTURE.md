# Architecture

Node ≥ 22.5 built-ins only: `node:http`, `node:sqlite`, `node:test`, SSE. Plain ES-module frontend.

## Layout

```
server.js                  entry point (web)
src/
├── control-room.js        composition root: config, db, stores, scheduler, actions
├── actions.js             use-cases shared by every UI (create, cancel, requeue, dispatch, …)
├── presenters.js          rows → view models (usage is null, never 0)
├── errors.js              AppError with a status code
├── config.js, events.js   env config, event bus
├── domain/                pure rules — also served to the browser at /domain/
├── store/                 all SQL, plus read-only Copilot usage and quota (via gh) readers
├── agents/                spawning: CLI adapters, run lifecycle, scheduler (slots), task clock (start times), workspaces, CPU/RAM sampling
└── http/                  server, router, routes, SSE, static files
web/                       browser UI: main.js composes views/, store.js holds state
test/                      mirrors src/; fixtures/fake-copilot.mjs, fake-claude.mjs and fake-gh.mjs stand in for the CLIs
scripts/verify-ui.mjs      end-to-end check in headless Chrome
```

## Dependency rule

```
http/ (any UI)  →  actions, presenters  →  agents/  →  store/  →  domain/
```

- `domain/` does no I/O.
- Only `store/` contains SQL.
- Only the adapters (`agents/copilot-cli.js`, `agents/claude-cli.js`) know a CLI's argv, environment and event format.
- An adapter with `osSandbox(settings, { workspace, bin })` has its whole CLI started inside Anthropic's sandbox-runtime (`agents/os-sandbox.js`); Claude Code instead passes its built-in sandbox settings. Either way each run sees only its own workspace.
- `AgentRun` drives whichever adapter `agents/assistants.js` returns for the `assistant` setting; the scheduler reads it when a task starts.
- Two things start tasks: the `Scheduler` fills free slots (Auto mode, or ▶), and the `TaskClock` (`agents/task-clock.js`) starts scheduled tasks whose `run_at` has come, in either mode, and requeues a repeating task for its next occurrence after each run. `claimNext` never takes a task before its `run_at`.
- Dependencies are passed in by `control-room.js`, so each layer is testable alone.

## Extending

- **New UI** (e.g. the planned terminal): call `createControlRoom()` and use `room.actions`, `room.bus` and `presenters`. Only one UI process may run per database.
- **New operation:** add it to `actions.js`, then expose it in `http/routes.js` (and any other UI).
- **New setting:** add it to `SETTING_SPEC` (`domain/settings-schema.js`) and `DEFAULT_SETTINGS` (`store/database.js`).
- **New agent backend:** write a sibling of `agents/claude-cli.js` exporting an adapter (`id`, `binOption`, `defaultBin`, `pollsUsage`, `model(settings)`, `effort(settings)`, `buildArgs`, `buildEnv`, `parseEvent`, `interpret`, optional `rejectsEffort`), register it in `agents/assistants.js`, list it in `domain/assistants.js`, give it its environment in `domain/environment.js` and its guarantees in `domain/permissions.js`. `interpret(evt)` returns `{ activities, toolCalls, message, result, usage, error }`; return `usage` from the event if the CLI reports it, otherwise set `pollsUsage` and read it after exit.

## Data

`settings`, `tasks` (with `run_at`, the next start in UTC, and `repeat`; see `domain/schedule.js`), `runs` (with the `assistant` that ran it), `run_events`, `run_usage` (`nano_aiu` for Copilot, `cost_usd` for Claude Code), `assistant_limits` (the latest account limits an assistant reported, e.g. Claude Code's 5-hour and weekly windows) — see `store/database.js`. New columns are added on boot by `addColumn`.

On boot, runs left live by a previous process become `interrupted`, and their tasks are requeued. Scheduled starts missed while the server was down run once on boot.

## Tests

`npm test` runs offline against `fake-copilot.mjs` and `fake-claude.mjs`. Prompt markers set their behavior: `HANG`, `FAIL`, plus `REJECT_EFFORT` (Copilot) and `ERROR_RESULT` (Claude Code). `COPILOT_FAKE_DELAY_MS` / `CLAUDE_CODE_FAKE_DELAY_MS` delay normal runs.
