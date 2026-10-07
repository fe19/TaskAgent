import { execFile } from 'node:child_process';
import { cpus, totalmem } from 'node:os';

/** Every process, one per line: pid, parent pid, %CPU of one core, RSS in KiB. Works on macOS and Linux. */
function listProcesses() {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,%cpu=,rss='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

export function parsePs(text) {
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((cols) => cols.length === 4 && cols.every(Number.isFinite))
    .map(([pid, ppid, cpu, rssKb]) => ({ pid, ppid, cpu, rssKb }));
}

/** Sums each root and all of its descendants, counting every process once. */
export function sumTrees(procs, rootPids) {
  const children = new Map();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);

  const seen = new Set();
  const stack = procs.filter((p) => rootPids.includes(p.pid));
  const total = { cpu: 0, rssKb: 0, processes: 0 };
  while (stack.length > 0) {
    const p = stack.pop();
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    total.cpu += p.cpu;
    total.rssKb += p.rssKb;
    total.processes += 1;
    stack.push(...(children.get(p.pid) ?? []));
  }
  return total;
}

/** Live CPU and RAM of the running agents' process trees. Measured, never estimated: `null` when unmeasurable. */
export function createResourceMonitor({ scheduler, list = listProcesses, cores = cpus().length, totalMem = totalmem() }) {
  return {
    async sample() {
      const pids = scheduler.livePids();
      const base = { agents: pids.length, cores, total_mem_bytes: totalMem };
      if (pids.length === 0) return { ...base, processes: 0, cpu_percent: 0, rss_bytes: 0 };

      let procs;
      try {
        procs = parsePs(await list());
      } catch {
        return { ...base, processes: null, cpu_percent: null, rss_bytes: null };
      }
      const { cpu, rssKb, processes } = sumTrees(procs, pids);
      // ps reports per core; share of the whole machine reads better next to RAM.
      return { ...base, processes, cpu_percent: cpu / cores, rss_bytes: rssKb * 1024 };
    },
  };
}
