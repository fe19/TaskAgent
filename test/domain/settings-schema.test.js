import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSettings, validateSettings, SETTING_SPEC } from '../../src/domain/settings-schema.js';

const resolvePath = (v) => {
  if (!String(v ?? '').startsWith('/')) throw new Error('workspace_root must be an absolute path');
  return String(v).replace(/\/+$/, '');
};

test('decodeSettings types every field and hands lists out as arrays', () => {
  const settings = decodeSettings(
    {
      max_concurrent_agents: '3',
      max_runtime_minutes: '2',
      model: 'claude-haiku-4.5',
      reasoning_effort: 'default',
      auto_dispatch: 'true',
      allowed_tools: 'view,bash',
      denied_commands: '',
      secret_env_vars: 'A, B',
      passed_env_vars: 'JAVA_HOME',
    },
    { defaultWorkspaceRoot: '/tmp/ws' },
  );

  assert.equal(settings.max_concurrent_agents, 3);
  assert.equal(settings.max_runtime_minutes, 2);
  assert.equal(settings.auto_dispatch, true);
  assert.deepEqual(settings.allowed_tools, ['view', 'bash']);
  assert.deepEqual(settings.denied_commands, []);
  assert.deepEqual(settings.secret_env_vars, ['A', 'B']);
  assert.deepEqual(settings.passed_env_vars, ['JAVA_HOME']);
});

test('passed env vars must be valid names', () => {
  assert.deepEqual(validateSettings({ passed_env_vars: 'JAVA_HOME, GOPATH' }).values, {
    passed_env_vars: 'JAVA_HOME,GOPATH',
  });
  assert.equal(validateSettings({ passed_env_vars: 'OK, 1BAD' }).errors.length, 1);
});

test('auto_dispatch is only true for the exact string "true"', () => {
  const decode = (v) => decodeSettings({ auto_dispatch: v }, { defaultWorkspaceRoot: '/x' });
  assert.equal(decode('true').auto_dispatch, true);
  assert.equal(decode('false').auto_dispatch, false);
  assert.equal(decode(undefined).auto_dispatch, false);
});

test('assistant defaults to GitHub Copilot; Claude Code is selectable, preview assistants are rejected', () => {
  assert.equal(decodeSettings({}, { defaultWorkspaceRoot: '/x' }).assistant, 'copilot');
  assert.deepEqual(validateSettings({ assistant: 'copilot' }).values, { assistant: 'copilot' });
  assert.deepEqual(validateSettings({ assistant: 'claude-code' }).values, { assistant: 'claude-code' });
  assert.match(validateSettings({ assistant: 'codex' }).errors[0], /Codex is in preview/);
  assert.match(validateSettings({ assistant: 'other' }).errors[0], /must be one of/);
  assert.deepEqual(SETTING_SPEC.assistant.values, ['copilot', 'claude-code']);
});

test('Claude Code has its own model and effort, separate from Copilot\'s', () => {
  assert.deepEqual(validateSettings({ claude_model: 'opus', claude_effort: 'xhigh' }).values, {
    claude_model: 'opus',
    claude_effort: 'xhigh',
  });
  assert.equal(validateSettings({ claude_model: 'gpt-5.4' }).errors.length, 1);
  assert.equal(validateSettings({ claude_effort: 'minimal' }).errors.length, 1);
  const decoded = decodeSettings({ claude_model: 'haiku', claude_effort: 'max' }, { defaultWorkspaceRoot: '/x' });
  assert.deepEqual([decoded.claude_model, decoded.claude_effort], ['haiku', 'max']);
});

test('workspace_root falls back to the default when unset', () => {
  const decoded = decodeSettings({}, { defaultWorkspaceRoot: '/tmp/fallback' });
  assert.equal(decoded.workspace_root, '/tmp/fallback');
});

test('validateSettings returns errors instead of throwing', () => {
  const { values, errors } = validateSettings({ max_concurrent_agents: 99 });
  assert.deepEqual(values, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /between 1 and 8/);
});

test('out-of-range and non-integer numbers are rejected', () => {
  for (const bad of [0, 9, 2.5, 'abc', null]) {
    const { errors } = validateSettings({ max_concurrent_agents: bad });
    assert.equal(errors.length, 1, `${bad} should be rejected`);
  }
});

test('unknown keys are reported rather than silently written', () => {
  const { values, errors } = validateSettings({ shell_access: true });
  assert.deepEqual(values, {});
  assert.match(errors[0], /Unknown setting: shell_access/);
});

test('enum fields accept only listed values', () => {
  assert.equal(validateSettings({ model: 'claude-haiku-4.5' }).errors.length, 0);
  assert.match(validateSettings({ model: 'gpt-fake' }).errors[0], /must be one of/);
});

test('booleans are stored as the strings "true"/"false"', () => {
  assert.equal(validateSettings({ auto_dispatch: true }).values.auto_dispatch, 'true');
  assert.equal(validateSettings({ auto_dispatch: 'false' }).values.auto_dispatch, 'false');
  assert.match(validateSettings({ auto_dispatch: 'yes' }).errors[0], /must be true or false/);
});

test('an empty tool list is rejected because the agent could do nothing', () => {
  const { errors } = validateSettings({ allowed_tools: [] });
  assert.match(errors[0], /At least one tool/);
});

test('unknown tools are named in the error', () => {
  const { errors } = validateSettings({ allowed_tools: ['view', 'telepathy'] });
  assert.match(errors[0], /telepathy/);
});

test('invalid env var names are named in the error', () => {
  const { errors } = validateSettings({ secret_env_vars: 'OK, 1BAD' });
  assert.match(errors[0], /1BAD/);
});

test('several bad fields are all reported at once', () => {
  const { errors } = validateSettings({ max_concurrent_agents: 0, model: 'nope' });
  assert.equal(errors.length, 2);
});

test('path fields are delegated to the injected resolver', () => {
  const { values, errors } = validateSettings({ workspace_root: '/tmp/agents/' }, { resolvePath });
  assert.deepEqual(errors, []);
  assert.equal(values.workspace_root, '/tmp/agents');
});

test('a resolver rejection becomes a validation error, not a crash', () => {
  const { errors } = validateSettings({ workspace_root: 'relative/path' }, { resolvePath });
  assert.match(errors[0], /absolute path/);
});

test('validating a path without a resolver is a programming error', () => {
  assert.throws(
    () => validateSettings({ workspace_root: '/tmp/x' }),
    /needs a resolvePath/,
    'the domain layer must never reach for the filesystem itself',
  );
});

test('every spec entry has a validator type the validator understands', () => {
  const known = new Set(['int', 'enum', 'bool', 'path', 'tools', 'list', 'env-names', 'assistant', 'urls', 'decimal']);
  for (const [key, spec] of Object.entries(SETTING_SPEC)) {
    assert.ok(known.has(spec.type), `${key} has unhandled type ${spec.type}`);
  }
});

test('usd_per_aic accepts decimals within range and defaults to the list price', () => {
  assert.equal(validateSettings({ usd_per_aic: 0.012 }).values.usd_per_aic, '0.012');
  assert.equal(validateSettings({ usd_per_aic: '0' }).values.usd_per_aic, '0');
  for (const bad of ['', 'abc', -1, 101]) {
    assert.match(validateSettings({ usd_per_aic: bad }).errors[0], /usd_per_aic must be a number/);
  }
  assert.equal(decodeSettings({}, { defaultWorkspaceRoot: '/x' }).usd_per_aic, 0.01);
  assert.equal(decodeSettings({ usd_per_aic: '0.02' }, { defaultWorkspaceRoot: '/x' }).usd_per_aic, 0.02);
});
