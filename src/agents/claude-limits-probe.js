import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEnv, interpret, parseEvent } from './claude-cli.js';
import { terminate } from './process.js';

/** A reading younger than this is reused: reloads and extra tabs must not each cost a call. */
const MIN_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 30_000;

/**
 * Claude Code reports usage limits only with an API response, so this makes the smallest call
 * there is (Haiku, no tools, nothing saved) and stops as soon as the limits arrive.
 */
export function probeArgs() {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'haiku',
    '--tools', '',
    '--permission-mode', 'dontAsk',
    '--safe-mode',
    '--setting-sources', 'user',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--',
    'Reply with just: ok',
  ];
}

/** Resolves the reported limits, or rejects with why there are none. */
export function readClaudeLimits({ bin = 'claude', timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'acr-limits-'));
    const child = spawn(bin, probeArgs(), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: buildEnv({ workspaceRoot: dir }) });
    let stderr = '';
    let settled = false;
    let cancelKill = null;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
      // The limits are in; the rest of the answer is not needed.
      if (child.exitCode == null) cancelKill = terminate(child);
    };
    const timer = setTimeout(() => settle(reject, new Error('Claude Code did not report its limits in time')), timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const evt = parseEvent(line);
      const limits = evt && interpret(evt).limits;
      if (limits) settle(resolve, limits);
    });
    child.on('error', (err) =>
      settle(reject, new Error(err.code === 'ENOENT' ? `${bin} is not installed or not on PATH` : err.message)),
    );
    child.on('close', (code) => {
      cancelKill?.();
      rmSync(dir, { recursive: true, force: true });
      const why = stderr.trim().split('\n').at(-1) || `exited with code ${code}`;
      settle(reject, new Error(`Claude Code reported no limits (${why})`));
    });
  });
}

/** Refreshes stored limits on demand, at most once per interval; concurrent callers share one call. */
export function createLimitsRefresher({ read, save, now = Date.now, minIntervalMs = MIN_INTERVAL_MS }) {
  let lastAt = -Infinity;
  let pending = null;

  return {
    async refresh() {
      if (pending) return pending;
      if (now() - lastAt < minIntervalMs) return { refreshed: false };
      lastAt = now();
      pending = read()
        .then((limits) => {
          save(limits);
          return { refreshed: true };
        })
        .catch((err) => ({ refreshed: false, error: err.message }))
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
