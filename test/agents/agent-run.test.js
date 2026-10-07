import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRun } from '../../src/agents/agent-run.js';
import { claudeAdapter } from '../../src/agents/claude-cli.js';
import { Bus } from '../../src/events.js';
import { createStores, tempDir, removeDir, recordEvents } from '../helpers.js';

const FAKE_CLI = fileURLToPath(new URL('../fixtures/fake-copilot.mjs', import.meta.url));
const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));

const SETTINGS = {
  model: 'claude-haiku-4.5',
  max_runtime_minutes: 1,
  reasoning_effort: 'default',
  allowed_tools: ['view', 'create'],
  denied_commands: [],
  secret_env_vars: [],
};

function harness({ prompt = 'write a file', settings = {}, ...overrides } = {}) {
  const root = tempDir('acr-run-');
  const workspaceRoot = join(root, 'workspaces');
  const stores = createStores({ workspaceRoot });
  const bus = new Bus();
  const events = recordEvents(bus);
  const task = stores.tasks.create({ prompt });

  const run = new AgentRun({
    runs: stores.runs,
    tasks: stores.tasks,
    bus,
    task,
    settings: { ...SETTINGS, ...settings },
    workspaceRoot,
    copilotBin: FAKE_CLI,
    usageRetries: 1,
    readUsage: () => null,
    ...overrides,
  });

  return {
    run,
    task,
    stores,
    events,
    root,
    cleanup: () => {
      stores.close();
      removeDir(root);
    },
  };
}

test('a successful run ends as succeeded and marks its task the same way', async () => {
  const h = harness();
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'succeeded');
  const stored = h.stores.runs.get(h.run.runId);
  assert.equal(stored.status, 'succeeded');
  assert.equal(stored.exit_code, 0);
  assert.ok(stored.finished_at);
  assert.equal(h.stores.tasks.get(h.task.id).status, 'succeeded');
  h.cleanup();
});

test('the run works inside its own scratch workspace', async () => {
  const h = harness();
  h.run.start();
  await h.run.exited;

  assert.ok(h.run.workspace.includes(`task-${h.task.id}-`));
  assert.ok(existsSync(join(h.run.workspace, 'out.txt')), 'the fake CLI wrote into the workspace');
  h.cleanup();
});

test('the agent process gets only allow-listed and operator-added variables', async () => {
  process.env.ACR_TEST_PASSED = 'yes';
  process.env.ACR_TEST_HIDDEN = 'no';
  const h = harness({ settings: { passed_env_vars: ['ACR_TEST_PASSED'] } });
  h.run.start();
  await h.run.exited;
  delete process.env.ACR_TEST_PASSED;
  delete process.env.ACR_TEST_HIDDEN;

  const names = JSON.parse(readFileSync(join(h.run.workspace, 'env-names.json'), 'utf8'));
  assert.ok(names.includes('ACR_TEST_PASSED'));
  assert.ok(names.includes('PATH'));
  assert.ok(!names.includes('ACR_TEST_HIDDEN'));
  h.cleanup();
});

test('a failing CLI produces a failed run carrying the stderr tail', async () => {
  const h = harness({ prompt: 'please FAIL now' });
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'failed');
  const stored = h.stores.runs.get(h.run.runId);
  assert.equal(stored.status, 'failed');
  assert.match(stored.error, /simulated failure/);
  assert.equal(h.stores.tasks.get(h.task.id).status, 'failed');
  h.cleanup();
});

test('a run that overruns its limit is timed out, not merely killed', async () => {
  const h = harness({ prompt: 'HANG forever', settings: { max_runtime_minutes: 1 / 60 } });
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'timed_out');
  const stored = h.stores.runs.get(h.run.runId);
  assert.match(stored.error, /Exceeded max runtime/);
  assert.equal(h.stores.tasks.get(h.task.id).status, 'timed_out');
  const summaries = h.stores.runs.listEvents(h.run.runId).map((e) => e.summary);
  assert.ok(!summaries.some((s) => /exit code 0/.test(s)), 'no misleading clean exit');
  assert.match(summaries.at(-1), /runtime limit/);
  assert.equal(h.stores.runs.getResult(h.run.runId).result_text, 'Halfway there.');
  h.cleanup();
});

test('an operator stop is recorded as cancelled even though the CLI exits cleanly', async () => {
  const h = harness({ prompt: 'HANG forever' });
  h.run.start();
  await new Promise((r) => setTimeout(r, 150));
  h.run.stop('cancelled');
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'cancelled');
  assert.equal(h.stores.tasks.get(h.task.id).status, 'cancelled');
  h.cleanup();
});

