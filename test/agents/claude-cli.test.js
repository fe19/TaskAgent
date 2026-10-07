import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, buildEnv, interpret, parseEvent, parseRateLimits, toolArgs } from '../../src/agents/claude-cli.js';

const base = {
  prompt: 'do a thing',
  workspace: '/tmp/ws/run-1',
  workspaceRoot: '/tmp/ws',
  model: 'sonnet',
  sessionId: '00000000-0000-4000-8000-000000000000',
  reasoningEffort: 'default',
  permissions: { allowed_tools: ['view', 'edit', 'bash'], denied_commands: [], blocked_urls: [] },
};

/** Values of a variadic flag: everything up to the next `--option`. */
function values(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const out = [];
  for (const a of args.slice(i + 1)) {
    if (a.startsWith('--')) break;
    out.push(a);
  }
  return out;
}

test('runs headless with streamed JSON, our session id and the model', () => {
  const args = buildArgs(base);
  assert.equal(args[0], '-p');
  assert.deepEqual(values(args, '--output-format'), ['stream-json']);
  assert.ok(args.includes('--verbose'), 'stream-json needs --verbose with -p');
  assert.deepEqual(values(args, '--session-id'), [base.sessionId]);
  assert.deepEqual(values(args, '--model'), ['sonnet']);
});

test('the prompt comes last, after --, so a leading dash is not an option', () => {
  const args = buildArgs({ ...base, prompt: '--dangerously-skip-permissions please' });
  assert.deepEqual(args.slice(-2), ['--', '--dangerously-skip-permissions please']);
});

test('nothing prompts: dontAsk denies whatever is not allowed', () => {
  assert.deepEqual(values(buildArgs(base), '--permission-mode'), ['dontAsk']);
  assert.ok(!buildArgs(base).includes('--dangerously-skip-permissions'));
});

test('the workspace is untrusted and MCP servers are off', () => {
  const args = buildArgs(base);
  assert.ok(args.includes('--safe-mode'));
  assert.deepEqual(values(args, '--setting-sources'), ['user']);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(!args.includes('--mcp-config'));
});

test('effort is passed unless it is the model default', () => {
  assert.ok(!buildArgs(base).includes('--effort'));
  assert.deepEqual(values(buildArgs({ ...base, reasoningEffort: 'xhigh' }), '--effort'), ['xhigh']);
});

test('the shared root is added only when given', () => {
  assert.deepEqual(values(buildArgs(base), '--add-dir'), ['/tmp/ws']);
  assert.ok(!buildArgs({ ...base, workspaceRoot: null }).includes('--add-dir'));
});

test('only the selected tools exist, mapped to Claude Code names', () => {
  const args = toolArgs({ allowed_tools: ['view', 'edit', 'bash'] }, { workspace: '/w' });
  assert.deepEqual(values(args, '--tools'), ['Read,Edit,NotebookEdit,Bash']);
  const web = toolArgs({ allowed_tools: ['web_fetch'] }, { workspace: '/w' });
  assert.deepEqual(values(web, '--tools'), ['WebFetch,WebSearch']);
});

test('file tools are allowed only inside the workspace and the shared root', () => {
  const allowed = values(toolArgs({ allowed_tools: ['view', 'create', 'edit', 'bash'] }, { workspace: '/w/run', workspaceRoot: '/w' }), '--allowedTools');
  assert.deepEqual(allowed, ['Read(//w/run/**)', 'Read(//w/**)', 'Edit(//w/run/**)', 'Edit(//w/**)', 'Bash']);
});

test('core and operator denies become Bash rules; blocked sites become WebFetch domain rules', () => {
  const denied = values(
    toolArgs({ allowed_tools: ['bash'], denied_commands: ['curl'], blocked_urls: ['https://*.example.com/x', 'evil.org'] }, { workspace: '/w' }),
    '--disallowedTools',
  );
  for (const rule of ['Bash(git push)', 'Bash(git push *)', 'Bash(gh)', 'Bash(gh *)', 'Bash(git remote *)', 'Bash(curl *)']) {
    assert.ok(denied.includes(rule), rule);
  }
  assert.ok(denied.includes('WebFetch(domain:*.example.com)'));
  assert.ok(denied.includes('WebFetch(domain:evil.org)'));
});

test('an empty tool list falls back to the default tools', () => {
  assert.deepEqual(values(toolArgs({ allowed_tools: [] }, { workspace: '/w' }), '--tools'), [
    'Read,Write,Edit,NotebookEdit,Bash,Glob,Grep',
  ]);
});

