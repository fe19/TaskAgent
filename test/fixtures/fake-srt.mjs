#!/usr/bin/env node
/**
 * Stand-in for Anthropic's `srt` (sandbox-runtime): `srt --settings <policy> <bin> <args…>`.
 * It does not sandbox anything. It copies the policy into the working directory as
 * srt-policy.json, so tests can check what the agent was allowed, then runs the command and
 * passes its output, exit code and stop signals through.
 */
import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv[0] !== '--settings' || argv.length < 3) {
  process.stderr.write('usage: srt --settings <file> <command> [args…]\n');
  process.exit(2);
}
const [, policy, bin, ...args] = argv;
copyFileSync(policy, `${process.cwd()}/srt-policy.json`);

const child = spawn(bin, args, { stdio: 'inherit' });
child.on('error', (err) => {
  process.stderr.write(`fake-srt: ${err.message}\n`);
  process.exit(127);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 143 : 1)));
