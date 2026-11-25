import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRenderer, verifyExamples } from '../lib/verification.mjs';

test('example harness executes explicit argv without shell interpretation', () => {
  const result = verifyExamples({ examples: [{ id: 'node-version', argv: [process.execPath, '--version'], expectedExit: 0, stdoutIncludes: 'v' }] });
  assert.equal(result.passed, true);
  assert.equal(result.results[0].argv[0], process.execPath);
  assert.equal(result.scope.includes('No shell interpretation'), true);
});

test('example harness rejects shell syntax and bounds output', () => {
  assert.throws(() => verifyExamples({ examples: [{ id: 'unsafe', argv: ['sh', '-c', 'echo ok; echo bad'] }] }), /shell syntax/);
});

test('renderer detection reports configured scripts without claiming execution', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-renderer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'docs:build': 'doc-tool build' } }));
  const result = detectRenderer(root);
  assert.equal(result.adapters[0].available, true);
  assert.deepEqual(result.adapters[0].scripts, ['docs:build']);
  assert.match(result.adapters[0].limitations[0], /unverified/);
});
