import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerBrief, validateWorkerResult } from '../lib/workers.mjs';

test('worker result preserves exact run baselines', () => {
  const brief = createWorkerBrief({ runId: 'run-1', setId: 'default', componentId: 'core', expectedSnapshot: 'a'.repeat(64), expectedDocumentHashes: { 'docs/guide.md': 'b'.repeat(64) }, styleHash: 'c'.repeat(64), assignedPaths: ['src/app.js'], readerQuestions: ['What starts the app?'] });
  const result = validateWorkerResult({ taskId: brief.taskId, runId: 'run-1', expectedSnapshot: brief.expectedSnapshot, styleHash: brief.styleHash, readSet: { 'src/app.js': 'd'.repeat(64) } }, brief, { snapshot: brief.expectedSnapshot, documentHashes: brief.expectedDocumentHashes });
  assert.equal(result.status, 'completed');
  assert.equal(result.integration, 'pending');
});

test('stale worker result is rejected instead of refreshing its baseline', () => {
  const brief = createWorkerBrief({ runId: 'run-1', setId: 'default', componentId: 'core', expectedSnapshot: 'a'.repeat(64), expectedDocumentHashes: {}, styleHash: 'c'.repeat(64), assignedPaths: ['src/app.js'] });
  assert.throws(() => validateWorkerResult({ taskId: brief.taskId, runId: 'run-1', expectedSnapshot: brief.expectedSnapshot, styleHash: brief.styleHash, readSet: {} }, brief, { snapshot: 'e'.repeat(64) }), /stale/);
});
