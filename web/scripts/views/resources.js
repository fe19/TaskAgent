import { $ } from '../ui.js';
import { get } from '../api-client.js';
import { liveAgents } from '../store.js';
import { formatBytes } from '../format.js';

const POLL_MS = 3000;
let measuredAgents = null;

function show({ cpu, ram, tip }) {
  $('stat-cpu').textContent = cpu;
  $('stat-ram').textContent = ram;
  $('hw-group').title = tip;
}

async function sample() {
  try {
    const r = await get('/api/resources');
    measuredAgents = r.agents;
    const machine = `of ${r.cores} cores · ${formatBytes(r.total_mem_bytes)} RAM`;
    if (r.cpu_percent == null) {
      show({ cpu: 'n/a', ram: 'n/a', tip: 'Could not measure the agent processes on this system.' });
    } else {
      show({
        cpu: `${r.cpu_percent.toFixed(r.cpu_percent < 10 ? 1 : 0)}%`,
        ram: formatBytes(r.rss_bytes),
        tip: r.agents
          ? `${r.agents} agent(s), ${r.processes} process(es), ${machine}`
          : `No agents running, ${machine}`,
      });
    }
  } catch {
    show({ cpu: 'n/a', ram: 'n/a', tip: 'Server unreachable.' });
  }
}

export function mount() {
  sample();
  setInterval(() => {
    if (liveAgents().length > 0 || measuredAgents !== 0) sample();
  }, POLL_MS);
}
