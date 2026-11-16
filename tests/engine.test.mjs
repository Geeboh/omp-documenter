import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runOperation } from '../lib/engine.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const source = 'export function double(value) {\n  return value * 2;\n}\n';
const page = '# API\n\n## Double\n\n`double(value)` multiplies the value by two.\n';
function fixture(t, initial = { 'src/math.js': source }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(initial)) put(root, name, content);
  return root;
}
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
function json(root, rel) { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
function op(root, action, input, strict = false) {
  if (action === 'record' && input && !Object.prototype.hasOwnProperty.call(input, 'expectedSnapshot')) input = { ...input, expectedSnapshot: runOperation('status', { root }).snapshot };
  return runOperation(action, { root, input, strict });
}
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function evidence(rel = 'src/math.js', contents = source) {
  return { path: rel, sha256: hash(contents), startLine: contents ? 1 : 0, endLine: contents ? 1 : 0 };
}
function recordComplete(root) {
  const review = { path: 'src/math.js', sha256: hash(source), summary: 'Inspected the only function and its return expression.', documents: ['docs/documenter/api.md'], symbols: [{ name: 'double', kind: 'function', signature: 'double(value)', doc: 'docs/documenter/api.md#double' }] };
  const documentReview = { path: 'docs/documenter/api.md', sha256: hash(page), summary: 'Checked instructions, terminology and the single behavior statement against source.', documents: [], symbols: [] };
  return op(root, 'record', { reviews: [review, documentReview], claims: [{ id: 'math.double', text: 'double multiplies its input by two.', status: 'supported', evidence: [evidence()], documents: ['docs/documenter/api.md'] }] });
}
function ready(root) {
  op(root, 'scan');
  assert.equal(op(root, 'publish', { path: 'docs/documenter/api.md', content: page, expectedSha256: null }).ok, true);
  recordComplete(root);
}

test('scan creates bounded state but does not claim review or documentation', t => {
  const root = fixture(t);
  const result = op(root, 'scan');
  assert.equal(result.coverage.reviewed.count, 0);
  assert.equal(result.coverage.documented.count, 0);
  assert.equal(result.coverage.documented.denominator, 1);
  assert.equal(result.coverage.symbols.percent, null);
  assert.equal(result.configuration.parallel.mode, 'auto');
  assert.equal(result.configuration.parallel.maxWorkers, 3);
  assert.equal(op(root, 'check', undefined, true).ok, false);
  assert.equal(fs.existsSync(path.join(root, '.documenter/write.lock')), false);
});

test('current evidence and reviewed pages can pass mechanical strict checks', t => {
  const root = fixture(t); ready(root);
  const result = op(root, 'check', undefined, true);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.coverage.reviewed.percent, 100);
  assert.equal(result.coverage.documented.percent, 100);
  assert.equal(result.coverage.documentationPages.percent, 100);
  assert.equal(result.coverage.claims.supported, 1);
  assert.match(result.note, /not a guarantee/);
});

test('status and check are live and read-only, even before an initial scan', t => {
  const root = fixture(t);
  assert.equal(op(root, 'status').scope.eligibleFiles, 1);
  assert.equal(op(root, 'check').ok, true);
  assert.equal(fs.existsSync(path.join(root, '.documenter')), false);
  ready(root);
  put(root, 'src/math.js', source.replace('* 2', '* 3'));
  const beforeState = fs.readFileSync(path.join(root, '.documenter/inventory.json'));
  const result = op(root, 'status');
  assert.equal(result.coverage.claims.stale, 1);
  assert.equal(result.coverage.reviewed.count, 0);
  assert.equal(result.changes.changed.count, 1);
  assert.equal(op(root, 'check').ok, false);
  assert.deepEqual(fs.readFileSync(path.join(root, '.documenter/inventory.json')), beforeState);
});

test('new and deleted files invalidate cross-file records conservatively', t => {
  const root = fixture(t); ready(root);
  put(root, 'new feature.js', 'export const flag = true;\n');
  let result = op(root, 'status');
  assert.deepEqual(result.changes.added.paths, ['new feature.js']);
  assert.equal(result.coverage.claims.stale, 1);
  fs.unlinkSync(path.join(root, 'src/math.js'));
  result = op(root, 'status');
  assert.deepEqual(result.changes.deleted.paths, ['src/math.js']);
  assert.equal(result.coverage.documented.count, 0);
});

