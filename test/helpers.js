import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/store/database.js';
import { createSettingsStore } from '../src/store/settings-store.js';
import { createTaskStore } from '../src/store/task-store.js';
import { createRunStore } from '../src/store/run-store.js';

export function tempDir(prefix = 'acr-test-') {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function createStores({
  workspaceRoot = join(tmpdir(), 'acr-test-workspace'),
  resolvePath,
} = {}) {
  const db = openDatabase(':memory:');
  return {
    db,
    settings: createSettingsStore({
      db,
      defaultWorkspaceRoot: workspaceRoot,
      resolvePath: resolvePath ?? ((v) => String(v)),
    }),
    tasks: createTaskStore({ db }),
    runs: createRunStore({ db }),
    close: () => db.close(),
  };
}

/** Collects every bus event so a test can assert on what was published. */
export function recordEvents(bus) {
  const seen = [];
  bus.on('event', (e) => seen.push(e));
  return {
    types: () => seen.map((e) => e.type),
    payload: (type) => seen.find((e) => e.type === type)?.payload ?? null,
    find: (type) => seen.find((e) => e.type === type) ?? null,
    all: seen,
  };
}

export const waitFor = async (predicate, { timeout = 5000, interval = 20 } = {}) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Timed out waiting for condition');
};
