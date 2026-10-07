/** Agent permissions. Each maps to a real CLI flag; core denies cannot be turned off. */

/** Tool names accepted by `--available-tools`, with what each one grants. `defaultOff`: not granted to new installs. */
export const AVAILABLE_TOOLS = [
  { id: 'view', label: 'Read files', hint: 'Open and read files in the workspace' },
  { id: 'create', label: 'Create files', hint: 'Write new files' },
  { id: 'edit', label: 'Edit files', hint: 'Modify existing files' },
  {
    id: 'bash',
    label: 'Run shell commands',
    hint: 'The widest permission — grants anything a shell can do',
  },
  { id: 'glob', label: 'Find files', hint: 'Match file paths by pattern' },
  { id: 'grep', label: 'Search contents', hint: 'Search inside files' },
  { id: 'web_fetch', label: 'Web access', hint: 'Fetch pages from the internet', defaultOff: true },
];

export const TOOL_IDS = AVAILABLE_TOOLS.map((t) => t.id);
export const DEFAULT_TOOL_IDS = AVAILABLE_TOOLS.filter((t) => !t.defaultOff).map((t) => t.id);

/** Always denied. Additive with whatever the operator adds. */
export const CORE_DENIED_COMMANDS = ['git push', 'gh', 'git remote'];

/** Shown read-only in the UI: true because of how the process is built. */
export const ENFORCED_GUARANTEES = [
  'Each run gets a fresh throwaway workspace directory',
  'Git cannot see above the working directory (GIT_CEILING_DIRECTORIES)',
  'Built-in MCP servers are disabled',
  'The workspace is never trusted, so its skills, plugins and hooks never load',
  'Agents may access the whole working directory, unless it contains .github/skills or agents',
  'Blocked websites apply to web access and to shell commands such as curl',
];

/** Splits a comma/newline separated field into a clean list. */
export function parseList(value) {
  const source = Array.isArray(value) ? value.join(',') : value;
  return String(source ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function serializeList(list) {
  return parseList(list).join(',');
}

/** Domain or URL, optionally with a `*.` subdomain wildcard. A bare `*` is rejected: the CLI ignores it. */
export function invalidUrlPatterns(patterns) {
  return parseList(patterns).filter((p) => !/^(https?:\/\/)?(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(:\d+)?(\/\S*)?$/.test(p));
}

/** Env var names are uppercase-ish identifiers; anything else is a typo. */
export function invalidEnvNames(names) {
  return parseList(names).filter((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
}

/** Core denies plus operator denies, deduplicated. */
export function effectiveDeniedCommands(denied) {
  return [...new Set([...CORE_DENIED_COMMANDS, ...parseList(denied)])];
}

/**
 * Permission settings → CLI flags. Empty tool list falls back to the default tools.
 * URLs can only be denied: `--allow-all-tools` already permits every URL.
 */
export function permissionArgs({ allowed_tools, denied_commands, blocked_urls, secret_env_vars } = {}) {
  const tools = parseList(allowed_tools).filter((t) => TOOL_IDS.includes(t));
  const args = ['--available-tools', ...(tools.length > 0 ? tools : DEFAULT_TOOL_IDS)];

  for (const command of effectiveDeniedCommands(denied_commands)) {
    args.push('--deny-tool', `shell(${command})`);
  }
  for (const url of parseList(blocked_urls)) args.push('--deny-url', url);

  const secrets = parseList(secret_env_vars);
  if (secrets.length > 0) args.push('--secret-env-vars', secrets.join(','));

  return args;
}
