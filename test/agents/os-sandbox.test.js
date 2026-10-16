import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installRoot, resolveBinary, sandboxPolicy, wrapCommand, writePolicy } from '../../src/agents/os-sandbox.js';
import { tempDir, removeDir } from '../helpers.js';

test('the policy denies the home folder and allows only what is listed', () => {
  assert.deepEqual(
    sandboxPolicy({ workspace: '/w/run', readable: ['/h/.copilot'], writable: ['/h/.copilot'], allowedDomains: ['a.com'], deniedDomains: ['b.com'] }),
    {
      network: { allowedDomains: ['a.com'], deniedDomains: ['b.com'], allowLocalBinding: false },
      filesystem: { denyRead: ['~/'], allowRead: ['/w/run', '/h/.copilot'], allowWrite: ['/w/run', '/h/.copilot'], denyWrite: [] },
    },
  );
});

test('the agent runs as srt --settings <policy> <bin> <args>', () => {
  assert.deepEqual(wrapCommand({ srtBin: 'srt', bin: 'copilot', args: ['-p', 'hi'], policyFile: '/tmp/p.json' }), {
    bin: 'srt',
    args: ['--settings', '/tmp/p.json', 'copilot', '-p', 'hi'],
  });
});

test('the policy file is private to this user and removed afterwards', () => {
  const policy = writePolicy({ network: {} });
  assert.deepEqual(JSON.parse(readFileSync(policy.file, 'utf8')), { network: {} });
  assert.equal(statSync(policy.file).mode & 0o777, 0o600);
  policy.remove();
  assert.equal(existsSync(policy.file), false);
});

test('a binary is found on PATH with symlinks resolved, or not at all', () => {
  const dir = tempDir('acr-bin-');
  mkdirSync(join(dir, 'real'));
  writeFileSync(join(dir, 'real', 'tool'), '');
  mkdirSync(join(dir, 'bin'));
  symlinkSync(join(dir, 'real', 'tool'), join(dir, 'bin', 'tool'));
  assert.equal(resolveBinary('tool', join(dir, 'bin')), join(dir, 'real', 'tool'));
  assert.equal(resolveBinary('missing', join(dir, 'bin')), null);
  assert.equal(resolveBinary(join(dir, 'real', 'tool')), join(dir, 'real', 'tool'));
  removeDir(dir);
});

test('install roots under home become readable; never home itself, nothing outside it', () => {
  const home = '/Users/me';
  assert.equal(installRoot('/Users/me/.nvm/versions/node/v22/lib/node_modules/@github/copilot/index.js', home), '/Users/me/.nvm/versions/node/v22');
  assert.equal(installRoot('/Users/me/.nvm/versions/node/v22/bin/node', home), '/Users/me/.nvm/versions/node/v22');
  assert.equal(installRoot('/Users/me/bin/tool', home), null, 'would be the whole home folder');
  assert.equal(installRoot('/opt/homebrew/bin/node', home), null, 'outside home: readable anyway');
  assert.equal(installRoot(null, home), null);
});
