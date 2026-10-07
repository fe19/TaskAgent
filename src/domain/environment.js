import { parseList } from './permissions.js';

/**
 * Which of the server's environment variables an agent receives: what any CLI needs to run
 * and reach the network, what its own assistant needs to sign in, plus the names the operator
 * adds. Matched case-insensitively.
 */
export const PASSED_ENV_VARS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'TZ', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // Windows
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'HOMEDRIVE', 'HOMEPATH',
];
export const PASSED_ENV_PREFIXES = ['LC_', 'XDG_'];

/** Per assistant: its configuration and sign-in variables. */
export const ASSISTANT_ENV = {
  copilot: { vars: ['GH_HOST', 'GH_TOKEN', 'GITHUB_TOKEN'], prefixes: ['COPILOT_'] },
  'claude-code': { vars: ['CLAUDE_CONFIG_DIR'], prefixes: ['ANTHROPIC_', 'CLAUDE_CODE_'] },
};

/**
 * The subset of `env` an agent of `assistant` may see. `extra` are operator-added names;
 * `exclude` wins over everything (secrets an assistant cannot hide from its shell).
 */
export function agentEnvironment(env, { assistant = 'copilot', extra = [], exclude = [] } = {}) {
  const own = ASSISTANT_ENV[assistant] ?? { vars: [], prefixes: [] };
  const upper = (list) => parseList(list).map((n) => n.toUpperCase());
  const names = new Set([...PASSED_ENV_VARS, ...own.vars, ...upper(extra)]);
  const prefixes = [...PASSED_ENV_PREFIXES, ...own.prefixes];
  const excluded = new Set(upper(exclude));
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => {
      const key = name.toUpperCase();
      if (value === undefined || excluded.has(key)) return false;
      return names.has(key) || prefixes.some((p) => key.startsWith(p));
    }),
  );
}
