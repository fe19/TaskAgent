import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path';

/**
 * Runs a whole agent CLI inside Anthropic's sandbox-runtime (`srt`, the engine under Claude
 * Code's own sandbox): macOS Seatbelt or Linux bubblewrap. For assistants whose CLI has no
 * sandbox of its own. The policy denies the home folder except what is listed, allows writes
 * only where listed, and the network only to listed domains.
 */

/** The policy file format of `srt --settings`. */
export function sandboxPolicy({ workspace, readable = [], writable = [], allowedDomains = [], deniedDomains = [] }) {
  return {
    network: { allowedDomains, deniedDomains, allowLocalBinding: false },
    filesystem: {
      denyRead: ['~/'],
      allowRead: [workspace, ...readable],
      allowWrite: [workspace, ...writable],
      denyWrite: [],
    },
  };
}

/** `srt --settings <policy> <bin> <args…>`: the agent and everything it starts run inside. */
export function wrapCommand({ srtBin = 'srt', bin, args, policyFile }) {
  return { bin: srtBin, args: ['--settings', policyFile, bin, ...args] };
}

/** Writes the policy where only this user can read it, outside the agent's workspace. */
export function writePolicy(policy) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-tasks-srt-'));
  const file = join(dir, 'policy.json');
  writeFileSync(file, JSON.stringify(policy, null, 2), { mode: 0o600 });
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The full path of `bin` (a name is looked up on PATH), with symlinks resolved; null if absent. */
export function resolveBinary(bin, path = process.env.PATH ?? '') {
  const candidates = isAbsolute(bin) ? [bin] : path.split(delimiter).filter(Boolean).map((d) => join(d, bin));
  const found = candidates.find((c) => existsSync(c));
  try {
    return found ? realpathSync(found) : null;
  } catch {
    return null;
  }
}

/**
 * The install folder a binary under the home folder needs to be readable (e.g.
 * ~/.nvm/versions/node/v22 for a global npm package). Null outside home, where reads are
 * allowed anyway, and never the home folder itself.
 */
export function installRoot(file, home = homedir()) {
  if (!file || !file.startsWith(`${home}${sep}`)) return null;
  const nodeModules = file.indexOf(`${sep}node_modules${sep}`);
  let root = nodeModules === -1 ? dirname(dirname(file)) : file.slice(0, nodeModules);
  if (root.endsWith(`${sep}lib`)) root = dirname(root);
  return root === home || !root.startsWith(`${home}${sep}`) ? null : root;
}