test('stale worker analysis cannot acquire a fresh snapshot implicitly', t => {
  const root = fixture(t);
  const scan = op(root, 'scan');
  const review = { path: 'src/math.js', sha256: hash(source), summary: 'Read this source in the original snapshot.', documents: [], symbols: [] };
  assert.throws(() => runOperation('record', { root, input: { reviews: [review] } }), /record.expectedSnapshot/);
  put(root, 'dependency.json', '{"mode":"changed"}\n');
  assert.throws(() => op(root, 'record', { expectedSnapshot: scan.snapshot, reviews: [review] }), /snapshot changed since analysis/);
  assert.equal(fs.existsSync(path.join(root, '.documenter/ledger.json')), false);
});

test('deleted-source findings can be retired with their original history preserved', t => {
  const root = fixture(t); ready(root);
  fs.unlinkSync(path.join(root, 'src/math.js'));
  const result = op(root, 'record', {
    retireReviews: [{ path: 'src/math.js', reason: 'The function was removed; affected documentation has been flagged for replacement.' }],
    retireClaims: [{ id: 'math.double', reason: 'The implementation no longer exists in the current tree.' }],
  });
  assert.equal(result.recorded.retiredReviews, 1);
  assert.equal(result.recorded.retiredClaims, 1);
  const ledger = json(root, '.documenter/ledger.json');
  assert.equal(ledger.retired.length, 2);
  assert.equal(ledger.retired.find(entry => entry.kind === 'claim').record.text, 'double multiplies its input by two.');
  assert.equal(ledger.claims.length, 0);
  assert.equal(op(root, 'status').attention.staleReviews.includes('src/math.js'), false);
  assert.equal(op(root, 'check', undefined, true).complete, false);
  assert.throws(() => op(root, 'record', { retireClaims: [{ id: 'typo', reason: 'No such claim exists.' }] }), /unknown claim/);
});

test('Git inventory notices tracked deletion and filenames with spaces and newlines', t => {
  const root = fixture(t, { 'src/a file\nnext.js': 'export const n = 1;\n' });
  git(root, 'init', '-q'); git(root, 'add', '.');
  const result = op(root, 'scan');
  assert.equal(result.scope.eligibleFiles, 1);
  assert.equal(json(root, '.documenter/inventory.json').files[0].path, 'src/a file\nnext.js');
  fs.unlinkSync(path.join(root, 'src/a file\nnext.js'));
  assert.deepEqual(op(root, 'status').changes.deleted.paths, ['src/a file\nnext.js']);
});