test('stopping twice is harmless', async () => {
  const h = harness({ prompt: 'HANG forever' });
  h.run.start();
  await new Promise((r) => setTimeout(r, 150));
  h.run.stop('cancelled');
  assert.doesNotThrow(() => h.run.stop('timed_out'));
  assert.equal((await h.run.exited).status, 'cancelled', 'the first reason wins');
  h.cleanup();
});

test('a rejected reasoning effort is retried once without the flag', async () => {
  const h = harness({
    prompt: 'REJECT_EFFORT please',
    settings: { reasoning_effort: 'high' },
  });
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'succeeded', 'the retry must rescue the run');
  assert.ok(h.run.retriedWithoutReasoning);
  const summaries = h.stores.runs.listEvents(h.run.runId).map((e) => e.summary);
  assert.ok(
    summaries.some((s) => /rejected reasoning effort/.test(s)),
    'the retry is visible to the operator',
  );
  h.cleanup();
});

test('the retry happens at most once', async () => {
  // With reasoning_effort already "default" the fixture succeeds, so a retry
  // must not be attempted at all.
  const h = harness({ prompt: 'REJECT_EFFORT please' });
  h.run.start();
  await h.run.exited;
  assert.ok(!h.run.retriedWithoutReasoning);
  h.cleanup();
});

test('activity is streamed to the bus and stored as a timeline', async () => {
  const h = harness();
  h.run.start();
  await h.run.exited;

  const types = h.events.types();
  assert.ok(types.includes('run.started'));
  assert.ok(types.includes('run.activity'));
  assert.ok(types.includes('run.finished'));

  const kinds = h.stores.runs.listEvents(h.run.runId).map((e) => e.kind);
  assert.deepEqual(kinds.slice(0, 2), ['start', 'thinking']);
  assert.ok(kinds.includes('tool'));
  h.cleanup();
});

test('tool calls are counted', async () => {
  const h = harness();
  h.run.start();
  await h.run.exited;
  assert.equal(h.stores.runs.get(h.run.runId).tool_calls, 1);
  h.cleanup();
});

test('code-change metrics from the CLI result are stored', async () => {
  const h = harness();
  h.run.start();
  await h.run.exited;

  const stored = h.stores.runs.get(h.run.runId);
  assert.equal(stored.premium_requests, 0.33);
  assert.equal(stored.lines_added, 1);
  assert.deepEqual(JSON.parse(stored.files_modified), [join(h.run.workspace, 'out.txt')]);
  h.cleanup();
});

test('the final assistant message is stored in the database, not written to disk', async () => {
  const h = harness();
  h.run.start();
  await h.run.exited;

  assert.match(h.stores.runs.getResult(h.run.runId).result_text, /Created out\.txt/);
  assert.deepEqual(readdirSync(h.root), ['workspaces'], 'no result file next to the workspaces');
  h.cleanup();
});

test('a run with no assistant message stores no result rather than an empty one', async () => {
  const h = harness({ prompt: 'please FAIL now' });
  h.run.start();
  await h.run.exited;
  assert.equal(h.stores.runs.getResult(h.run.runId).result_text, null);
  h.cleanup();
});

test('usage is saved and announced when the Copilot store reports it', async () => {
  const usage = { api_calls: 3, input_tokens: 1200, output_tokens: 90, nano_aiu: 2e9 };
  const h = harness({ readUsage: () => usage });
  h.run.start();
  await h.run.exited;

  assert.equal(h.stores.runs.getUsage(h.run.runId).input_tokens, 1200);
  assert.equal(h.events.payload('run.usage').input_tokens, 1200);
  h.cleanup();
});

test('usage that never arrives is announced as unavailable, not as zero', async () => {
  const h = harness({ readUsage: () => null });
  h.run.start();
  await h.run.exited;

  assert.equal(h.stores.runs.getUsage(h.run.runId), null);
  assert.ok(h.events.find('run.usage_unavailable'));
  assert.ok(!h.events.find('run.usage'));
  h.cleanup();
});

test('the run is attributed to a unique session id, which usage is read by', async () => {
  const seen = [];
  const h = harness({ readUsage: (id) => (seen.push(id), null) });
  h.run.start();
  await h.run.exited;

  assert.match(h.run.sessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(seen, [h.run.sessionId]);
  h.cleanup();
});

test('a missing binary fails the run instead of crashing the server', async () => {
  const h = harness({ copilotBin: '/nonexistent/copilot-binary' });
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'failed');
  assert.equal(
    h.stores.runs.get(h.run.runId).error,
    '/nonexistent/copilot-binary is not installed or not on PATH. Install it, set COPILOT_BIN, or switch the AI assistant.',
  );
  h.cleanup();
});

