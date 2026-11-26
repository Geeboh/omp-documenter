#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const extension = path.join(packageRoot, 'src', 'index.js');
const command = process.env.DOCUMENTER_OMP_COMMAND || 'omp';
const userArgs = process.argv.slice(2);
const result = spawnSync(command, ['--no-extensions', '--extension', extension, ...userArgs], { stdio: 'inherit', env: process.env });
if (result.error) {
  process.stderr.write(`Documenter host: could not start ${command}: ${result.error.message}\n`);
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