test('human-owned documentation is preserved even when the expected hash matches', t => {
  const human = '# Important notes\n\nKeep this hand-written explanation.\n';
  const root = fixture(t, { 'src/math.js': source, 'docs/documenter/manual.md': human });
  const result = op(root, 'publish', { path: 'docs/documenter/manual.md', content: '# Replacement\n', expectedSha256: hash(human) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /human-owned/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/documenter/manual.md'), 'utf8'), human);
  assert.equal(fs.readFileSync(path.join(root, result.proposal), 'utf8'), '# Replacement\n');
});

test('manual edits to generated pages prevent overwrite and invalidate coverage', t => {
  const root = fixture(t); ready(root);
  const humanEdit = page + '\nA useful operator note.\n';
  put(root, 'docs/documenter/api.md', humanEdit);
  const result = op(root, 'publish', { path: 'docs/documenter/api.md', content: '# Automatic replacement\n', expectedSha256: hash(humanEdit) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /manual changes/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/documenter/api.md'), 'utf8'), humanEdit);
  const status = op(root, 'status');
  assert.deepEqual(status.attention.stalePages, ['docs/documenter/api.md']);
  assert.equal(status.coverage.documented.count, 0);
});

test('owned replacement creates a recoverable backup and guards concurrent changes', t => {
  const root = fixture(t);
  const first = op(root, 'publish', { path: 'docs/documenter/api.md', content: page, expectedSha256: null });
  const replaced = op(root, 'publish', { path: 'docs/documenter/api.md', content: page + '\nUpdated.\n', expectedSha256: first.sha256 });
  assert.equal(replaced.ok, true);
  assert.equal(fs.readFileSync(path.join(root, replaced.journal.replace(/\.json$/, '.before.md')), 'utf8'), page);
  const stale = op(root, 'publish', { path: 'docs/documenter/api.md', content: '# Stale write\n', expectedSha256: first.sha256 });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /changed after/);
});

test('a manual edit during replacement preparation is preserved', { skip: process.platform !== 'linux' }, t => {
  const root = fixture(t);
  op(root, 'publish', { path: 'docs/documenter/api.md', content: page, expectedSha256: null });
  const manual = page + '\nConcurrent human edit.\n';
  const original = fs.fsyncSync;
  let injected = false;
  fs.fsyncSync = fd => {
    const file = fs.readlinkSync(`/proc/self/fd/${fd}`);
    if (!injected && file.includes('/docs/documenter/api.md.tmp-')) { injected = true; put(root, 'docs/documenter/api.md', manual); }
    return original(fd);
  };
  try {
    const result = op(root, 'publish', { path: 'docs/documenter/api.md', content: '# Changed\n', expectedSha256: hash(page) });
    assert.equal(result.ok, false);
    assert.equal(result.conflict, true);
    assert.equal(fs.readFileSync(path.join(root, 'docs/documenter/api.md'), 'utf8'), manual);
  } finally { fs.fsyncSync = original; }
});

test('pre-existing unowned pages remain visible to review coverage and link checks', t => {
  const root = fixture(t, { 'src/math.js': source, 'docs/documenter/manual.md': '# Notes\n\n[Missing](gone.md)\n' });
  const status = op(root, 'scan');
  assert.equal(status.scope.documentationPages, 1);
  assert.deepEqual(status.attention.unreviewedDocumentation, ['docs/documenter/manual.md']);
  assert.equal(json(root, '.documenter/inventory.json').documents.length, 1);
  const check = op(root, 'check');
  assert.equal(check.ok, false);
  assert.equal(check.links.failures[0].page, 'docs/documenter/manual.md');
});

test('documentation creation does not alter source snapshot and generated pages need review', t => {
  const root = fixture(t);
  const before = op(root, 'scan').snapshot;
  op(root, 'publish', { path: 'docs/documenter/api.md', content: page, expectedSha256: null });
  const after = op(root, 'scan');
  assert.equal(after.snapshot, before);
  assert.equal(after.coverage.documentationPages.count, 0);
  assert.deepEqual(after.attention.unreviewedDocumentation, ['docs/documenter/api.md']);
});

test('source hashes, evidence ranges and uncertainty fields are validated', t => {
  const root = fixture(t); op(root, 'scan');
  const claim = { id: 'c1', text: 'A statement.', status: 'supported', evidence: [evidence()], documents: [] };
  assert.throws(() => op(root, 'record', { claims: [{ ...claim, evidence: [{ ...evidence(), sha256: 'a'.repeat(64) }] }] }), /hash changed or is incorrect/);
  assert.throws(() => op(root, 'record', { claims: [{ ...claim, evidence: [{ ...evidence(), endLine: 500 }] }] }), /range exceeds/);
  assert.throws(() => op(root, 'record', { claims: [{ ...claim, evidence: [] }] }), /requires source evidence/);
  assert.throws(() => op(root, 'record', { claims: [{ ...claim, status: 'unknown', evidence: [] }] }), /claim.reason/);
  assert.throws(() => op(root, 'record', { claims: [{ ...claim, evidence: [{ ...evidence(), startLine: 0, endLine: 0 }] }] }), /range exceeds/);
  assert.throws(() => op(root, 'record', { extra: [] }), /Unknown record input/);
  assert.equal(fs.existsSync(path.join(root, '.documenter/ledger.json')), false);
});

test('empty-file evidence is exactly 0,0 and supports honest reviewed coverage', t => {
  const root = fixture(t, { '.gitkeep': '' });
  op(root, 'scan');
  assert.doesNotThrow(() => op(root, 'record', { claims: [{ id: 'empty', text: '.gitkeep is empty in this snapshot.', status: 'supported', evidence: [evidence('.gitkeep', '')], documents: [] }] }));
  assert.throws(() => op(root, 'record', { claims: [{ id: 'bad-empty', text: 'Line one exists.', status: 'supported', evidence: [{ path: '.gitkeep', sha256: hash(''), startLine: 1, endLine: 1 }], documents: [] }] }), /range exceeds/);
});

test('open unknowns make strict completion false and retain actionable next steps', t => {
  const root = fixture(t); ready(root);
  const unknown = { id: 'u1', question: 'Which deployment is active?', whyItMatters: 'The deployment procedure depends on it.', nextSteps: ['Inspect the intended deployment configuration.'], status: 'open' };
  op(root, 'record', { unknowns: [unknown] });
  const result = op(root, 'check', undefined, true);
  assert.equal(result.ok, false);
  assert.equal(result.attention.openUnknowns[0].nextSteps[0], unknown.nextSteps[0]);
  op(root, 'record', { unknowns: [{ ...unknown, status: 'resolved', resolution: 'Deployment is intentionally not configured; documented as unavailable.' }] });
  assert.equal(op(root, 'check', undefined, true).ok, true);
});

test('symlink source and documentation paths are not followed', t => {
  const root = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  put(outside, 'secret.txt', 'private material');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'docs/documenter'));
  const result = op(root, 'scan');
  assert.equal(result.attention.gaps.length, 1);
  assert.equal(result.attention.documentationGaps.length, 1);
  assert.equal(JSON.stringify(result).includes('private material'), false);
  assert.throws(() => op(root, 'publish', { path: 'docs/documenter/new.md', content: '# New\n', expectedSha256: null }), /symbolic-link/);
  assert.equal(fs.existsSync(path.join(outside, 'new.md')), false);
});

test('symlink state, config, source parents and hardlinked output are refused', t => {
  const root = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, '.documenter'));
  assert.throws(() => op(root, 'scan'), /symbolic-link/);
  fs.unlinkSync(path.join(root, '.documenter')); fs.mkdirSync(path.join(root, '.documenter'));
  put(outside, 'config.json', '{}');
  fs.symlinkSync(path.join(outside, 'config.json'), path.join(root, '.documenter/config.json'));
  assert.throws(() => op(root, 'scan'), /symbolic-link/);
  fs.unlinkSync(path.join(root, '.documenter/config.json'));
  put(root, 'docs/documenter/manual.md', page);
  fs.linkSync(path.join(root, 'docs/documenter/manual.md'), path.join(outside, 'linked.md'));
  assert.throws(() => op(root, 'publish', { path: 'docs/documenter/manual.md', content: '# New\n', expectedSha256: hash(page) }), /hardlinked/);
  assert.equal(fs.readFileSync(path.join(outside, 'linked.md'), 'utf8'), page);
});

