import { mkdirSync, accessSync, existsSync, statSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

export function defaultWorkspaceRoot() {
  return resolve(process.cwd(), 'workspaces');
}

const FORBIDDEN_ROOTS = ['/Users', '/System', '/Library', '/Applications', '/etc', '/var', '/tmp'];

function pathRejection(dir) {
  const home = homedir();
  if (dir === sep) return 'must not be the filesystem root';
  if (dir === home) return 'must not be your home directory itself — use a subdirectory';
  if (home.startsWith(`${dir}${sep}`)) return 'must not be a parent of your home directory';
  for (const risky of FORBIDDEN_ROOTS) {
    if (dir === risky) return `must not be ${risky}`;
  }
  return null;
}

/** Validates, creates and returns the workspace root. Throws operator-facing messages. */
export function resolveWorkspaceRoot(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('workspace_root must not be empty');

  const expanded = raw.startsWith('~') ? raw.replace(/^~/, homedir()) : raw;
  if (!isAbsolute(expanded)) throw new Error('workspace_root must be an absolute path');

  const dir = resolve(expanded);
  const rejection = pathRejection(dir);
  if (rejection) throw new Error(`workspace_root ${rejection}`);

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`workspace_root could not be created: ${err.message}`);
  }
  if (!statSync(dir).isDirectory()) throw new Error('workspace_root must be a directory');
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error('workspace_root is not writable');
  }

  return dir;
}

/** One directory per run, named so an operator can match it to the board. */
export function createWorkspace(root, { taskId, sessionId }) {
  const dir = join(root, `task-${taskId}-${sessionId.slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `--add-dir` would load these as trusted; refuse a root an agent may have seeded. */
export function hasTrustedConfig(root) {
  return ['skills', 'agents'].some((d) => existsSync(join(root, '.github', d)));
}