test('the environment keeps Claude sign-in, drops GitHub tokens and operator secrets', () => {
  const env = buildEnv({
    workspaceRoot: '/tmp/ws',
    secretEnvVars: ['MY_SECRET'],
    passedEnvVars: ['JAVA_HOME'],
    env: {
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-ant',
      CLAUDE_CONFIG_DIR: '/c',
      GH_TOKEN: 'gho',
      GITHUB_TOKEN: 'ghp',
      COPILOT_HOME: '/cp',
      MY_SECRET: 's',
      JAVA_HOME: '/jdk',
      AWS_SECRET_ACCESS_KEY: 'aws',
    },
  });
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/c');
  assert.equal(env.JAVA_HOME, '/jdk');
  for (const hidden of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_HOME', 'MY_SECRET', 'AWS_SECRET_ACCESS_KEY']) {
    assert.ok(!(hidden in env), hidden);
  }
  assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1', 'its API key is scrubbed from the shell');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/tmp/ws');
});

test('a secret wins over an explicit pass-through', () => {
  const env = buildEnv({ workspaceRoot: '/w', passedEnvVars: ['X'], secretEnvVars: ['X'], env: { X: '1' } });
  assert.ok(!('X' in env));
});

test('non-JSON output is ignored', () => {
  assert.equal(parseEvent('warning: something'), null);
  assert.equal(parseEvent('{broken'), null);
  assert.deepEqual(parseEvent('{"type":"system"}'), { type: 'system' });
});

test('an assistant message yields thinking, tool calls and the text as activities', () => {
  const facts = interpret({
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'First I look around. Then more.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/w/src/app.js' } },
        { type: 'text', text: 'All done.' },
      ],
    },
  });
  assert.equal(facts.toolCalls, 2);
  assert.equal(facts.message, 'All done.');
  assert.deepEqual(
    facts.activities.map((a) => a.summary),
    ['First I look around.', 'Bash: ls -la', 'Edit: app.js', 'All done.'],
  );
});

test('a failed tool result is reported', () => {
  const facts = interpret({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true }] } });
  assert.equal(facts.activities[0].summary, 'Tool call failed');
  assert.deepEqual(interpret({ type: 'user', message: { content: [{ type: 'tool_result' }] } }), {});
});

test('the result carries usage, cost and the final answer', () => {
  const facts = interpret({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'The answer.',
    num_turns: 3,
    duration_api_ms: 900,
    total_cost_usd: 0.12,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
    modelUsage: { 'claude-sonnet-5-5': {}, 'claude-haiku-4-5-20251001': {} },
    permission_denials: [{ tool_name: 'Bash' }],
  });
  assert.equal(facts.message, 'The answer.');
  assert.equal(facts.error, undefined);
  assert.deepEqual(facts.usage, {
    api_calls: 3,
    input_tokens: 10,
    output_tokens: 20,
    cache_read_tokens: 30,
    cache_write_tokens: 40,
    cost_usd: 0.12,
    api_duration_ms: 900,
    model: 'claude-sonnet-5-5, claude-haiku-4-5-20251001',
  });
  assert.deepEqual(
    facts.activities.map((a) => a.summary),
    ['1 tool call denied by permissions', 'Finished'],
  );
});

test('an error result is an error even though usage is still reported', () => {
  const facts = interpret({ type: 'result', subtype: 'error_max_turns', is_error: true, usage: {} });
  assert.equal(facts.error, 'Claude Code ended with error_max_turns');
  assert.ok(facts.usage);
});

test('unknown events are ignored', () => {
  assert.deepEqual(interpret({ type: 'stream_event' }), {});
  assert.deepEqual(interpret({ type: 'system', subtype: 'compact_boundary' }), {});
});

test('a rate-limit event yields each window with its share used and reset time', () => {
  const facts = interpret({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: 1791395400,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: 0.03, resetsAt: 1791395400 },
        seven_day: { utilization: 0.05, resetsAt: 1791640800 },
      },
    },
  });
  assert.deepEqual(facts.limits, {
    status: 'allowed',
    windows: [
      { id: 'five_hour', utilization: 0.03, resets_at: new Date(1791395400 * 1000).toISOString() },
      { id: 'seven_day', utilization: 0.05, resets_at: new Date(1791640800 * 1000).toISOString() },
    ],
  });
});

test('without unified windows the single reported window is used', () => {
  assert.deepEqual(parseRateLimits({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.9, resetsAt: 0 }), {
    status: 'allowed_warning',
    windows: [{ id: 'seven_day', utilization: 0.9, resets_at: new Date(0).toISOString() }],
  });
  assert.equal(parseRateLimits(null), null);
  assert.deepEqual(interpret({ type: 'rate_limit_event' }), {});
});
