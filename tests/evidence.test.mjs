import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceId, validateEvidenceRecord, validateEvidenceRecords } from '../lib/evidence.mjs';

test('typed implementation evidence validates required source identity', () => {
  const record = { id: evidenceId('implementation', 'src/app.js:1'), kind: 'implementation', path: 'src/app.js', contentSha256: 'a'.repeat(64), startLine: 1, endLine: 2, provenance: { revision: 'HEAD' }, createdAt: '2026-11-26T00:00:00.000Z' };
  assert.equal(validateEvidenceRecord(record), record);
  assert.equal(validateEvidenceRecords([record]).length, 1);
});

test('evidence rejects duplicate IDs and missing execution contracts', () => {
  const record = { id: 'execution:1', kind: 'execution', provenance: {}, createdAt: '2026-11-26T00:00:00.000Z' };
  assert.throws(() => validateEvidenceRecord(record), /command/);
  const valid = { ...record, command: ['node', '--version'], cwd: '.', exitCode: 0 };
  assert.throws(() => validateEvidenceRecords([valid, valid]), /Duplicate/);
});
