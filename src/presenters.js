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

export function presentTask(task) {
  return { ...task, short_label: shortLabel(task.prompt, task.title) };
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
