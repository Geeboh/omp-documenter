import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeUsageRecord, readUsageStats, syncUsage } from '../lib/token-usage.mjs';

test('normalizes provider usage into independent token buckets', () => {
  const record = normalizeUsageRecord({ id: 'a', model: 'claude', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 5 } });
  assert.deepEqual(record.usage, { input: 100, output: 20, cacheRead: 30, cacheWrite: 5, total: 155, cost: undefined });
});

test('syncs JSONL incrementally and aggregates model, provider, day, and cache rate', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-usage-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'usage.jsonl'), `${JSON.stringify({ id: 'a', timestamp: '2026-11-26T00:00:00Z', provider: 'openai', model: 'gpt', usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 30 }, cost: { total: 0.01 } })}\n`);
  const first = syncUsage({ root, inputs: ['usage.jsonl'] });
  assert.equal(first.records, 1);
  assert.equal(syncUsage({ root, inputs: ['usage.jsonl'] }).skippedFiles.length, 1);
  const stats = readUsageStats({ root, since: 0 });
  assert.equal(stats.totals.total, 150);
  assert.equal(stats.cacheRate, 30 / 130);
  assert.equal(stats.byModel.gpt.messages, 1);
  assert.equal(stats.tokenMeasurement, 'reported-host-usage');
});
