#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function usage() {
  return 'Usage: node scripts/omp-host-matrix.mjs [--command PATH] [--extension PATH] [--output FILE] [--require-host]';
}

function parseArgs(argv) {
  const values = { command: process.env.DOCUMENTER_OMP_COMMAND || 'omp', extension: path.join(packageRoot, 'src', 'index.js'), output: null, requireHost: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--require-host') {
      values.requireHost = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--command', '--extension', '--output'].includes(argument)) throw new Error(`${usage()}\nUnknown option: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    if (argument === '--command') values.command = value;
    if (argument === '--extension') values.extension = path.resolve(value);
    if (argument === '--output') values.output = path.resolve(value);
  }
  return values;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    args,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout || '').slice(0, 16_384),
    stderr: String(result.stderr || '').slice(0, 16_384),
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

function probe(options) {
  const version = run(options.command, ['--version']);
  const extension = run(options.command, [
    '--no-extensions', '--extension', options.extension, '--no-session', '--mode', 'json', '--print', '/documenter status',
  ]);
  const versionAvailable = version.status === 0 && !version.error;
  const extensionLoaded = extension.status === 0 && !extension.error && /documenter-report|documenter/i.test(extension.stdout);
  return {
    schemaVersion: 1,
    host: process.env.DOCUMENTER_OMP_HOST_NAME || options.command,
    command: options.command,
    extension: options.extension,
    version: { ...version, available: versionAvailable },
    load: { ...extension, available: extensionLoaded },
    status: versionAvailable && extensionLoaded ? 'passed' : 'unavailable',
    limitations: versionAvailable && extensionLoaded
      ? []
      : ['A real OMP executable and extension load were not both available in this environment.'],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = probe(options);
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, payload, { flag: 'wx' });
  }
  process.stdout.write(payload);
  if (options.requireHost && result.status !== 'passed') process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`OMP host matrix: ${error.message}\n`);
  process.exitCode = 1;
}
