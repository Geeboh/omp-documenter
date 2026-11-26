import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STYLE_EXISTING_UNAVAILABLE,
  STYLE_SOURCE_UNAVAILABLE,
  createFreshProfile,
  extractStyleProfile,
  hashStyleProfile,
  parseStyleProfile,
  resolveStyle,
  serializeStyleProfile,
} from '../lib/style.mjs';

const NOW = '2026-11-26T00:00:00.000Z';

function sourceDocument(content = '# Project guide\n\nUse sentence case.\n') {
  return { path: 'docs/guide.md', content, role: 'project-documentation' };
}

test('default resolution prefers saved Existing, then usable docs, then versioned Fresh', () => {
  const fresh = createFreshProfile({ now: NOW });
  const fromDocs = resolveStyle({ existingDocuments: [sourceDocument()], now: NOW });
  const saved = resolveStyle({ savedProfile: fresh, existingDocuments: [sourceDocument('# Other\n')], now: NOW });

  assert.equal(saved.profileHash, fresh.profileHash);
  assert.equal(saved.origin, 'fresh');
  assert.equal(fromDocs.origin, 'existing-derived');
  assert.equal(resolveStyle({ now: NOW }).profileId, 'human-centred-v1');
});

test('explicit Existing and Fresh choices do not silently change mode', () => {
  const saved = createFreshProfile({ now: NOW });
  const existing = resolveStyle({ request: { style: 'existing' }, savedProfile: saved, now: NOW });
  const fresh = resolveStyle({ request: { style: 'fresh' }, savedProfile: saved, existingDocuments: [sourceDocument()], now: NOW });

  assert.equal(existing.profileHash, saved.profileHash);
  assert.equal(fresh.origin, 'fresh');
  assert.equal(fresh.selection, 'explicit');
  assert.notEqual(fresh.profileHash, resolveStyle({ existingDocuments: [sourceDocument()], now: NOW }).profileHash);
});

test('explicit Existing reports unavailable without Fresh fallback', () => {
  assert.throws(
    () => resolveStyle({ request: { style: 'existing' }, now: NOW }),
    error => error.code === STYLE_EXISTING_UNAVAILABLE && error.message.includes(STYLE_EXISTING_UNAVAILABLE),
  );
});

test('explicit source failure remains visible and does not fall back', () => {
  assert.throws(
    () => resolveStyle({ request: { styleFrom: path.join(os.tmpdir(), 'documenter-missing-style.md') }, now: NOW }),
    error => error.code === STYLE_SOURCE_UNAVAILABLE && error.message.includes('Cannot access source file'),
  );
});

test('source roles remain separate in provenance', () => {
  const practice = extractStyleProfile({ content: '# Guidance\n', location: 'guidance.md', role: 'editorial-guidance' }, { now: NOW });
  const example = extractStyleProfile({ content: '# Example\n', location: 'example.md', role: 'style-example' }, { now: NOW });
  const truth = extractStyleProfile({ content: '# Existing\n', location: 'existing.md', role: 'project-documentation' }, { now: NOW });

  assert.equal(practice.provenance[0].role, 'practice');
  assert.equal(example.provenance[0].role, 'style');
  assert.equal(truth.provenance[0].role, 'project-truth');
  assert.notEqual(practice.provenance[0].role, example.provenance[0].role);
  assert.notEqual(example.provenance[0].role, truth.provenance[0].role);
});

test('Fresh profile hash is stable across timestamps and JSON key order', () => {
  const first = createFreshProfile({ now: NOW });
  const second = createFreshProfile({ now: '2027-01-01T00:00:00.000Z' });
  const reordered = { ...second, rules: { ...second.rules, voice: [...second.rules.voice] }, profileHash: '0'.repeat(64) };

  assert.equal(first.profileHash, second.profileHash);
  assert.equal(hashStyleProfile(first), hashStyleProfile(reordered));
});

test('local Markdown and HTML extraction is bounded and non-executing', () => {
  const html = '<html><script>globalThis.shouldNotRun = true</script><h1>Page title</h1><p>Readable text.</p><pre><code>document.querySelector("x")</code></pre></html>';
  const profile = extractStyleProfile({ content: html, format: 'html', location: 'reference.html', role: 'style-example' }, { now: NOW });
  assert.equal(profile.provenance[0].contentHash.length, 64);
  assert.equal(profile.provenance[0].role, 'style');
  assert.match(profile.rules.headings[0], /observed depth 1/);
  assert.equal(profile.examples.length, 1);
  assert.doesNotMatch(profile.rules.audience.join(' '), /shouldNotRun/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-style-'));
  try {
    const file = path.join(root, 'guide.md');
    fs.writeFileSync(file, '# File guide\n\n```sh\necho ok\n```\n');
    const fromFile = extractStyleProfile({ path: file, role: 'style-example' }, { now: NOW });
    assert.equal(fromFile.provenance[0].location, file);
    assert.equal(fromFile.examples[0].text, 'echo ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('serialized adopted profile is reusable offline', () => {
  const original = extractStyleProfile({ content: '# Adopted\n\nKeep this voice.\n', location: 'offline.md', role: 'style-example' }, { now: NOW });
  const serialized = serializeStyleProfile(original);
  const parsed = parseStyleProfile(serialized);
  const reused = resolveStyle({ savedProfile: serialized, now: '2027-01-01T00:00:00.000Z' });

  assert.equal(parsed.profileHash, original.profileHash);
  assert.equal(reused.profileHash, original.profileHash);
  assert.equal(reused.provenance[0].location, 'offline.md');
});
