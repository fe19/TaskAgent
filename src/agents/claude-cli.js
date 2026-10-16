import {
  CORE_SECRET_ENV_VARS,
  DEFAULT_TOOL_IDS,
  TOOL_IDS,
  effectiveDeniedCommands,
  parseList,
  urlHost,
} from '../domain/permissions.js';
import { agentEnvironment } from '../domain/environment.js';
import { toolCallSites } from '../domain/web-access.js';

/** Claude Code CLI adapter: argv, env and stream-json events. Same interface as `copilotAdapter`. */

/** Our tool ids → Claude Code built-in tools. */
const TOOL_MAP = {
  view: ['Read'],
  create: ['Write'],
  edit: ['Edit', 'NotebookEdit'],
  bash: ['Bash'],
  glob: ['Glob'],
  grep: ['Grep'],
  web_fetch: ['WebFetch', 'WebSearch'],
};

/** `//` makes a Claude Code path rule absolute. */
const under = (dir) => `/${dir.replace(/\/+$/, '')}/**`;

/** Permission settings → tool flags. `dontAsk` denies anything not allowed here. */
export function toolArgs({ allowed_tools, denied_commands, blocked_urls, shell_allowed_domains, allow_all_websites } = {}, { workspace } = {}) {
  const selected = parseList(allowed_tools).filter((t) => TOOL_IDS.includes(t));
  const tools = (selected.length > 0 ? selected : DEFAULT_TOOL_IDS).flatMap((t) => TOOL_MAP[t]);

  // File tools are confined to the run's own workspace.
  const dirs = [workspace].filter(Boolean);
  const sites = parseList(shell_allowed_domains).map(urlHost);
  const allowed = tools.flatMap((tool) => {
    if (tool === 'Read') return dirs.map((d) => `Read(${under(d)})`);
    if (['Write', 'Edit', 'NotebookEdit'].includes(tool)) return dirs.map((d) => `Edit(${under(d)})`);
    // The web tool, like shell commands, reaches only the allowed websites (blocked ones never).
    // A bare "WebFetch" rule does not let dontAsk mode fetch a new domain; "domain:*" does.
    if (tool === 'WebFetch') return allow_all_websites ? ['WebFetch(domain:*)'] : sites.map((site) => `WebFetch(domain:${site})`);
    return [tool];
  });

  const denied = effectiveDeniedCommands(denied_commands).flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]);
  for (const url of parseList(blocked_urls)) denied.push(`WebFetch(domain:${urlHost(url)})`);

  return [
    '--tools', [...new Set(tools)].join(','),
    '--allowedTools', ...new Set(allowed),
    '--disallowedTools', ...denied,
  ];
}

/**
 * The OS sandbox around shell commands (macOS Seatbelt, Linux bubblewrap). Commands may write
 * only in the run workspace and working directory, read nothing else in the home folder
 * (~/.ssh, ~/.aws, Claude's own login), and reach only the allowed websites. There is no
 * unsandboxed retry, and a run fails rather than run unsandboxed when the sandbox can't start.
 */
export function sandboxSettings({ shell_allowed_domains, blocked_urls, allow_all_websites } = {}, { workspace } = {}) {
  return {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      filesystem: {
        denyRead: ['~/'],
        allowRead: [workspace].filter(Boolean),
      },
      network: {
        // "*": every site; deniedDomains still refuse the blocked ones.
        allowedDomains: allow_all_websites ? ['*'] : parseList(shell_allowed_domains).map(urlHost),
        deniedDomains: parseList(blocked_urls).map(urlHost),
        strictAllowlist: true,
      },
    },
  };
}


export function buildArgs({ prompt, workspace, model, sessionId, reasoningEffort, permissions = {} }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--session-id', sessionId,
    '--model', model,
    '--permission-mode', 'dontAsk',
    // The workspace is untrusted: no CLAUDE.md, skills, plugins, hooks or custom agents from it.
    '--safe-mode',
    '--setting-sources', 'user',
    // No --mcp-config, so no MCP servers at all.
    '--strict-mcp-config',
    // CLI settings win over any settings file, so the workspace can't loosen the sandbox.
    '--settings', JSON.stringify(sandboxSettings(permissions, { workspace })),
    ...toolArgs(permissions, { workspace }),
  ];
  if (reasoningEffort && reasoningEffort !== 'default') args.push('--effort', reasoningEffort);
  // Last, after `--`: a prompt starting with "-" must not be read as an option.
  args.push('--', prompt);
  return args;
}

/**
 * Claude Code cannot hide variables from its own shell, so operator secrets and the GitHub
 * tokens are not passed at all; it does not need them. The scrub keeps its own API key out of
 * the subprocesses it starts.
 */
export function buildEnv({ workspaceRoot, passedEnvVars = [], secretEnvVars = [], env = process.env }) {
  return {
    ...agentEnvironment(env, {
      assistant: 'claude-code',
      extra: passedEnvVars,
      exclude: [...CORE_SECRET_ENV_VARS, ...parseList(secretEnvVars)],
    }),
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    NO_COLOR: '1',
    GIT_CEILING_DIRECTORIES: workspaceRoot,
  };
}

