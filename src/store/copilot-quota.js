import { execFile } from 'node:child_process';

const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;

/** Reads the Copilot account through `gh`, which owns the login and proxy; the token never reaches this app. */
export function ghCopilotUser(ghBin = 'gh') {
  return new Promise((resolve, reject) => {
    execFile(ghBin, ['api', '/copilot_internal/user'], { timeout: TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, out, errOut) => {
      if (err) return reject(new Error(String(errOut || err.message).trim().split('\n')[0]));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('gh returned no JSON'));
      }
    });
  });
}

/** The monthly premium allowance, in AI Credits. Null when the account reports none. */
export function parseQuota(user) {
  const q = user?.quota_snapshots?.premium_interactions;
  if (!q) return null;
  return {
    unlimited: Boolean(q.unlimited),
    entitlement_aic: q.entitlement ?? null,
    remaining_aic: q.quota_remaining ?? q.remaining ?? null,
    percent_remaining: q.percent_remaining ?? null,
    overage_permitted: Boolean(q.overage_permitted),
    reset_date: user.quota_reset_date_utc ?? user.quota_reset_date ?? null,
  };
}

/** Cached, so polling browsers cost one GitHub call per minute at most. Failures are cached too. */
export function createQuotaReader({ fetchUser = () => ghCopilotUser(), now = Date.now, cacheMs = CACHE_MS } = {}) {
  let cached = null;
  let fetchedAt = -Infinity;
  let pending = null;

  async function load() {
    try {
      const quota = parseQuota(await fetchUser());
      cached = quota
        ? { available: true, ...quota }
        : { available: false, reason: 'This account reports no premium quota.' };
    } catch (err) {
      cached = { available: false, reason: `Could not read the Copilot quota via gh: ${err.message}` };
    }
    fetchedAt = now();
    cached.fetched_at = new Date(fetchedAt).toISOString();
    pending = null;
    return cached;
  }

  return {
    read() {
      if (now() - fetchedAt < cacheMs) return Promise.resolve(cached);
      pending ??= load();
      return pending;
    },
  };
}
