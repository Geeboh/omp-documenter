import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const wrapper = path.join(root, 'scripts', 'omp-documenter-host.mjs');

test('host wrapper disables auto-loaded plugins without changing them', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-host-wrapper-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fake = path.join(temp, 'omp');
  const argsFile = path.join(temp, 'args');
  fs.writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$@" > "$DOCUMENTER_ARGS"\n');
  fs.chmodSync(fake, 0o755);
  const result = spawnSync(process.execPath, [wrapper, '--print', 'status'], { env: { ...process.env, DOCUMENTER_OMP_COMMAND: fake, DOCUMENTER_ARGS: argsFile }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
  assert.deepEqual(args.slice(0, 2), ['--no-extensions', '--extension']);
  assert.equal(path.resolve(args[2]), path.join(root, 'src', 'index.js'));
  assert.deepEqual(args.slice(3), ['--print', 'status']);
});
