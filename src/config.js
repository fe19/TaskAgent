import { resolve } from 'node:path';

/** Every environment-dependent value, resolved once. */
export function loadConfig(overrides = {}) {
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 4317),
    dbFile: process.env.DB_FILE ?? resolve(process.cwd(), 'data', 'control-room.db'),
    webDir: resolve(import.meta.dirname, '..', 'web'),
    domainDir: resolve(import.meta.dirname, 'domain'),
    // Normally a runtime setting; tests pin it here.
    workspaceRoot: undefined,
    copilotBin: process.env.COPILOT_BIN || 'copilot',
    ghBin: process.env.GH_BIN || 'gh',
    ...overrides,
  };
}
