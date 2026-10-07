import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function launchChrome({ port = 9222, windowSize = '1440,1100' } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'acr-chrome-'));
  const child = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      // Without this the corporate proxy intercepts requests to localhost.
      '--no-proxy-server',
      '--hide-scrollbars',
      `--window-size=${windowSize}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  return {
    port,
    async close() {
      try {
        execFileSync('kill', [String(child.pid)]);
        await new Promise((resolve) => child.once('exit', resolve));
      } catch {
        // Already gone.
      }
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

async function openTab(port, url) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
        method: 'PUT',
      });
      if (res.ok) return await res.json();
    } catch {
      // Not ready yet.
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never became available');
}

export async function openPage({ port, url }) {
  const target = await openTab(port, url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const waiter = msg.id && pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
    else waiter.resolve(msg.result);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const send = (method, params = {}) => {
    nextId += 1;
    const id = nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send('Runtime.enable');
  await send('Page.enable');

  return {
    send,
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'evaluation failed');
      }
      return result.value;
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', {});
      return Buffer.from(data, 'base64');
    },
    setViewport: ({ deviceScaleFactor = 1, mobile = false, ...size }) =>
      send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor, mobile, ...size }),
    close: () => ws.close(),
  };
}

export async function until(read, { attempts = 60, intervalMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await read();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}
