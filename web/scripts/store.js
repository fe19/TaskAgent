import { isLive, isTerminal } from '/domain/run-status.js';
import { isWaitingForTime } from '/domain/schedule.js';

export const state = {
  agents: [],
  tasks: [],
  settings: null,
  spec: null,
  permissionMeta: null,
  environmentMeta: null,
  loaded: false,
  openRunId: null,
  dragging: null,
};

export const isAutoDispatch = () => Boolean(state.settings?.auto_dispatch);

export const liveAgents = () => state.agents.filter((a) => isLive(a.status));

export const finishedAgents = () =>
  state.agents.filter((a) => !isLive(a.status)).sort((a, b) => b.id - a.id);

/** Ready tasks first (as the scheduler picks them), then those waiting for their time, soonest first. */
export const queuedTasks = () => {
  const now = Date.now();
  return state.tasks
    .filter((t) => t.status === 'queued')
    .sort((a, b) => {
      const wa = isWaitingForTime(a, now);
      const wb = isWaitingForTime(b, now);
      if (wa !== wb) return wa ? 1 : -1;
      if (wa) return Date.parse(a.run_at) - Date.parse(b.run_at);
      return Boolean(b.run_at) - Boolean(a.run_at) || b.priority - a.priority || a.id - b.id;
    });
};

export const strandedTasks = () => {
  const ran = new Set(state.agents.map((a) => a.task_id));
  return state.tasks.filter((t) => isTerminal(t.status) && !ran.has(t.id)).sort((a, b) => b.id - a.id);
};

export const reportedTokens = () => reportedSum((u) => u.total_tokens);

export const reportedAic = () => reportedSum((u) => u.aiu);

export const aicToUsd = (aic) => {
  const rate = state.settings?.usd_per_aic;
  return aic == null || rate == null ? null : aic * rate;
};

/** Claude Code reports its cost; a Copilot run is priced from its AI Credits. */
export const usageUsd = (usage) => (usage?.cost_usd != null ? usage.cost_usd : aicToUsd(usage?.aiu));

export const reportedUsd = () => reportedSum(usageUsd);

/** The model the next run will use, which depends on the selected assistant. */
export const currentModel = () =>
  state.settings?.assistant === 'claude-code' ? state.settings.claude_model : state.settings?.model;

function reportedSum(pick) {
  // No usage reports means unknown, not zero.
  const values = state.agents.map((a) => (a.usage ? pick(a.usage) : null)).filter((v) => v != null);
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0);
}
