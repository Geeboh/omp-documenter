import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture, runEvaluation } from '../scripts/semantic-search-eval.mjs';

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'semantic-search-representative');

test('representative semantic-search fixture has the contract and top-k path recall', () => {
  const { manifest } = loadFixture(fixtureRoot);
  assert.deepEqual(manifest.languages, ['JavaScript', 'TypeScript', 'Python']);
  assert.equal(manifest.documents.length, 15);
  assert.equal(manifest.queries.length, 20);
  assert.ok(manifest.documents.every(document => typeof document.path === 'string' && document.kind));
  assert.ok(manifest.queries.every(query => query.id && query.text && Array.isArray(query.expectedPaths) && query.expectedPaths.length > 0));

  const evidence = runEvaluation({ root: fixtureRoot });
  assert.equal(evidence.counts.queries, 20);
  assert.equal(evidence.counts.topK, 3);
  assert.equal(evidence.counts.repetitions, 5);
  assert.equal(evidence.correctness.allQueriesCorrect, true);
  assert.equal(evidence.correctness.allMeasuredCallsCorrect, true);
  assert.equal(evidence.correctness.expectedPathRecallAtK, 1);
  assert.ok(evidence.correctness.cases.every(query => query.correct));
  assert.ok(evidence.index.serializedBytes <= 128 * 1024);
});
