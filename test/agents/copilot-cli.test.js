import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArgs,
  buildEnv,
  isReasoningEffortRejection,
  parseEvent,
  readResultMetrics,
  summarizeEvent,
} from '../../src/agents/copilot-cli.js';

const base = {
  prompt: 'do a thing',
  workspace: '/tmp/ws/run-1',
  model: 'claude-haiku-4.5',
  sessionId: 'session-1',
};

/** Reads the value that follows a flag, the way the CLI parses argv. */
const valueOf = (args, flag) => args[args.indexOf(flag) + 1];

test('the run is confined to its own workspace and given our session id', () => {
  const args = buildArgs(base);
  assert.equal(valueOf(args, '-C'), '/tmp/ws/run-1');
  assert.equal(valueOf(args, '--session-id'), 'session-1');
  assert.equal(valueOf(args, '--model'), 'claude-haiku-4.5');
  assert.equal(valueOf(args, '-p'), 'do a thing');
});

test('non-interactive defaults are always present', () => {
  const args = buildArgs(base);
  for (const flag of [
    '--allow-all-tools',
    '--log-level',
    '--no-auto-update',
    '--disable-builtin-mcps',
  ]) {
    assert.ok(args.includes(flag), `${flag} is missing`);
  }
  assert.equal(valueOf(args, '--output-format'), 'json');
});

test('"default" reasoning effort omits the flag entirely', () => {
  assert.ok(!buildArgs({ ...base, reasoningEffort: 'default' }).includes('--reasoning-effort'));
  assert.ok(!buildArgs(base).includes('--reasoning-effort'));
  assert.equal(
    valueOf(buildArgs({ ...base, reasoningEffort: 'high' }), '--reasoning-effort'),
    'high',
  );
});

test('permission flags are included in the argv', () => {
  const args = buildArgs({ ...base, permissions: { denied_commands: ['curl'] } });
  assert.ok(args.includes('--deny-tool'));
  assert.ok(args.includes('shell(curl)'));
});

test('the agent working directory is added as an allowed path', () => {
  assert.equal(valueOf(buildArgs({ ...base, workspaceRoot: '/tmp/ws' }), '--add-dir'), '/tmp/ws');
  assert.ok(!buildArgs(base).includes('--add-dir'));
});

test('omitting permissions does not throw', () => {
  assert.doesNotThrow(() => buildArgs(base));
});

test('the environment allows tools without trusting the workspace directory', () => {
  const env = buildEnv({ workspaceRoot: '/tmp/ws' });
  assert.equal(
    env.COPILOT_ALLOW_ALL,
    '1',
    "'true' would additionally trust the cwd and load its skills, plugins and hooks",
  );
});

test('the git ceiling stops an agent walking up into our own repository', () => {
  assert.equal(buildEnv({ workspaceRoot: '/tmp/ws' }).GIT_CEILING_DIRECTORIES, '/tmp/ws');
});

test('a reasoning-effort rejection is recognised from stderr', () => {
  assert.ok(
    isReasoningEffortRejection('Error: Model "x" does not support reasoning effort configuration'),
  );
  assert.ok(!isReasoningEffortRejection('some other failure'));
  assert.ok(!isReasoningEffortRejection(null));
});

test('non-JSON CLI output is ignored rather than fatal', () => {
  assert.equal(parseEvent('npm notice new version available'), null);
  assert.equal(parseEvent(''), null);
  assert.equal(parseEvent('{"type":'), null);
  assert.deepEqual(parseEvent('  {"type":"result"}  '), { type: 'result' });
});

test('tool starts are summarised with the file they touch', () => {
  const summary = summarizeEvent({
    type: 'tool.execution_start',
    data: { toolTitle: 'Creating file', arguments: { path: '/tmp/ws/run-1/notes.md' } },
  });
  assert.deepEqual(summary, { kind: 'tool', summary: 'Creating file: notes.md' });
});

test('a shell tool is summarised with a truncated command', () => {
  const { summary } = summarizeEvent({
    type: 'tool.execution_start',
    data: { toolTitle: 'Running command', arguments: { command: 'echo '.repeat(40) } },
  });
  assert.ok(summary.length <= 'Running command: '.length + 60);
  assert.ok(summary.endsWith('…'));
});

test('a tool without a title still produces something readable', () => {
  assert.deepEqual(summarizeEvent({ type: 'tool.execution_start', data: { toolName: 'grep' } }), {
    kind: 'tool',
    summary: 'Running grep',
  });
});

test('the opaque base64 reasoning blob is filtered out', () => {
  const blob = 'A'.repeat(100) + '+/=';
  assert.equal(summarizeEvent({ type: 'assistant.reasoning', data: { content: blob } }), null);
});

test('real reasoning prose is kept, trimmed to one sentence', () => {
  const { summary } = summarizeEvent({
    type: 'assistant.reasoning',
    data: { content: 'I will create the file. Then I will verify it.' },
  });
  assert.equal(summary, 'I will create the file.');
});

test('an empty reasoning event yields nothing to display', () => {
  assert.equal(summarizeEvent({ type: 'assistant.reasoning', data: { content: '   ' } }), null);
});

test('a successful tool completion adds no noise to the timeline', () => {
  assert.equal(
    summarizeEvent({ type: 'tool.execution_complete', data: { success: true } }).summary,
    null,
  );
  assert.equal(
    summarizeEvent({ type: 'tool.execution_complete', data: { success: false } }).summary,
    'Tool call failed',
  );
});

test('an assistant message with no text falls back to its stated intention', () => {
  const { summary } = summarizeEvent({
    type: 'assistant.message',
    data: { content: '', toolRequests: [{ intentionSummary: 'read the project README' }] },
  });
  assert.equal(summary, 'Read the project README');
});

test('unknown event types are ignored', () => {
  assert.equal(summarizeEvent({ type: 'something.new', data: {} }), null);
  assert.equal(summarizeEvent(null), null);
  assert.equal(summarizeEvent({}), null);
});

test('result metrics are read from the CLI result event', () => {
  const metrics = readResultMetrics({
    type: 'result',
    usage: {
      premiumRequests: 0.33,
      codeChanges: { linesAdded: 3, linesRemoved: 1, filesModified: ['/tmp/a'] },
    },
  });
  assert.deepEqual(metrics, {
    premiumRequests: 0.33,
    linesAdded: 3,
    linesRemoved: 1,
    filesModified: ['/tmp/a'],
  });
});

test('metrics the CLI did not report are null, never zero', () => {
  const metrics = readResultMetrics({ type: 'result' });
  assert.deepEqual(metrics, {
    premiumRequests: null,
    linesAdded: null,
    linesRemoved: null,
    filesModified: null,
  });
});
