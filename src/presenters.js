import { nanoAiuToAiu } from './store/copilot-usage.js';
import { shortLabel } from './domain/task-label.js';

// Rows in, view models out. Unreported usage is `null`, never `0`.

function presentUsage(usage) {
  if (!usage) return null;
  return {
    api_calls: usage.api_calls,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_write_tokens: usage.cache_write_tokens,
    total_tokens:
      usage.input_tokens + usage.output_tokens + usage.cache_read_tokens + usage.cache_write_tokens,
    aiu: nanoAiuToAiu(usage.nano_aiu),
    // Reported by Claude Code; Copilot runs are priced from AI Credits in the browser.
    cost_usd: usage.cost_usd ?? null,
    api_duration_ms: usage.api_duration_ms,
    model: usage.model,
  };
}

function presentCodeChanges(run) {
  if (run.lines_added == null && run.lines_removed == null) return null;
  return {
    lines_added: run.lines_added,
    lines_removed: run.lines_removed,
    files_modified: run.files_modified ? JSON.parse(run.files_modified) : [],
  };
}

export function presentRun(run, usage) {
  if (!run) return null;
  return {
    id: run.id,
    task_id: run.task_id,
    task_title: run.task_title,
    task_prompt: run.task_prompt,
    session_id: run.session_id,
    assistant: run.assistant,
    status: run.status,
    // Sites the agent wanted but was not allowed to reach.
    blocked_sites: listOf(run.blocked_sites),
    // Sites the agent reached with its web tool or shell commands.
    accessed_sites: listOf(run.accessed_sites),
    model: run.model,
    current_activity: run.current_activity,
    tool_calls: run.tool_calls,
    workspace_dir: run.workspace_dir,
    max_runtime_s: run.max_runtime_s,
    started_at: run.started_at,
    finished_at: run.finished_at,
    error: run.error,
    exit_code: run.exit_code,
    code_changes: presentCodeChanges(run),
    premium_requests: run.premium_requests,
    result: run.result_text ?? null,
    usage: presentUsage(usage),
    usage_state: usage ? 'available' : run.finished_at ? 'unavailable' : 'pending',
  };
}

/**
 * Claude Code limits as "% left" per window. A window whose reset time has passed has started
 * over, so its old reading no longer applies.
 */
export function presentLimits(limits, now = Date.now()) {
  if (!limits) {
    return { available: false, reason: 'Claude Code reports its usage limits during a run; start a task to see them.' };
  }
  const windows = limits.windows.map((w) => {
    const expired = w.resets_at != null && Date.parse(w.resets_at) <= now;
    const used = expired ? 0 : w.utilization;
    return {
      id: w.id,
      percent_left: used == null ? null : Math.max(0, Math.min(100, (1 - used) * 100)),
      resets_at: expired ? null : w.resets_at,
      reset_since: expired,
    };
  });
  if (windows.length === 0) {
    return { available: false, reason: 'This Claude Code account reports no usage limits (e.g. an API key).' };
  }
  // Not `status`: the router reads that key as an HTTP status.
  return { available: true, limit_status: limits.status, windows, observed_at: limits.observed_at };
}

const listOf = (text) => String(text ?? '').split(',').filter(Boolean);

export function presentTask(task) {
  return { ...task, allowed_sites: listOf(task.allowed_sites), short_label: shortLabel(task.prompt, task.title) };
}

/** Board view of a run: result text omitted (can be large). */
export function presentAgent(run, usage) {
  const { result, ...rest } = presentRun(run, usage);
  return {
    ...rest,
    has_result: Boolean(result),
    short_label: shortLabel(run.task_prompt, run.task_title),
  };
}
