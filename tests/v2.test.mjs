import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runOperation } from '../lib/engine.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function put(root, rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, 'src/app.js', 'export const answer = 42;\n');
  put(root, 'docs/documenter/guide.md', '# Guide\n\n[Source](../../src/app.js)\n');
  return root;
}

test('v2 dry-run resolves Existing style and destination without state writes', t => {
  const root = fixture(t);
  const result = runOperation('preview', { root, input: { dest: 'Project Documentation', frontpage: 'all' } });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.set.destination, 'Project Documentation');
  assert.equal(result.style.origin, 'existing-derived');
  assert.equal(fs.existsSync(path.join(root, '.documenter')), false);
});

test('v2 plan through promotion preserves exact staged bytes and generation identity', t => {
  const root = fixture(t);
  const planned = runOperation('plan', { root, input: { dest: 'docs/api', style: 'fresh' } });
  assert.equal(planned.ok, true);
  const runId = planned.runId;
  const archived = runOperation('archive', { root, input: { runId } });
  assert.equal(archived.verified, true);
  const content = '# API\n\nUse `answer`.\n';
  const staged = runOperation('stage', { root, input: { runId, pages: [{ path: 'docs/api/api.md', content }] } });
  assert.equal(staged.stagedFiles[0].sha256, sha256(content));
  const validated = runOperation('validate', { root, input: { runId } });
  assert.equal(validated.passed, true);
  const promoted = runOperation('promote', { root, input: { runId } });
  assert.equal(promoted.status, 'active');
  assert.equal(fs.readFileSync(path.join(root, 'docs/api/api.md'), 'utf8'), content);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, `.documenter/runs/${runId}/manifest.json`), 'utf8')).status, 'active');
});

test('v2 page lifecycle accepts edits then releases, renames and retires with history', t => {
  const root = fixture(t);
  const page = path.join(root, 'docs/documenter/guide.md');
  const original = fs.readFileSync(page, 'utf8');
  const accepted = `${original}\nOperator note.\n`;
  fs.writeFileSync(page, accepted);
  const accept = runOperation('page', { root, input: { operation: 'accept', path: 'docs/documenter/guide.md', expectedSha256: sha256(accepted), reason: 'Reviewed current operator note.' } });
  assert.equal(accept.ok, true);
  const release = runOperation('page', { root, input: { operation: 'release', path: 'docs/documenter/guide.md', expectedSha256: sha256(accepted), reason: 'Human maintains this page.' } });
  assert.equal(release.ok, true);
  const renamed = runOperation('page', { root, input: { operation: 'rename', path: 'docs/documenter/guide.md', newPath: 'docs/documenter/operator-guide.md', expectedSha256: sha256(accepted) } });
  assert.equal(renamed.ok, true);
  const retired = runOperation('page', { root, input: { operation: 'retire', path: 'docs/documenter/operator-guide.md', expectedSha256: sha256(accepted), reason: 'Replaced by the API guide.' } });
  assert.equal(retired.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'docs/documenter/operator-guide.md')), true);
  const state = JSON.parse(fs.readFileSync(path.join(root, '.documenter/sets/default/pages.json'), 'utf8'));
  assert.equal(state.history.length, 2);
});

test('explicit missing style source fails without selecting Fresh', t => {
  const root = fixture(t);
  assert.throws(() => runOperation('style', { root, input: { operation: 'import', source: 'missing-style.md' } }), /style source|STYLE_SOURCE_UNAVAILABLE/i);
  assert.equal(fs.existsSync(path.join(root, '.documenter/styles')), false);
});

test('explicit destination values preserve quoted-path semantics at the engine boundary', t => {
  const root = fixture(t);
  const result = runOperation('preview', { root, input: { dest: 'Project Documentation', frontpage: 'all' } });
  assert.equal(result.set.destination, 'Project Documentation');
  assert.throws(() => runOperation('preview', { root, input: { style: 'fresh', styleFrom: 'guide.md' } }), /STYLE_SELECTION_CONFLICT|choose one/i);
});
