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

/** The CLI may sign in with these, so they are passed, but always hidden from the agent's shell. */
export const CORE_SECRET_ENV_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];

/** Shown read-only in the UI. Only what the process actually enforces; limits are stated too. */
export const ENFORCED_GUARANTEES = [
  'Each run gets a fresh throwaway workspace and can use only that folder, not other runs’ folders',
  'MCP servers are disabled',
  'The workspace is never trusted, so its skills, plugins and hooks never load',
  'Blocked commands are matched by their text, so they are a guard rail, not a boundary: a command such as sh -c "git push" is not caught',
];

/** Guarantees that depend on what the assistant's CLI can enforce. */
const ASSISTANT_GUARANTEES = {
  copilot: [
    'The whole Copilot CLI runs in an OS sandbox (Anthropic sandbox-runtime): it can write only in the run workspace and its own ~/.copilot folder, cannot read the rest of your home folder (for example ~/.ssh), and reaches only Copilot’s servers plus the websites you allow',
    'Not yet verified with the real Copilot CLI. Copilot and its shell share the sandbox, so shell commands can also reach Copilot’s servers (including github.com) and ~/.copilot',
    'Without sandbox-runtime (srt) installed, Copilot runs fail instead of running unsandboxed',
  ],
  'claude-code': [
    'Shell commands run in an OS sandbox: they can write only in the run workspace, cannot read the rest of your home folder (for example ~/.ssh), and cannot run unsandboxed',
    'Shell commands reach only the websites you allow (none by default); blocked websites apply to web access too',
    "Secret variables and GitHub tokens are not passed to Claude Code; its own API key is removed from the agent's shell",
  ],
};

export function enforcedGuarantees(assistant) {
  return [...ENFORCED_GUARANTEES, ...(ASSISTANT_GUARANTEES[assistant] ?? [])];
}

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

/** `https://*.example.com/path` → `*.example.com`: the host part sandbox rules match on. */
export function urlHost(pattern) {
  return String(pattern).replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
}

/** Core denies plus operator denies, deduplicated. */
export function effectiveDeniedCommands(denied) {
  return [...new Set([...CORE_DENIED_COMMANDS, ...parseList(denied)])];
}

/** Core secrets plus operator secrets, deduplicated. */
export function effectiveSecretEnvVars(secrets) {
  return [...new Set([...CORE_SECRET_ENV_VARS, ...parseList(secrets)])];
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

  args.push('--secret-env-vars', effectiveSecretEnvVars(secret_env_vars).join(','));

  return args;
}
