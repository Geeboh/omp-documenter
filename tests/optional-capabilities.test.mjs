import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeMarkdownSections, publishExternalFiles, searchDocuments } from '../lib/optional-capabilities.mjs';

test('three-way section merge preserves non-overlapping edits and reports conflicts', () => {
  const base = '# Guide\n\n## Setup\nBase setup.\n\n## Ops\nBase ops.\n';
  const current = '# Guide\n\n## Setup\nHuman setup.\n\n## Ops\nBase ops.\n';
  const candidate = '# Guide\n\n## Setup\nBase setup.\n\n## Ops\nGenerated ops.\n';
  const result = mergeMarkdownSections(base, current, candidate);
  assert.equal(result.clean, true);
  assert.match(result.merged, /Human setup/);
  assert.match(result.merged, /Generated ops/);
});

test('lexical search returns bounded evidence-linked results', () => {
  const result = searchDocuments([{ path: 'docs/api.md', text: 'Configure the API endpoint.' }, { path: 'docs/ops.md', text: 'Restart the worker.' }], 'API endpoint');
  assert.equal(result.kind, 'lexical-search');
  assert.equal(result.results[0].path, 'docs/api.md');
  assert.match(result.fallback, /not embedding/);
});

test('external output requires explicit authority and refuses overwrite', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-external-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => publishExternalFiles({ destination: root, files: [{ path: 'guide.md', content: '# Guide\n' }] }), /allowExternalOutput/);
  const result = publishExternalFiles({ destination: root, allowExternalOutput: true, files: [{ path: 'guide.md', content: '# Guide\n' }] });
  assert.equal(result.written.length, 1);
  assert.throws(() => publishExternalFiles({ destination: root, allowExternalOutput: true, files: [{ path: 'guide.md', content: '# Changed\n' }] }), /refuses overwrite/);
});
