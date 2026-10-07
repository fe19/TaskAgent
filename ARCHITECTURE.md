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
├── agents/                spawning: CLI adapter, run lifecycle, scheduler, workspaces, CPU/RAM sampling
└── http/                  server, router, routes, SSE, static files
web/                       browser UI: main.js composes views/, store.js holds state
test/                      mirrors src/; fixtures/fake-copilot.mjs and fake-gh.mjs stand in for the CLIs
scripts/verify-ui.mjs      end-to-end check in headless Chrome
```

## Dependency rule

```
http/ (any UI)  →  actions, presenters  →  agents/  →  store/  →  domain/
```

- `domain/` does no I/O.
- Only `store/` contains SQL.
- Only `agents/copilot-cli.js` knows the CLI's argv and event format.
- Dependencies are passed in by `control-room.js`, so each layer is testable alone.

## Extending

- **New UI** (e.g. the planned terminal): call `createControlRoom()` and use `room.actions`, `room.bus` and `presenters`. Only one UI process may run per database.
- **New operation:** add it to `actions.js`, then expose it in `http/routes.js` (and any other UI).
- **New setting:** add it to `SETTING_SPEC` (`domain/settings-schema.js`) and `DEFAULT_SETTINGS` (`store/database.js`).
- **New agent backend:** write a sibling of `agents/copilot-cli.js`.

## Data

`settings`, `tasks`, `runs`, `run_events`, `run_usage` (see `store/database.js`).

On boot, runs left live by a previous process become `interrupted`, and their tasks are requeued.

## Tests

`npm test` runs offline against `fake-copilot.mjs`. Prompt markers set its behavior: `HANG`, `FAIL`, `REJECT_EFFORT`. `FAKE_COPILOT_DELAY_MS` delays normal runs.
