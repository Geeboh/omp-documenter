import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDependencyGraph,
  buildLexicalIndex,
  mergeMarkdownSections,
  publishExternalFiles,
  searchDocuments,
  searchIndexedDocuments
} from '../lib/optional-capabilities.mjs';

test('three-way section merge preserves non-overlapping edits and reports conflicts', () => {
  const base = '# Guide\n\n## Setup\nBase setup.\n\n## Ops\nBase ops.\n';
  const current = '# Guide\n\n## Setup\nHuman setup.\n\n## Ops\nBase ops.\n';
  const candidate = '# Guide\n\n## Setup\nBase setup.\n\n## Ops\nGenerated ops.\n';
  const result = mergeMarkdownSections(base, current, candidate);
  assert.equal(result.clean, true);
  assert.match(result.merged, /Human setup/);
  assert.match(result.merged, /Generated ops/);
});

test('section merge reports insertions, moves, conflicts and interruption without overwriting current text', () => {
  const base = '# Guide\n\n## Setup {#setup}\nBase setup.\n\n## Ops {#ops}\nBase ops.\n';
  const inserted = mergeMarkdownSections(base, base, '# Guide\n\n## Ops {#ops}\nBase ops.\n\n## Setup {#setup}\nBase setup.\n\n## New {#new}\nGenerated.\n');
  assert.deepEqual(inserted.insertions.map(entry => entry.section), ['id:new']);
  assert.ok(inserted.moves.some(move => move.section === 'id:setup'));
  assert.match(inserted.merged, /## New/);

  const conflict = mergeMarkdownSections(base, '# Guide\n\n## Setup {#setup}\nHuman setup.\n\n## Ops {#ops}\nBase ops.\n', '# Guide\n\n## Setup {#setup}\nGenerated setup.\n\n## Ops {#ops}\nBase ops.\n');
  assert.equal(conflict.clean, false);
  assert.equal(conflict.conflicts[0].reason, 'content');
  assert.match(conflict.merged, /Human setup/);

  const interrupted = mergeMarkdownSections(base, '# Guide\n\n## Setup {#setup}\nHuman setup.\n', '# Guide\n\n## Setup {#setup}\nGenerated setup.\n', { interrupted: true });
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.merged, '# Guide\n\n## Setup {#setup}\nHuman setup.\n');
});

test('dependency and impact graph traverses explicit interfaces and falls back for dynamic records', () => {
  const graph = buildDependencyGraph({
    files: [
      { path: 'src/a.js', dependencies: ['src/b.js'] },
      { path: 'src/b.js', dependencies: [] },
      { path: 'src/c.js', dependencies: [] }
    ],
    interfaces: [{ id: 'api', path: 'src/b.js', consumers: ['src/a.js'], complete: true }],
    changes: [{ path: 'src/b.js', status: 'changed' }]
  });
  assert.equal(graph.complete, true);
  assert.deepEqual(graph.impacted, ['interface:api', 'src/a.js', 'src/b.js']);
  assert.deepEqual(graph.unaffected, ['src/c.js']);

  const conservative = buildDependencyGraph({
    files: [
      { path: 'src/a.js', dependencies: ['src/b.js'], dynamic: true },
      { path: 'src/b.js', dependencies: [] }
    ],
    changes: [{ path: 'src/b.js', status: 'changed' }]
  });
  assert.equal(conservative.complete, false);
  assert.equal(conservative.fallback.mode, 'all-files');
  assert.deepEqual(conservative.unaffected, []);
  const config = buildDependencyGraph({
    files: [{ path: 'config.json', dependencies: [], config: true }],
    changes: [{ path: 'config.json', status: 'changed' }]
  });
  assert.ok(config.unknowns.some(unknown => unknown.code === 'configuration-dependency' || unknown.code === 'config-change'));
});

