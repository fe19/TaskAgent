import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkspace,
  defaultWorkspaceRoot,
  hasTrustedConfig,
  resolveWorkspaceRoot,
} from '../../src/agents/workspace.js';
import { tempDir, removeDir } from '../helpers.js';

test('a valid root is resolved to an absolute path and created', () => {
  const dir = tempDir();
  const target = join(dir, 'nested', 'agents');
  assert.equal(resolveWorkspaceRoot(target), target);
  assert.ok(existsSync(target), 'the directory is created if it does not exist');
  removeDir(dir);
});

test('a leading ~ is expanded to the home directory', () => {
  const previousHome = process.env.HOME;
  const home = tempDir('acr-home-');
  process.env.HOME = home;
  try {
    assert.equal(resolveWorkspaceRoot('~/agents'), join(home, 'agents'));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    removeDir(home);
  }
});

test('an empty or relative path is rejected', () => {
  assert.throws(() => resolveWorkspaceRoot(''), /must not be empty/);
  assert.throws(() => resolveWorkspaceRoot('   '), /must not be empty/);
  assert.throws(() => resolveWorkspaceRoot(null), /must not be empty/);
  assert.throws(() => resolveWorkspaceRoot('relative/path'), /absolute/);
});

test('dangerous roots are refused so an agent cannot be pointed at the system', () => {
  for (const risky of ['/', '/etc', '/System', '/Library', '/Applications', '/var', '/tmp']) {
    assert.throws(() => resolveWorkspaceRoot(risky), /workspace_root/, risky);
  }
});

test('the home directory itself and its parents are refused', () => {
  assert.throws(() => resolveWorkspaceRoot(homedir()), /use a subdirectory/);
  assert.throws(() => resolveWorkspaceRoot('/Users'), /must not be/);
});

test('a path that is a file, not a directory, is rejected', () => {
  const dir = tempDir();
  const file = join(dir, 'a-file');
  writeFileSync(file, 'x');
  assert.throws(() => resolveWorkspaceRoot(file), /could not be created|must be a directory/);
  removeDir(dir);
});

test('a read-only directory is rejected before any agent is launched', () => {
  const dir = tempDir();
  const target = join(dir, 'locked');
  mkdirSync(target, { mode: 0o500 });
  assert.throws(() => resolveWorkspaceRoot(target), /not writable/);
  removeDir(dir);
});

test('each run gets its own directory, named after the task', () => {
  const root = tempDir();
  const ws = createWorkspace(root, { taskId: 7, sessionId: 'abcdefgh-1234-5678' });
  assert.equal(ws, join(root, 'task-7-abcdefgh'));
  assert.ok(existsSync(ws));
  removeDir(root);
});

test('two runs of the same task do not collide', () => {
  const root = tempDir();
  const a = createWorkspace(root, { taskId: 7, sessionId: 'aaaaaaaa-1' });
  const b = createWorkspace(root, { taskId: 7, sessionId: 'bbbbbbbb-2' });
  assert.notEqual(a, b);
  removeDir(root);
});

test('the default root sits under the current working directory', () => {
  assert.equal(defaultWorkspaceRoot(), join(process.cwd(), 'workspaces'));
});

test('a root with .github/skills or agents counts as holding trusted config', () => {
  const root = tempDir('acr-trust-');
  assert.equal(hasTrustedConfig(root), false);
  mkdirSync(join(root, '.github', 'agents'), { recursive: true });
  assert.equal(hasTrustedConfig(root), true);
  removeDir(root);
});