test('a working directory seeded with skills is not shared with the agent', async () => {
  const h = harness();
  mkdirSync(join(h.run.workspaceRoot, '.github', 'skills'), { recursive: true });
  h.run.start();
  await h.run.exited;
  const summaries = h.stores.runs.listEvents(h.run.runId).map((e) => e.summary);
  assert.ok(summaries.some((s) => /access limited to the run workspace/.test(s)));
  h.cleanup();
});

/** The same lifecycle, driven by the Claude Code adapter and its fake CLI. */
const claude = ({ settings = {}, ...rest } = {}) =>
  harness({
    adapter: claudeAdapter,
    claudeBin: FAKE_CLAUDE,
    // Copilot polling must never be consulted for a Claude run.
    readUsage: () => assert.fail('Claude usage comes from the result event'),
    settings: { claude_model: 'opus', claude_effort: 'default', ...settings },
    ...rest,
  });

test('a Claude Code run succeeds and records the assistant, its model and its answer', async () => {
  const h = claude();
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'succeeded');
  const stored = h.stores.runs.get(h.run.runId);
  assert.equal(stored.assistant, 'claude-code');
  assert.equal(stored.model, 'opus');
  assert.equal(stored.tool_calls, 1);
  assert.equal(h.stores.runs.getResult(h.run.runId).result_text, 'Done. Created out.txt with the content hello.');
  assert.ok(existsSync(join(h.run.workspace, 'out.txt')));
  const summaries = h.stores.runs.listEvents(h.run.runId).map((e) => e.summary);
  assert.ok(summaries.includes('Write: out.txt'));
  h.cleanup();
});

test('Claude Code usage and cost are saved straight from its result event', async () => {
  const h = claude();
  h.run.start();
  await h.run.exited;

  const usage = h.stores.runs.getUsage(h.run.runId);
  assert.equal(usage.input_tokens, 1200);
  assert.equal(usage.cache_read_tokens, 3000);
  assert.equal(usage.cost_usd, 0.0421);
  assert.equal(usage.nano_aiu, null, 'Claude runs have no AI Credits');
  assert.equal(h.events.payload('run.usage').cost_usd, 0.0421);
  h.cleanup();
});

test('a Claude Code error result fails the run even though the CLI exits 0', async () => {
  const h = claude({ prompt: 'ERROR_RESULT please' });
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'failed');
  assert.equal(h.stores.runs.get(h.run.runId).error, 'Simulated error during execution');
  assert.equal(h.stores.runs.getUsage(h.run.runId).cost_usd, 0.001, 'a failed run still cost money');
  h.cleanup();
});

test('a failing Claude Code CLI carries its stderr', async () => {
  const h = claude({ prompt: 'please FAIL now' });
  h.run.start();
  const outcome = await h.run.exited;

  assert.equal(outcome.status, 'failed');
  assert.match(h.stores.runs.get(h.run.runId).error, /simulated failure/);
  assert.ok(h.events.find('run.usage_unavailable'));
  h.cleanup();
});

test('a Claude Code run can be stopped and is timed out at its limit', async () => {
  const stopped = claude({ prompt: 'HANG forever' });
  stopped.run.start();
  await new Promise((r) => setTimeout(r, 150));
  stopped.run.stop('cancelled');
  assert.equal((await stopped.run.exited).status, 'cancelled');
  stopped.cleanup();

  const timed = claude({ prompt: 'HANG forever', settings: { max_runtime_minutes: 1 / 60 } });
  timed.run.start();
  assert.equal((await timed.run.exited).status, 'timed_out');
  timed.cleanup();
});

test('the Claude Code agent gets its own environment, without GitHub tokens or secrets', async () => {
  process.env.GH_TOKEN = 'gho_test';
  process.env.ACR_TEST_SECRET = 'x';
  process.env.ACR_TEST_PASSED = 'yes';
  const h = claude({ settings: { secret_env_vars: ['ACR_TEST_SECRET'], passed_env_vars: ['ACR_TEST_PASSED', 'ACR_TEST_SECRET'] } });
  h.run.start();
  await h.run.exited;
  delete process.env.GH_TOKEN;
  delete process.env.ACR_TEST_SECRET;
  delete process.env.ACR_TEST_PASSED;

  const names = JSON.parse(readFileSync(join(h.run.workspace, 'env-names.json'), 'utf8'));
  assert.ok(names.includes('ACR_TEST_PASSED'));
  assert.ok(names.includes('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'));
  assert.ok(!names.includes('GH_TOKEN'));
  assert.ok(!names.includes('ACR_TEST_SECRET'));
  h.cleanup();
});

test('a missing claude binary names CLAUDE_BIN in its error', async () => {
  const h = claude({ claudeBin: '/nonexistent/claude' });
  h.run.start();
  await h.run.exited;
  assert.match(h.stores.runs.get(h.run.runId).error, /\/nonexistent\/claude is not installed .* set CLAUDE_BIN/);
  h.cleanup();
});
