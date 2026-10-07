#!/usr/bin/env node
import { createApp } from './src/http/server.js';

const app = createApp();
const { host, port } = app.config;

app.server.listen(port, host, () => {
  console.log(`Agents Tasks listening on http://${host}:${port}`);
  if (app.orphaned > 0) console.log(`Requeued ${app.orphaned} task(s) interrupted by a previous run.`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal}: stopping agents...`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
