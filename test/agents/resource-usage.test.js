import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createResourceMonitor, parsePs, sumTrees } from '../../src/agents/resource-usage.js';

const PS = `
  1     0   0.0  22144
 100    1  50.0   1000
 101  100  20.0    500
 102  101  10.5    250
 200    1  99.0   9999
garbage line
`;

test('ps output is parsed and junk lines are skipped', () => {
  const procs = parsePs(PS);
  assert.equal(procs.length, 5);
  assert.deepEqual(procs[1], { pid: 100, ppid: 1, cpu: 50, rssKb: 1000 });
});

test('a tree sums the agent and all of its descendants, nothing else', () => {
  assert.deepEqual(sumTrees(parsePs(PS), [100]), { cpu: 80.5, rssKb: 1750, processes: 3 });
});

test('overlapping or vanished roots are counted once and never invented', () => {
  assert.deepEqual(sumTrees(parsePs(PS), [100, 101, 999]), { cpu: 80.5, rssKb: 1750, processes: 3 });
  assert.deepEqual(sumTrees(parsePs(PS), [999]), { cpu: 0, rssKb: 0, processes: 0 });
});

const fakeScheduler = (pids) => ({ livePids: () => pids });

test('with no agents running the usage is a measured zero without calling ps', async () => {
  const monitor = createResourceMonitor({
    scheduler: fakeScheduler([]),
    list: () => assert.fail('ps must not run'),
    cores: 4,
    totalMem: 8e9,
  });
  assert.deepEqual(await monitor.sample(), {
    agents: 0, cores: 4, total_mem_bytes: 8e9, processes: 0, cpu_percent: 0, rss_bytes: 0,
  });
});

test('CPU is a share of the whole machine and RAM is in bytes', async () => {
  const monitor = createResourceMonitor({ scheduler: fakeScheduler([100]), list: async () => PS, cores: 4 });
  const r = await monitor.sample();
  assert.equal(r.cpu_percent, 80.5 / 4);
  assert.equal(r.rss_bytes, 1750 * 1024);
  assert.equal(r.processes, 3);
});

test('an unmeasurable system reports null, not zero', async () => {
  const monitor = createResourceMonitor({
    scheduler: fakeScheduler([100]),
    list: async () => {
      throw new Error('no ps');
    },
  });
  const r = await monitor.sample();
  assert.equal(r.cpu_percent, null);
  assert.equal(r.rss_bytes, null);
});

test('the real ps measures a live child process tree', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
  try {
    await new Promise((r) => child.once('spawn', r));
    const r = await createResourceMonitor({ scheduler: fakeScheduler([child.pid]) }).sample();
    assert.equal(r.agents, 1);
    assert.ok(r.processes >= 1);
    assert.ok(r.rss_bytes > 0, `rss ${r.rss_bytes}`);
  } finally {
    child.kill();
  }
});
