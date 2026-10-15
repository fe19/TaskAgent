import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_TOOLS,
  CORE_DENIED_COMMANDS,
  CORE_SECRET_ENV_VARS,
  enforcedGuarantees,
  TOOL_IDS,
  DEFAULT_TOOL_IDS,
  invalidUrlPatterns,
  effectiveDeniedCommands,
  invalidEnvNames,
  parseList,
  permissionArgs,
  serializeList,
} from '../../src/domain/permissions.js';

test('parseList accepts commas, newlines, arrays and junk whitespace', () => {
  assert.deepEqual(parseList('a, b ,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseList('a\nb\n\n'), ['a', 'b']);
  assert.deepEqual(parseList(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseList(null), []);
  assert.deepEqual(parseList('  '), []);
});

test('serializeList round-trips through the stored comma form', () => {
  assert.equal(serializeList(['git push', ' gh ']), 'git push,gh');
  assert.deepEqual(parseList(serializeList(['a', 'b'])), ['a', 'b']);
});

test('invalidEnvNames rejects anything that is not an identifier', () => {
  assert.deepEqual(invalidEnvNames('GITHUB_TOKEN, AWS_KEY'), []);
  assert.deepEqual(invalidEnvNames('GOOD, 1BAD, also-bad'), ['1BAD', 'also-bad']);
});

test('core denied commands are always present and never duplicated', () => {
  assert.deepEqual(effectiveDeniedCommands(''), CORE_DENIED_COMMANDS);
  assert.deepEqual(effectiveDeniedCommands('git push'), CORE_DENIED_COMMANDS);
  assert.deepEqual(effectiveDeniedCommands('curl'), [...CORE_DENIED_COMMANDS, 'curl']);
});

test('permissionArgs passes the allow-list through to --available-tools', () => {
  const args = permissionArgs({ allowed_tools: ['view', 'grep'] });
  const start = args.indexOf('--available-tools');
  assert.equal(args[start + 1], 'view');
  assert.equal(args[start + 2], 'grep');
  assert.ok(!args.includes('bash'), 'bash must not be granted when it was not allowed');
});

test('permissionArgs drops unknown tools rather than passing them to the CLI', () => {
  const args = permissionArgs({ allowed_tools: ['view', 'telepathy'] });
  assert.ok(!args.includes('telepathy'));
});

test('an empty allow-list falls back to the default tools instead of a useless agent', () => {
  const args = permissionArgs({ allowed_tools: [] });
  for (const id of DEFAULT_TOOL_IDS) assert.ok(args.includes(id), `${id} should be granted`);
  assert.ok(!args.includes('web_fetch'), 'web access is opt-in');
});

test('web access is a tool, off by default', () => {
  assert.ok(TOOL_IDS.includes('web_fetch'));
  assert.ok(!DEFAULT_TOOL_IDS.includes('web_fetch'));
  assert.ok(permissionArgs({ allowed_tools: ['view', 'web_fetch'] }).includes('web_fetch'));
});

test('blocked websites become --deny-url flags; bare wildcards are rejected', () => {
  const args = permissionArgs({ blocked_urls: 'example.com, https://*.example.org' });
  assert.deepEqual(
    args.filter((a, i) => args[i - 1] === '--deny-url'),
    ['example.com', 'https://*.example.org'],
  );
  assert.ok(!permissionArgs({}).includes('--deny-url'));
  assert.deepEqual(invalidUrlPatterns('example.com, http://a.b:8080/x, *, https://*, not a url'), ['*', 'https://*', 'not a url']);
});

test('every denied command becomes a shell deny-tool flag', () => {
  const args = permissionArgs({ allowed_tools: TOOL_IDS, denied_commands: 'curl' });
  for (const command of [...CORE_DENIED_COMMANDS, 'curl']) {
    const at = args.indexOf(`shell(${command})`);
    assert.ok(at > 0, `${command} should be denied`);
    assert.equal(args[at - 1], '--deny-tool');
  }
});

const secretsOf = (args) => args[args.indexOf('--secret-env-vars') + 1].split(',');

test('GitHub tokens are always secret, even with no operator secrets', () => {
  assert.deepEqual(secretsOf(permissionArgs({})), CORE_SECRET_ENV_VARS);
});

test('operator secrets are added by name to the core ones, without duplicates', () => {
  assert.deepEqual(secretsOf(permissionArgs({ secret_env_vars: 'GITHUB_TOKEN, AWS_KEY' })), [
    ...CORE_SECRET_ENV_VARS,
    'AWS_KEY',
  ]);
});

test('permissionArgs tolerates being called with nothing at all', () => {
  assert.ok(permissionArgs().includes('--available-tools'));
});

test('every advertised tool has a label and a hint', () => {
  for (const tool of AVAILABLE_TOOLS) {
    assert.ok(tool.id && tool.label && tool.hint, `${tool.id} is incompletely described`);
  }
});

test('guarantees promise only what each assistant enforces', () => {
  const claude = enforcedGuarantees('claude-code').join('\n');
  const copilot = enforcedGuarantees('copilot').join('\n');
  assert.match(claude, /OS sandbox/);
  assert.match(copilot, /NOT sandboxed/);
  assert.doesNotMatch(copilot, /OS sandbox/);
  // Text-matched command blocks are a guard rail; both lists say so.
  for (const list of [claude, copilot]) assert.match(list, /guard rail, not a boundary/);
  assert.doesNotMatch(`${claude}\n${copilot}`, /need approval and are denied|cannot see/);
});