test('indexed lexical search is deterministic, content-addressed and semantic-disabled', () => {
  const documents = [
    { path: 'docs/api.md', text: 'Configure the API endpoint.' },
    { path: 'docs/ops.md', text: 'Restart the worker.' }
  ];
  const index = buildLexicalIndex(documents);
  assert.equal(buildLexicalIndex([...documents].reverse()).corpusDigest, index.corpusDigest);
  const result = searchIndexedDocuments(index, 'API endpoint');
  assert.equal(result.results[0].path, 'docs/api.md');
  assert.equal(result.corpusDigest, index.corpusDigest);
  assert.equal(result.semantic.enabled, false);
  assert.match(result.fallback, /not embedding/);

  const changed = buildLexicalIndex([{ ...documents[0], text: 'Configure the API route.' }, documents[1]], { previousIndex: index });
  assert.notEqual(changed.corpusDigest, index.corpusDigest);
  assert.deepEqual(changed.invalidation.changed, ['docs/api.md']);
  assert.deepEqual(changed.invalidation.unchanged, ['docs/ops.md']);
  const reused = searchDocuments([{ ...documents[0], text: 'Configure the API route.' }, documents[1]], 'API', { index });
  assert.equal(reused.indexed, true);
  assert.throws(() => searchDocuments(documents, 'API', { semantic: true }), /Semantic search is disabled/);
});

test('overlap ranking remains the default and explicit compatibility mode', () => {
  const documents = [
    { path: 'docs/api.md', text: 'Configure the API endpoint.' },
    { path: 'docs/ops.md', text: 'Restart the worker.' }
  ];
  const index = buildLexicalIndex(documents);
  const implicit = searchIndexedDocuments(index, 'API endpoint');
  const explicit = searchIndexedDocuments(index, 'API endpoint', { ranking: 'overlap' });
  assert.deepEqual(implicit.results, explicit.results);
  assert.equal(implicit.results[0].score, 2);
  assert.equal(implicit.results[0].scoreComponents, undefined);
});

test('weighted-v1 exposes field components and ranks path and heading matches', () => {
  const documents = [
    { path: 'reference/api.md', text: '# API endpoint\nConfigure endpoint.' },
    { path: 'notes/general.md', text: 'API endpoint is discussed.' }
  ];
  const index = buildLexicalIndex(documents);
  const indexedDocument = index.documents.find(document => document.path === 'reference/api.md');
  assert.deepEqual(indexedDocument.pathTokens, ['reference', 'api', 'md']);
  assert.deepEqual(indexedDocument.headingTokens, ['api', 'endpoint']);
  assert.deepEqual(indexedDocument.textTokens, ['configure', 'endpoint']);
  assert.equal(indexedDocument.textPresent, true);

  const result = searchIndexedDocuments(index, 'API endpoint', { ranking: 'weighted-v1' });
  const [first, second] = result.results;
  assert.equal(result.ranking, 'weighted-v1');
  assert.equal(first.ranking, 'weighted-v1');
  assert.deepEqual(first.scoreComponents, { pathMatch: 3, headingMatch: 4, textMatch: 1, phraseMatch: 4, rarity: 2 });
  assert.equal(first.score, 14);
  assert.ok(first.score > second.score);
  assert.deepEqual(searchDocuments(documents, 'API endpoint', { ranking: 'weighted-v1' }).results, result.results);
});

test('lexical index treats prototype property names as ordinary tokens', () => {
  const index = buildLexicalIndex([{ path: 'docs/prototype.md', text: 'constructor prototype value' }]);
  assert.deepEqual(searchIndexedDocuments(index, 'constructor').results.map(result => result.path), ['docs/prototype.md']);
});

test('external output requires explicit authority and refuses overwrite', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-external-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => publishExternalFiles({ destination: root, files: [{ path: 'guide.md', content: '# Guide\n' }] }), /allowExternalOutput/);
  const result = publishExternalFiles({ destination: root, allowExternalOutput: true, files: [{ path: 'guide.md', content: '# Guide\n' }] });
  assert.equal(result.written.length, 1);
  assert.throws(() => publishExternalFiles({ destination: root, allowExternalOutput: true, files: [{ path: 'guide.md', content: '# Changed\n' }] }), /refuses overwrite/);
});
