import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COPILOT_DOMAINS,
  copilotAdapter,
  osSandbox,
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

test('a run works only in its own workspace; no other directory is added', () => {
  const args = buildArgs({ ...base, workspaceRoot: '/tmp/ws' });
  assert.equal(valueOf(args, '-C'), base.workspace);
  assert.ok(!args.includes('--add-dir'));
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

test('the agent gets only what the CLI needs, not our whole environment', () => {
  const env = buildEnv({
    workspaceRoot: '/tmp/ws',
    env: {
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      XDG_CONFIG_HOME: '/Users/me/.config',
      https_proxy: 'http://proxy:3128',
      COPILOT_HOME: '/Users/me/.copilot',
      GH_TOKEN: 'gho_x',
      AWS_SECRET_ACCESS_KEY: 'aws',
      OPENAI_API_KEY: 'sk',
      SSH_AUTH_SOCK: '/tmp/ssh',
      NPM_TOKEN: 'npm',
      DB_FILE: '/data/x.db',
    },
  });
  assert.deepEqual(Object.keys(env).sort(), [
    'COPILOT_ALLOW_ALL',
    'COPILOT_HOME',
    'GH_TOKEN',
    'GIT_CEILING_DIRECTORIES',
    'HOME',
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'PATH',
    'XDG_CONFIG_HOME',
    'https_proxy',
  ]);
});

test('operator-added names are passed too, whatever their case', () => {
  const env = buildEnv({
    workspaceRoot: '/tmp/ws',
    passedEnvVars: ['java_home', 'GOPATH'],
    env: { JAVA_HOME: '/jdk', GOPATH: '/go', AWS_SECRET_ACCESS_KEY: 'aws' },
  });
  assert.equal(env.JAVA_HOME, '/jdk');
  assert.equal(env.GOPATH, '/go');
  assert.ok(!('AWS_SECRET_ACCESS_KEY' in env));
});

test('our own settings override anything inherited', () => {
  const env = buildEnv({ workspaceRoot: '/tmp/ws', env: { COPILOT_ALLOW_ALL: 'true', PATH: '/bin' } });
  assert.equal(env.COPILOT_ALLOW_ALL, '1');
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

test('Copilot runs in a sandbox: its own folder, its API and the allowed websites only', () => {
  const policy = osSandbox(
    { shell_allowed_domains: ['https://registry.npmjs.org/'], blocked_urls: ['evil.org'] },
    { workspace: '/w/run', bin: '/nonexistent/copilot', env: { PATH: '' }, home: '/Users/me' },
  );
  assert.deepEqual(policy.filesystem, {
    denyRead: ['~/'],
    allowRead: ['/w/run', '/Users/me/.copilot'],
    allowWrite: ['/w/run', '/Users/me/.copilot'],
    denyWrite: [],
  });
  assert.deepEqual(policy.network.allowedDomains, [...COPILOT_DOMAINS, 'registry.npmjs.org']);
  assert.deepEqual(policy.network.deniedDomains, ['evil.org']);
});

test('COPILOT_HOME moves the folder Copilot may use', () => {
  const policy = osSandbox({}, { workspace: '/w', bin: 'copilot', env: { PATH: '', COPILOT_HOME: '/data/copilot' }, home: '/Users/me' });
  assert.deepEqual(policy.filesystem.allowWrite, ['/w', '/data/copilot']);
});

test('a Copilot tool call reports the sites it targets, and whether it failed', () => {
  const start = copilotAdapter.interpret({ type: 'tool.execution_start', data: { toolCallId: 't9', toolName: 'bash', arguments: { command: 'curl https://www.bbc.co.uk/news' } } });
  assert.deepEqual(start.toolStarts, [{ id: 't9', sites: ['www.bbc.co.uk'] }]);
  assert.deepEqual(copilotAdapter.interpret({ type: 'tool.execution_complete', data: { toolCallId: 't9', success: false } }).toolEnds, [{ id: 't9', failed: true }]);
  assert.deepEqual(copilotAdapter.interpret({ type: 'tool.execution_complete', data: { toolCallId: 't9', success: true } }).toolEnds, [{ id: 't9', failed: false }]);
});