test('traversal, absolute paths, non-Markdown output and state output are refused', t => {
  const root = fixture(t);
  for (const name of ['../escape.md', '/tmp/escape.md', 'docs/documenter/../../escape.md', 'docs/documenter/file.js', '.documenter/evil.md', 'docs\\documenter\\evil.md']) {
    assert.throws(() => op(root, 'publish', { path: name, content: '# No\n', expectedSha256: null }));
  }
});

test('configured exclusions are exact prefixes and sensitive files are metadata-only gaps', t => {
  const root = fixture(t, { 'vendor/lib.js': 'third party', 'vendor2/lib.js': 'first party', '.env': 'TOKEN=secret-value', '.env.example': 'TOKEN=example', 'asset.bin': Buffer.from([0, 1, 2]), 'large.txt': 'x'.repeat(100) });
  put(root, '.documenter/config.json', JSON.stringify({ version: 1, exclude: ['vendor'], maxFileBytes: 50 }));
  const result = op(root, 'scan');
  const inventory = json(root, '.documenter/inventory.json');
  assert.equal(inventory.files.find(file => file.path === 'vendor2/lib.js').eligible, true);
  assert.equal(inventory.files.some(file => file.path === 'vendor/lib.js'), false);
  assert.equal(inventory.files.find(file => file.path === '.env').reason, 'sensitive-file');
  assert.equal(inventory.files.find(file => file.path === '.env').sha256, undefined);
  assert.equal(inventory.files.find(file => file.path === '.env.example').eligible, true);
  assert.equal(inventory.files.find(file => file.path === 'asset.bin').reason, 'binary-or-non-utf8');
  assert.equal(inventory.files.find(file => file.path === 'large.txt').reason, 'oversize');
  assert.equal(JSON.stringify(inventory).includes('secret-value'), false);
  assert.equal(result.scope.gaps, 3);
});

test('ignored paths are disclosed and tracked files bypass ignore hiding', t => {
  const root = fixture(t, { '.gitignore': 'ignored/\n', 'ignored/a.js': 'ignored', 'visible.js': 'visible' });
  git(root, 'init', '-q'); git(root, 'add', '.gitignore', 'visible.js');
  git(root, 'add', '-f', 'ignored/a.js');
  put(root, 'ignored/b.js', 'not tracked');
  op(root, 'scan');
  const inventory = json(root, '.documenter/inventory.json');
  assert.equal(inventory.files.find(file => file.path === 'ignored/a.js').eligible, true);
  assert.equal(inventory.files.some(file => file.path === 'ignored/b.js'), false);
  assert.equal(inventory.exclusions.some(entry => entry.reason === 'git-ignored'), true);
});

test('checked-out nested repositories are inventoried and unavailable submodules are gaps', t => {
  const root = fixture(t, { 'top.js': 'top', 'nested/child.js': 'child' });
  git(root, 'init', '-q'); git(path.join(root, 'nested'), 'init', '-q');
  git(path.join(root, 'nested'), 'add', 'child.js');
  git(root, 'add', 'top.js');
  git(root, 'update-index', '--add', '--cacheinfo', '160000,' + '1'.repeat(40) + ',missing-module');
  const result = op(root, 'scan');
  const inventory = json(root, '.documenter/inventory.json');
  assert.equal(inventory.files.some(file => file.path === 'nested/child.js' && file.eligible), true);
  assert.equal(inventory.boundaries.some(boundary => boundary.path === 'nested' && boundary.inspected), true);
  assert.equal(result.attention.gaps.some(gap => gap.path === 'missing-module' && gap.reason === 'unavailable-submodule'), true);
});

