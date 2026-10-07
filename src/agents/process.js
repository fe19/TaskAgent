/** Grace period between SIGTERM and SIGKILL when stopping an agent. */
export const KILL_GRACE_MS = 5000;

function signal(child, name) {
  try {
    child?.kill(name);
  } catch {
    /* already gone */
  }
}

/** SIGTERM, then SIGKILL after `graceMs`. Returns a cancel function. */
export function terminate(child, graceMs = KILL_GRACE_MS) {
  signal(child, 'SIGTERM');
  const timer = setTimeout(() => signal(child, 'SIGKILL'), graceMs);
  return () => clearTimeout(timer);
}
