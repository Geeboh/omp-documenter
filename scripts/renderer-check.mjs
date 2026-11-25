#!/usr/bin/env node
import path from 'node:path';
import { detectRenderer } from '../lib/verification.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : process.cwd();
if (args.some(arg => !['--root', rootIndex >= 0 ? args[rootIndex + 1] : ''].includes(arg))) {
  process.stderr.write('Usage: node scripts/renderer-check.mjs [--root PATH]\n');
  process.exitCode = 1;
} else process.stdout.write(`${JSON.stringify(detectRenderer(root), null, 2)}\n`);
