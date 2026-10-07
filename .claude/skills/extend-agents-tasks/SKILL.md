---
name: extend-agents-tasks
description: How to change or extend Agents Tasks (this repo) — add an operation, setting, permission, agent backend or UI while keeping its layering, zero-dependency rule and security guarantees. Use before editing anything under src/ or web/.
---

# Extending Agents Tasks

A local web UI that queues prompts and runs them as GitHub Copilot CLI or Claude Code agents. Node ≥ 22.5
built-ins only (`node:http`, `node:sqlite`, `node:test`), plain ES modules in the browser,
**no npm dependencies and no build step**. Do not add any; a CDN or bundler is not an option either.

Read `ARCHITECTURE.md` for the layout. The essentials:

```
http/ (any UI)  →  actions, presenters  →  agents/  →  store/  →  domain/
```

- `src/domain/` is pure (no I/O) and is also served to the browser at `/domain/`, so the UI
  imports the same rules. Anything taking the environment takes it as an argument.
- Only `src/store/` contains SQL.
- Only the adapters (`src/agents/copilot-cli.js`, `src/agents/claude-cli.js`) know a CLI's argv,
  environment and event format. `AgentRun` drives the one `src/agents/assistants.js` returns for
  the global `assistant` setting.
- `src/control-room.js` wires everything; layers get dependencies passed in, so each is
  testable alone. Never import a store or the scheduler directly from a route.
- `actions.js` holds every state-changing operation shared by all UIs.

## Recipes

**New operation.** Add it to `createActions` in `src/actions.js` (throw `badRequest` /
`conflict` / `notFound` from `errors.js`; publish a bus event so SSE clients refresh), then
expose it in `src/http/routes.js`. Test in `test/actions.test.js` and `test/http/api.test.js`.

**New setting.**
1. `SETTING_SPEC` in `src/domain/settings-schema.js` (reuse a validator type; list-valued
   settings also go in `LIST_KEYS`).
2. `DEFAULT_SETTINGS` in `src/store/database.js`, stored as a string. Existing databases
   pick it up on boot — no migration needed.
3. Read it where needed from the `settings` object (`AgentRun` gets it as `this.settings`).
4. UI: a field in `web/index.html` plus the matching view in `web/scripts/views/`.
5. Tests: `test/domain/settings-schema.test.js` and whatever consumes it.

**New permission.** It must map to a real CLI flag — add it to `permissionArgs` in
`src/domain/permissions.js`. Something enforced by how the process is built goes in
`ENFORCED_GUARANTEES`, which the UI shows read-only. Only write a guarantee the code enforces.

**Agent environment.** Agents get only the allow-list in `src/domain/environment.js` (shared
`PASSED_ENV_VARS` plus the assistant's own `ASSISTANT_ENV`) and the operator's `passed_env_vars`.
Add only what the CLI itself needs to run. Copilot hides `CORE_SECRET_ENV_VARS` and operator
secrets from its shell; Claude Code cannot, so its adapter does not pass them at all.

**New agent backend.** Follow `src/agents/claude-cli.js`: export an adapter object (`id`,
`binOption`, `defaultBin`, `pollsUsage`, `model`, `effort`, `buildArgs`, `buildEnv`, `parseEvent`,
`interpret`), register it in `src/agents/assistants.js`, list it in `src/domain/assistants.js`,
add its model/effort settings, its `ASSISTANT_ENV` entry and any guarantees that differ
(`enforcedGuarantees` in `src/domain/permissions.js`), a `*Bin` option in `config.js`, and a
fake CLI in `test/fixtures/`. Map every permission to a real flag of that CLI; where it cannot
enforce one, say so in its guarantees instead of claiming parity. Keep the prompt out of reach of
option parsing (Claude Code: last, after `--`).

**New UI** (e.g. the planned terminal UI): call `createControlRoom()` and use `room.actions`,
`room.bus` and `presenters`. One UI process per database.

**Web UI.** `web/scripts/main.js` composes the views; each view exports `mount()` and
`render()` and reads `state` from `store.js`. Escape all interpolated text with `esc()` from
`format.js`. Styles use the tokens in `web/styles/tokens.css` and must work at phone width.

## Rules that must not regress

- **Local only.** `src/http/local-origin.js` rejects any request whose `Host` or `Origin` is
  not this server (CSRF and DNS rebinding). Every route goes through it; never add a bypass.
- **Agent sandbox.** Each run gets a fresh workspace; `GIT_CEILING_DIRECTORIES` hides this
  repo from agent `git`; `git push`, `gh` and `git remote` are always denied; built-in MCPs are
  off; `COPILOT_ALLOW_ALL` is `'1'`, never `'true'` (that would trust the workspace).
- **No trusted config in shared roots.** `hasTrustedConfig` (`src/agents/workspace.js`) drops
  `--add-dir` when the working directory holds skills or custom agents. Keep its list in step
  with the directories the CLI loads them from.
- **Unknown is not zero.** Usage the CLI did not report is `null` and shown as "not reported
  yet" / "unavailable", never `0`.

## Style

Match the surrounding code: small modules, a one-line `/** … */` doc comment on each export
saying *why*, short comments only where intent is not obvious, user-facing error messages that
tell the operator what to do. Tests mirror `src/` under `test/` and are named as sentences.

When done, run the checks in the `verify-agents-tasks` skill.
