import { parseList } from './permissions.js';

/**
 * Which of the server's environment variables an agent receives: what the CLI needs to
 * run, sign in and reach GitHub, plus the names the operator adds. Matched case-insensitively.
 */
export const PASSED_ENV_VARS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'TZ', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'GH_HOST', 'GH_TOKEN', 'GITHUB_TOKEN',
  // Windows
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'HOMEDRIVE', 'HOMEPATH',
];
export const PASSED_ENV_PREFIXES = ['LC_', 'XDG_', 'COPILOT_'];

/** The subset of `env` an agent may see; `extra` are operator-added names. */
export function agentEnvironment(env, extra = []) {
  const names = new Set([...PASSED_ENV_VARS, ...parseList(extra).map((n) => n.toUpperCase())]);
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => {
      const upper = name.toUpperCase();
      return value !== undefined && (names.has(upper) || PASSED_ENV_PREFIXES.some((p) => upper.startsWith(p)));
    }),
  );
}
