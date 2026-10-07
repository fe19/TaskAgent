import { isLive, isTerminal } from '/domain/run-status.js';

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

export const queuedTasks = () =>
  state.tasks
    .filter((t) => t.status === 'queued')
    .sort((a, b) => b.priority - a.priority || a.id - b.id);

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

function reportedSum(pick) {
  // No usage reports means unknown, not zero.
  const values = state.agents.map((a) => (a.usage ? pick(a.usage) : null)).filter((v) => v != null);
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0);
}