test('inventory disables Git fsmonitor callbacks and ignores inherited Git routing', t => {
  const root = fixture(t);
  git(root, 'init', '-q'); git(root, 'add', 'src/math.js');
  const callback = path.join(root, 'fsmonitor-hook');
  put(root, 'fsmonitor-hook', '#!/bin/sh\nprintf invoked > "$0.marker"\n');
  fs.chmodSync(callback, 0o700);
  git(root, 'config', 'core.fsmonitor', callback);
  const oldGitDir = process.env.GIT_DIR;
  const oldWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = '/nonexistent-documenter-git';
  process.env.GIT_WORK_TREE = '/nonexistent-documenter-worktree';
  try {
    const result = op(root, 'scan');
    assert.equal(result.git.available, true);
    assert.equal(fs.existsSync(callback + '.marker'), false);
  } finally {
    if (oldGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGitDir;
    if (oldWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = oldWorkTree;
  }
});

test('branch policy rejects writes without changing Git or creating an inventory', t => {
  const root = fixture(t); git(root, 'init', '-q');
  put(root, '.documenter/config.json', JSON.stringify({ version: 1, gitPolicy: { branchMode: 'require-docs-branch', branchPrefix: 'docs/' } }));
  assert.throws(() => op(root, 'scan'), /requires a documentation branch/);
  assert.equal(fs.existsSync(path.join(root, '.documenter/inventory.json')), false);
  assert.equal(op(root, 'status').git.available, true);
  git(root, 'symbolic-ref', 'HEAD', 'refs/heads/docs/initial');
  assert.equal(op(root, 'scan').ok, true);
});

test('existing locks are not stolen and failures release locks', t => {
  const root = fixture(t);
  put(root, '.documenter/write.lock', '{"pid":12345}\n');
  assert.throws(() => op(root, 'scan'), /write lock exists/);
  assert.equal(fs.readFileSync(path.join(root, '.documenter/write.lock'), 'utf8'), '{"pid":12345}\n');
  fs.unlinkSync(path.join(root, '.documenter/write.lock'));
  assert.throws(() => op(root, 'record', { reviews: [{ nonsense: true }] }), /Unknown review field/);
  assert.equal(fs.existsSync(path.join(root, '.documenter/write.lock')), false);
});

test('Markdown links check local files and headings without executing examples', t => {
  const root = fixture(t, { 'src/math.js': source, 'docs/documenter/guide.md': '# Guide\n\n[Valid](#guide) [Missing heading](#wrong) [Source](../../src/math.js)\n\n```sh\n[Example](not-a-link.md)\n```\n' });
  const result = op(root, 'check');
  assert.equal(result.ok, false);
  assert.equal(result.links.failures.length, 1);
  assert.equal(result.links.failures[0].target, '#wrong');
  assert.equal(result.links.checked, 2);
});

test('empty repository is not declared complete', t => {
  const root = fixture(t, {});
  const result = op(root, 'check', undefined, true);
  assert.equal(result.complete, false);
  assert.equal(result.ok, false);
  assert.equal(result.coverage.reviewed.percent, null);
});

test('config, ledger and ownership inputs reject malformed records', t => {
  const root = fixture(t);
  put(root, '.documenter/config.json', JSON.stringify({ version: 1, parallel: { mode: 'auto', maxWorkers: 9 } }));
  assert.throws(() => op(root, 'status'), /parallel.maxWorkers/);
  put(root, '.documenter/config.json', JSON.stringify({ version: 1, docsRoot: '.git/docs' }));
  assert.throws(() => op(root, 'scan'), /docsRoot cannot/);
  put(root, '.documenter/config.json', JSON.stringify({ version: 1 }));
  put(root, '.documenter/ledger.json', JSON.stringify({ version: 1, reviews: [], claims: [{ id: '../evil' }], unknowns: [] }));
  assert.throws(() => op(root, 'status'), /stable identifier/);
  fs.unlinkSync(path.join(root, '.documenter/ledger.json'));
  put(root, '.documenter/ownership.json', JSON.stringify({ version: 1, pages: [{ path: '../evil.md', sha256: 'a'.repeat(64) }] }));
  assert.throws(() => op(root, 'status'), /traversal/);
});
