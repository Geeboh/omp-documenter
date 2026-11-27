import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRenderer, verifyExamples } from '../lib/verification.mjs';

test('example harness executes explicit argv without shell interpretation', () => {
  const result = verifyExamples({ examples: [{ id: 'node-version', argv: [process.execPath, '--version'], expectedExit: 0, stdoutIncludes: process.versions.bun ? '.' : 'v' }] });
  assert.equal(result.passed, true);
  assert.equal(result.results[0].argv[0], process.execPath);
  assert.equal(result.scope.includes('No shell interpretation'), true);
});

test('example receipts record environment, revision and bounded output evidence', () => {
  const result = verifyExamples({
    examples: [{
      id: 'metadata',
      argv: [process.execPath, '-e', "process.stdout.write(process.env.DOCUMENTER_EXAMPLE_LABEL + 'x'.repeat(8))"],
      environment: { DOCUMENTER_EXAMPLE_LABEL: 'ok' }
    }]
  }, { maxOutputBytes: 4 });
  const example = result.results[0];
  assert.equal(example.environment.DOCUMENTER_EXAMPLE_LABEL, 'ok');
  assert.equal(example.environment.CI, '1');
  assert.equal(example.environmentInherited, true);
  assert.ok(example.revision === null || /^[a-f0-9]{40,64}$/.test(example.revision));
  assert.equal(example.stdout.length <= 4, true);
  assert.equal(example.truncation.stdout.truncated, true);
  assert.equal(example.truncation.output.truncated, true);
  assert.equal(example.truncation.limitBytes, 4);
});

test('example harness rejects shell syntax', () => {
  assert.throws(() => verifyExamples({ examples: [{ id: 'unsafe', argv: ['sh', '-c', 'echo ok; echo bad'] }] }), /shell syntax/);
});

test('renderer detection reports configured scripts without claiming execution', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-renderer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'docs:build': 'doc-tool build' } }));
  const result = detectRenderer(root);
  const adapter = result.adapters.find(candidate => candidate.id === 'project-renderer');
  assert.equal(adapter.available, true);
  assert.deepEqual(adapter.scripts, ['docs:build']);
  assert.equal(adapter.execution.status, 'not-run');
  assert.match(adapter.limitations[0], /unverified/);
});

test('renderer detection identifies MkDocs, Docusaurus and Sphinx configuration and commands', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-renderers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      mkdocs: 'mkdocs build',
      website: 'docusaurus build',
      'docs:html': 'sphinx-build -b html docs _build'
    }
  }));
  for (const file of ['mkdocs.yml', 'docusaurus.config.ts', 'docs/conf.py']) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  }

  const result = detectRenderer(root);
  for (const [id, config, command] of [
    ['mkdocs', 'mkdocs.yml', 'mkdocs build'],
    ['docusaurus', 'docusaurus.config.ts', 'docusaurus build'],
    ['sphinx', 'docs/conf.py', 'sphinx-build -b html docs _build']
  ]) {
    const adapter = result.adapters.find(candidate => candidate.id === id);
    assert.equal(adapter.available, true);
    assert.deepEqual(adapter.configurationFiles, [config]);
    assert.equal(adapter.commands.includes(command), true);
    assert.equal(adapter.execution.status, 'not-run');
    assert.equal(adapter.execution.attempted, false);
  }
});
