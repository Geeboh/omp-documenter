#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readUsageStats, syncUsage } from '../lib/token-usage.mjs';

function main() {
  const args = process.argv.slice(2); const action = args.shift(); const rootIndex = args.indexOf('--root'); const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : process.cwd();
  if (action === 'sync') {
    const inputs = []; for (let index = 0; index < args.length; index++) if (args[index] === '--input') inputs.push(args[++index]);
    process.stdout.write(`${JSON.stringify(syncUsage({ root, inputs }), null, 2)}\n`); return;
  }
  if (action === 'stats') { process.stdout.write(`${JSON.stringify(readUsageStats({ root }), null, 2)}\n`); return; }
  throw new Error('Usage: node scripts/documenter-usage.mjs sync --root PATH --input usage.jsonl [--input usage2.jsonl] | stats --root PATH');
}
try { main(); } catch (error) { process.stderr.write(`Documenter usage: ${error.message}\n`); process.exitCode = 1; }
