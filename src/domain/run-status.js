/** Task/run lifecycle states, shared by server and browser. */

export const TASK_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'interrupted',
];

/** A run that still has a live process behind it. */
export const LIVE_STATUSES = ['starting', 'running'];

const TERMINAL = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted']);
const LIVE = new Set(LIVE_STATUSES);

export function isTerminal(status) {
  return TERMINAL.has(status);
}

export function isLive(status) {
  return LIVE.has(status);
}

/** Board lanes, left to right. */
export const LANES = ['queued', 'running', 'done'];

/** The board lane a task's status puts it in. */
export function taskLane(status) {
  return status === 'queued' || status === 'running' ? status : 'done';
}

/** Everything that did not succeed reads as a failure on the board. */
export function isFailure(status) {
  return isTerminal(status) && status !== 'succeeded';
}

/** Short human wording for a terminal state. */
export const OUTCOME_WORD = {
  succeeded: 'Done',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
};

/** The activity line a run settles on once it stops. */
export function finalActivity(status) {
  switch (status) {
    case 'succeeded':
      return 'Completed';
    case 'timed_out':
      return 'Stopped: runtime limit reached';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
    default:
      return null;
  }
}

/** The activity line shown between asking a run to stop and it actually stopping. */
export function stoppingActivity(reason) {
  return reason === 'timed_out' ? 'Stopping: runtime limit reached' : 'Stopping: cancelled';
}

/** A stopped or failed run's last message is not its answer. */
export function resultLabel(status) {
  return isFailure(status) ? 'Last message (unfinished)' : 'Result';
}

/** A deliberate stop wins over the exit code (the CLI exits 0 on SIGTERM). */
export function resolveFinalStatus({ exitCode, stopReason = null }) {
  if (stopReason && isTerminal(stopReason)) return stopReason;
  return exitCode === 0 ? 'succeeded' : 'failed';
}