export function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** One stream-json message → the facts a run tracks (see `copilotAdapter.interpret`). */
export function interpret(evt) {
  switch (evt?.type) {
    case 'system':
      return evt.subtype === 'init' ? { activities: [{ kind: 'start', summary: 'Received task prompt' }] } : {};
    case 'assistant':
      return interpretAssistant(evt.message?.content ?? []);
    case 'user': {
      const results = (evt.message?.content ?? []).filter((b) => b?.type === 'tool_result');
      const out = {};
      if (results.some((b) => b.is_error)) out.activities = [{ kind: 'tool_done', summary: 'Tool call failed' }];
      const blocked = results.flatMap((b) => blockedSitesIn(resultText(b.content)));
      if (blocked.length > 0) out.blockedSites = [...new Set(blocked)];
      if (results.length > 0) out.toolEnds = results.map((b) => ({ id: b.tool_use_id, failed: Boolean(b.is_error) }));
      return out;
    }
    case 'result':
      return interpretResult(evt);
    case 'rate_limit_event': {
      const limits = parseRateLimits(evt.rate_limit_info);
      return limits ? { limits } : {};
    }
    default:
      return {};
  }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
}

/**
 * Sites the sandbox refused: "deny network-outbound www.bbc.co.uk:443". (The web tool's
 * "unable to fetch from …" is different: the site refused Claude's fetcher, which no setting
 * here changes. A web tool permission denial names no site; the failed call's URL stands in.)
 */
export function blockedSitesIn(text) {
  return [...text.matchAll(/deny network-outbound ([a-z0-9.*-]+\.[a-z0-9-]+)(?::\d+)?/gi)].map((m) => m[1].toLowerCase());
}

/**
 * Subscription limits as Claude Code reports them: per window, the share used (0–1) and when it
 * resets. Accounts without such limits (API keys) send none.
 */
export function parseRateLimits(info) {
  if (!info || typeof info !== 'object') return null;
  const source = info.unifiedWindows && typeof info.unifiedWindows === 'object'
    ? info.unifiedWindows
    : info.rateLimitType ? { [info.rateLimitType]: info } : {};
  const windows = Object.entries(source)
    .filter(([, w]) => w && (typeof w.utilization === 'number' || typeof w.resetsAt === 'number'))
    .map(([id, w]) => ({
      id,
      utilization: typeof w.utilization === 'number' ? w.utilization : null,
      resets_at: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : null,
    }));
  if (windows.length === 0 && !info.status) return null;
  return { status: info.status ?? null, windows };
}

function interpretAssistant(content) {
  const out = { activities: [], toolCalls: 0 };
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      out.activities.push({ kind: 'thinking', summary: firstSentence(block.thinking) });
    } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      out.message = block.text.trim();
      out.activities.push({ kind: 'message', summary: firstSentence(block.text) });
    } else if (block?.type === 'tool_use') {
      out.toolCalls += 1;
      (out.toolStarts ??= []).push({ id: block.id, sites: toolCallSites(block.input) });
      out.activities.push({ kind: 'tool', summary: describeTool(block) });
    }
  }
  return out;
}

function interpretResult(evt) {
  const usage = evt.usage ?? {};
  const denials = Array.isArray(evt.permission_denials) ? evt.permission_denials.length : 0;
  const activities = [];
  if (denials > 0) activities.push({ kind: 'warning', summary: `${denials} tool call${denials === 1 ? '' : 's'} denied by permissions` });
  activities.push({ kind: 'result', summary: evt.is_error ? `Finished with an error (${evt.subtype})` : 'Finished' });

  const out = {
    activities,
    // Claude Code reports no code-change metrics or premium requests.
    result: {},
    usage: {
      api_calls: evt.num_turns ?? null,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      cache_read_tokens: usage.cache_read_input_tokens ?? null,
      cache_write_tokens: usage.cache_creation_input_tokens ?? null,
      cost_usd: evt.total_cost_usd ?? null,
      api_duration_ms: evt.duration_api_ms ?? null,
      model: evt.modelUsage ? Object.keys(evt.modelUsage).join(', ') || null : null,
    },
  };
  if (typeof evt.result === 'string' && evt.result.trim()) out.message = evt.result.trim();
  if (evt.is_error) out.error = (typeof evt.result === 'string' && evt.result.trim()) || `Claude Code ended with ${evt.subtype}`;
  return out;
}

function describeTool({ name, input = {} }) {
  if (typeof input.command === 'string') return `${name}: ${truncate(input.command, 60)}`;
  const path = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof path === 'string') return `${name}: ${path.split('/').pop()}`;
  if (typeof input.pattern === 'string') return `${name}: ${truncate(input.pattern, 60)}`;
  if (typeof input.url === 'string') return `${name}: ${truncate(input.url, 60)}`;
  return `Running ${name}`;
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const match = clean.match(/^.{0,140}?[.!?](\s|$)/);
  return truncate(match ? match[0].trim() : clean, 140);
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const claudeAdapter = {
  id: 'claude-code',
  binOption: 'claudeBin',
  defaultBin: 'claude',
  // The `result` event carries usage and cost; nothing to poll.
  pollsUsage: false,
  model: (settings) => settings.claude_model,
  effort: (settings) => settings.claude_effort,
  buildArgs,
  buildEnv,
  parseEvent,
  interpret,
};
