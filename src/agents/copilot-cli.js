import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseList, permissionArgs, urlHost } from '../domain/permissions.js';
import { agentEnvironment } from '../domain/environment.js';
import { installRoot, resolveBinary, sandboxPolicy } from './os-sandbox.js';
import { toolCallSites } from '../domain/web-access.js';

/** Copilot CLI adapter: argv, env and JSONL events. Swap this file to support another agent backend. */

/** `--allow-all-tools` only skips approval prompts; real limits are the permission flags. */
export function buildArgs({
  prompt,
  workspace,
  model,
  sessionId,
  reasoningEffort,
  permissions = {},
}) {
  const args = [
    '-p',
    prompt,
    '-C',
    workspace,
    '--allow-all-tools',
    '--output-format',
    'json',
    '--log-level',
    'none',
    '--no-auto-update',
    // Our own session id lets us attribute token usage (store/copilot-usage.js).
    '--session-id',
    sessionId,
    '--model',
    model,
    '--disable-builtin-mcps',
    ...permissionArgs(permissions),
  ];
  // "default" omits the flag; several models reject it.
  if (reasoningEffort && reasoningEffort !== 'default') {
    args.push('--reasoning-effort', reasoningEffort);
  }
  return args;
}

/**
 * What the Copilot CLI itself must reach: its API and GitHub sign-in. From GitHub's documented
 * endpoints, not yet verified against the real CLI. Its shell can reach these too.
 */
export const COPILOT_DOMAINS = ['api.githubcopilot.com', '*.githubcopilot.com', 'api.github.com', 'github.com', '*.githubusercontent.com'];

/**
 * Copilot has no sandbox of its own, so the whole CLI runs in one (os-sandbox.js). Besides the
 * run workspace it may read and write its own folder (config, sign-in, session store) and read
 * where it and node are installed; the network reaches Copilot plus the allowed websites.
 */
export function osSandbox(permissions = {}, { workspace, bin, env = process.env, home = homedir() } = {}) {
  const copilotHome = env.COPILOT_HOME || join(home, '.copilot');
  const installs = [installRoot(resolveBinary(bin, env.PATH), home), installRoot(resolveBinary('node', env.PATH), home)];
  return sandboxPolicy({
    workspace,
    readable: [copilotHome, ...new Set(installs.filter(Boolean))],
    writable: [copilotHome],
    allowedDomains: [...COPILOT_DOMAINS, ...parseList(permissions.shell_allowed_domains).map(urlHost)],
    deniedDomains: parseList(permissions.blocked_urls).map(urlHost),
  });
}

/**
 * Only allow-listed variables (domain/environment.js) reach the agent: cloud keys, the SSH
 * agent and the like stay out of its shell. `GIT_CEILING_DIRECTORIES` stops agent `git`
 * from finding the parent repository.
 */
export function buildEnv({ workspaceRoot, passedEnvVars = [], env = process.env }) {
  return {
    ...agentEnvironment(env, { assistant: 'copilot', extra: passedEnvVars }),
    // '1', never 'true': 'true' also trusts the (agent-writable) workspace.
    COPILOT_ALLOW_ALL: '1',
    NO_COLOR: '1',
    GIT_CEILING_DIRECTORIES: workspaceRoot,
  };
}

/** The CLI rejects this combination up front, so we can recover by dropping the flag. */
export function isReasoningEffortRejection(stderr) {
  return /does not support reasoning effort/i.test(stderr ?? '');
}

/** Parses one line of the CLI's JSONL stream. Non-JSON output is ignored, not fatal. */
export function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Turns one CLI event into a short human-readable activity line, or null. */
export function summarizeEvent(evt) {
  const d = evt?.data ?? {};
  switch (evt?.type) {
    case 'user.message':
      return { kind: 'start', summary: 'Received task prompt' };
    case 'assistant.turn_start':
      return { kind: 'thinking', summary: 'Thinking' };
    case 'assistant.reasoning': {
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      // The second reasoning event carries an opaque base64 blob, not prose.
      if (!text || /^[A-Za-z0-9+/=]{80,}$/.test(text.slice(0, 120))) return null;
      return { kind: 'thinking', summary: firstSentence(text) };
    }
    case 'tool.execution_start':
      return {
        kind: 'tool',
        summary: d.toolTitle ? `${d.toolTitle}${describeTarget(d)}` : `Running ${d.toolName}`,
      };
    case 'tool.execution_complete':
      return { kind: 'tool_done', summary: d.success === false ? 'Tool call failed' : null };
    case 'assistant.message': {
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      if (text) return { kind: 'message', summary: firstSentence(text) };
      const intent = d.toolRequests?.[0]?.intentionSummary;
      return intent ? { kind: 'plan', summary: capitalize(intent) } : null;
    }
    case 'result':
      return { kind: 'result', summary: `Finished with exit code ${evt.exitCode}` };
    default:
      return null;
  }
}

/** The `result` event has code changes and premium requests, not tokens. */
export function readResultMetrics(evt) {
  const usage = evt?.usage ?? {};
  const changes = usage.codeChanges ?? {};
  return {
    premiumRequests: usage.premiumRequests ?? null,
    linesAdded: changes.linesAdded ?? null,
    linesRemoved: changes.linesRemoved ?? null,
    filesModified: changes.filesModified ?? null,
  };
}

function describeTarget(d) {
  const path = d.arguments?.path;
  if (typeof path === 'string') return `: ${path.split('/').pop()}`;
  const command = d.arguments?.command;
  if (typeof command === 'string') return `: ${truncate(command, 60)}`;
  return '';
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const match = clean.match(/^.{0,140}?[.!?](\s|$)/);
  return truncate(match ? match[0].trim() : clean, 140);
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The adapter interface `AgentRun` drives. `interpret` turns one event into the facts a run
 * tracks: `activities` for the timeline, `toolCalls` started, the latest `message`, the
 * `result` metrics, and `usage` when the event itself carries it (Copilot's never does).
 */
export const copilotAdapter = {
  id: 'copilot',
  binOption: 'copilotBin',
  defaultBin: 'copilot',
  // Token usage lands in the CLI's session store after exit (store/copilot-usage.js).
  pollsUsage: true,
  // Runs the whole CLI inside sandbox-runtime; see osSandbox.
  osSandbox,
  model: (settings) => settings.model,
  effort: (settings) => settings.reasoning_effort,
  buildArgs,
  buildEnv,
  parseEvent,

  interpret(evt) {
    const out = {};
    const summary = summarizeEvent(evt);
    if (summary?.summary) out.activities = [{ kind: summary.kind, summary: summary.summary }];
    if (evt.type === 'tool.execution_start') {
      out.toolCalls = 1;
      out.toolStarts = [{ id: evt.data?.toolCallId, sites: toolCallSites(evt.data?.arguments) }];
    }
    if (evt.type === 'tool.execution_complete') {
      out.toolEnds = [{ id: evt.data?.toolCallId, failed: evt.data?.success === false }];
    }
    if (evt.type === 'assistant.message') {
      const text = typeof evt.data?.content === 'string' ? evt.data.content.trim() : '';
      if (text) out.message = text;
    }
    if (evt.type === 'result') out.result = readResultMetrics(evt);
    return out;
  },

  /** Some models reject an explicit reasoning effort; retry once without it. */
  rejectsEffort: isReasoningEffortRejection,
};
