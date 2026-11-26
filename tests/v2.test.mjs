import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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

test('front-page manifest permits selected root entry pages during staging', t => {
  const root = fixture(t);
  put(root, 'README.md', '# Root\\n');
  const planned = runOperation('plan', { root, input: { dest: 'docs/api', frontpage: 'root', style: 'fresh' } });
  runOperation('archive', { root, input: { runId: planned.runId } });
  const staged = runOperation('stage', { root, input: { runId: planned.runId, pages: [{ path: 'README.md', content: '# Updated root\\n' }] } });
  assert.equal(staged.ok, true);
});

test('resume reconciles a promotion checkpoint from observed live hashes', t => {
  const root = fixture(t);
  const planned = runOperation('plan', { root, input: { dest: 'docs/api', style: 'fresh' } });
  runOperation('archive', { root, input: { runId: planned.runId } });
  runOperation('stage', { root, input: { runId: planned.runId, pages: [{ path: 'docs/api/api.md', content: '# API\\n' }] } });
  runOperation('validate', { root, input: { runId: planned.runId } });
  const manifestPath = path.join(root, `.documenter/runs/${planned.runId}/manifest.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.status = 'promoting';
  manifest.candidateGenerationId = 'resume-generation';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const resumed = runOperation('resume', { root, input: { runId: planned.runId } });
  assert.equal(resumed.status, 'active');
});

test('restore requires live hashes and rejects non-document archive paths', t => {
  const root = fixture(t);
  const planned = runOperation('plan', { root, input: { dest: 'docs/documenter', style: 'fresh' } });
  const archived = runOperation('archive', { root, input: { runId: planned.runId } });
  const pagePath = path.join(root, 'docs/documenter/guide.md');
  fs.writeFileSync(pagePath, '# Human edit\\n');
  assert.throws(() => runOperation('restore', { root, input: { archiveId: archived.archiveId } }), /expectedDocumentHashes/);
  const restored = runOperation('restore', { root, input: { archiveId: archived.archiveId, expectedDocumentHashes: { 'docs/documenter/guide.md': sha256('# Human edit\\n') } } });
  assert.equal(restored.ok, true);
  const manifestPath = path.join(root, `.documenter/archives/${archived.archiveId}/manifest.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.entries[0].path = 'src/app.js';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  assert.throws(() => runOperation('restore', { root, input: { archiveId: archived.archiveId, expectedDocumentHashes: { 'src/app.js': sha256('export const answer = 42;\\n') } } }), /Markdown/);
});

test('excluded observations do not change the source evidence snapshot', t => {
  const root = fixture(t);
  put(root, '.gitignore', 'debug.log');
  spawnSync('git', ['-C', root, 'init', '-q']);
  spawnSync('git', ['-C', root, 'add', '.']);
  const before = runOperation('scan-v2', { root });
  put(root, 'debug.log', 'transient');
  const after = runOperation('scan-v2', { root });
  assert.equal(after.inventory.snapshot, before.inventory.snapshot);
  assert.notEqual(after.inventory.observationSnapshot, before.inventory.observationSnapshot);
});

test('claim dependencies invalidate affected claims without changing unrelated evidence', t => {
  const root = fixture(t);
  const scan = runOperation('scan', { root });
  const source = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'docs/documenter/guide.md'), 'utf8');
  const claim = {
    id: 'answer',
    text: 'answer is 42.',
    status: 'supported',
    evidence: [{ path: 'src/app.js', sha256: sha256(source), startLine: 1, endLine: 1 }],
    dependencies: [{ path: 'docs/documenter/guide.md', sha256: sha256(page) }],
    documents: []
  };
  runOperation('record', { root, input: { expectedSnapshot: scan.snapshot, claims: [claim] } });
  const indexes = JSON.parse(fs.readFileSync(path.join(root, '.documenter/indexes.json'), 'utf8'));
  assert.deepEqual(indexes.sourceToClaims['docs/documenter/guide.md'], ['answer']);
  fs.writeFileSync(path.join(root, 'docs/documenter/guide.md'), `${page}\\nUpdated.`);
  const status = runOperation('status', { root });
  assert.equal(status.coverage.claims.stale, 1);
});

test('inventory cancellation stops at a safe traversal boundary', t => {
  const root = fixture(t);
  for (let index = 0; index < 100; index++) put(root, `src/generated-${index}.js`, 'export const n = 1;');
  const controller = new AbortController();
  assert.throws(() => runOperation('status', { root, signal: controller.signal, onUpdate: () => controller.abort() }), /cancelled/i);
});

test('broken-link diagnostics are item-bounded and retrievable by cursor', t => {
  const root = fixture(t);
  const links = Array.from({ length: 1000 }, (_, index) => `[Missing ${index}](missing-${index}.md)`).join('\\n');
  put(root, 'docs/documenter/links.md', `# Links\\n\\n${links}\\n`);
  const result = runOperation('check', { root });
  assert.equal(result.links.totalFailures, 1000);
  assert.equal(result.links.failures.length, 100);
  assert.ok(result.links.detailResultId);
  const details = runOperation('details', { root, input: { resultId: result.links.detailResultId, offset: 10, limit: 5 } });
  assert.equal(details.total, 1000);
  assert.equal(details.items.length, 5);
});

test('fault injection leaves resumable lifecycle state', t => {
  const root = fixture(t);
  const planned = runOperation('plan', { root, input: { dest: 'docs/api', style: 'fresh', testFaultAt: 'archive:copy' } });
  assert.throws(() => runOperation('archive', { root, input: { runId: planned.runId } }), /Injected Documenter fault/);
  const manifestPath = path.join(root, `.documenter/runs/${planned.runId}/manifest.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.status, 'planned');
  manifest.testFaultAt = null;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const archived = runOperation('archive', { root, input: { runId: planned.runId } });
  assert.equal(archived.verified, true);
});
