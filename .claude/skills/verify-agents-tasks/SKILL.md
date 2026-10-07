---
name: verify-agents-tasks
description: How to test and verify a change to Agents Tasks (this repo) — the offline unit/API suite, running the app against a fake Copilot CLI, and the headless-Chrome UI check. Use after any change and before reporting it as done.
---

# Verifying Agents Tasks

Nothing here needs the real `copilot` or `gh`, network access or a GitHub account: the
fixtures `test/fixtures/fake-copilot.mjs` and `test/fixtures/fake-gh.mjs` stand in for them.

## 1. Test suite (always)

```bash
npm test
```

Runs offline in about 10 s. The `node:sqlite` ExperimentalWarning is expected. Run a single
file with `node --test test/agents/agent-run.test.js`. Every change needs a test next to the
module it touches (`test/` mirrors `src/`).

The fake CLI is driven by markers in the task prompt:

| Marker | Behaviour |
| --- | --- |
| `HANG` | never exits (time-limit and stop paths) |
| `FAIL` | writes to stderr and exits 1 |
| `REJECT_EFFORT` | fails while `--reasoning-effort` is passed, so the retry succeeds |
| anything else | a normal successful run that writes `out.txt` and `env-names.json` |

`COPILOT_FAKE_DELAY_MS` delays the normal path so runs stay visible in the UI. It must start
with `COPILOT_`: agents only receive allow-listed variables.

## 2. Run the app against the fake CLI

Use a throwaway database and port so the real `data/` is untouched:

```bash
PORT=4399 DB_FILE=/tmp/acr-ui.db \
COPILOT_BIN=$PWD/test/fixtures/fake-copilot.mjs GH_BIN=$PWD/test/fixtures/fake-gh.mjs \
COPILOT_FAKE_DELAY_MS=1500 npm start
```

Then exercise the API with `curl` on `http://127.0.0.1:4399/api/...`. Send JSON with
`-H 'content-type: application/json'`. A request with a foreign `Host` or `Origin` gets a 403
by design. Stop the server and delete `/tmp/acr-ui.db*` afterwards.

## 3. UI check in headless Chrome (UI changes)

With the server from step 2 running:

```bash
APP_URL=http://127.0.0.1:4399 npm run verify:ui /tmp/acr-shots
```

It needs Google Chrome; set `CHROME_PATH` if it is not at the default macOS location. It
prints a PASS/FAIL line per check, restores every setting it changes, and writes
`ui-running.png`, `ui-detail.png` and `ui-mobile.png` to the given directory. Pass `docs` only
when you mean to refresh the README screenshots. When you add a UI feature, add a check to
`scripts/verify-ui.mjs` and register it in the section list at the bottom.

If Chrome is unavailable, say so and fall back to checking the API and served files with
`curl` — do not report the UI as verified.

## Reporting

State which of the three steps ran and their results, including any failures with output.
