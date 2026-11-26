import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TOKEN_PARSER_VERSION = '1';
const STATE = '.documenter/token-usage-state.json';
const LEDGER = '.documenter/token-usage.jsonl';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readUsageShape(row) {
  const usage = object(row.usage) ? row.usage : object(row.tokens) ? row.tokens : row;
  const cache = object(usage.cache) ? usage.cache : {};
  const inputTotal = number(usage.input ?? usage.input_tokens ?? usage.prompt_tokens);
  const output = positive(usage.output ?? usage.output_tokens ?? usage.completion_tokens);
  const cacheRead = positive(usage.cacheRead ?? usage.cache_read ?? usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? cache.read);
  const cacheWrite = positive(usage.cacheWrite ?? usage.cache_write ?? usage.cache_creation_input_tokens ?? cache.write);
  const total = positive(usage.total ?? usage.total_tokens);
  const input = positive(inputTotal !== undefined ? inputTotal : total > 0 ? total - output - cacheRead - cacheWrite : 0);
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, cost: number(usage.cost?.total ?? usage.cost) };
}

export function normalizeUsageRecord(row, { source = null, line = null } = {}) {
  if (!object(row)) return null;
  const usage = readUsageShape(row);
  if (usage.total === 0) return null;
  const timestamp = row.timestamp ?? row.ts ?? row.created_at ?? row.time?.created ?? Date.now();
  const model = row.model ?? row.modelID ?? row.model_id ?? row.model?.id ?? 'unknown';
  const provider = row.provider ?? row.providerID ?? row.provider_id ?? row.model?.provider ?? null;
  const host = row.host ?? row.agent ?? null;
  const id = row.id ?? row.message_id ?? row.response_id ?? row.request_id ?? null;
  const stableId = String(id || sha256(`${source || ''}\0${line || ''}\0${JSON.stringify(row)}`));
  return { schemaVersion: 2, parserVersion: TOKEN_PARSER_VERSION, id: stableId, source, line, timestamp: typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp, host, provider, model: String(model), usage, provenance: { source, line, rawId: id }, recordedAt: Date.now() };
}

function safeInput(root, value) {
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Usage input must stay inside root: ${value}`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Usage input must be a regular file: ${value}`);
  return { absolute, relative, stat };
}
function readState(root) {
  const file = path.join(root, STATE);
  if (!fs.existsSync(file)) return { schemaVersion: 2, parserVersion: TOKEN_PARSER_VERSION, files: {} };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.schemaVersion !== 2 || state.parserVersion !== TOKEN_PARSER_VERSION) return { schemaVersion: 2, parserVersion: TOKEN_PARSER_VERSION, files: {} };
  return state;
}
function writeState(root, state) {
  const file = path.join(root, STATE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, file);
}

export function syncUsage({ root, inputs }) {
  const repository = fs.realpathSync(root);
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('Usage sync needs at least one JSONL input path.');
  const state = readState(repository);
  const changedFiles = [];
  const skippedFiles = [];
  for (const input of inputs) {
    const file = safeInput(repository, input);
    const previous = state.files[file.relative];
    if (previous && previous.mtimeMs === file.stat.mtimeMs && previous.size === file.stat.size) { skippedFiles.push(file.relative); continue; }
    const records = [];
    const lines = fs.readFileSync(file.absolute, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].trim()) continue;
      let row;
      try { row = JSON.parse(lines[index]); } catch { continue; }
      const record = normalizeUsageRecord(row, { source: file.relative, line: index + 1 });
      if (record) records.push(record);
    }
    state.files[file.relative] = { mtimeMs: file.stat.mtimeMs, size: file.stat.size, records };
    changedFiles.push(file.relative);
  }
  state.updatedAt = Date.now();
  writeState(repository, state);
  const records = Object.values(state.files).flatMap(file => file.records || []).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  fs.mkdirSync(path.dirname(path.join(repository, LEDGER)), { recursive: true });
  fs.writeFileSync(path.join(repository, LEDGER), records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
  return { schemaVersion: 2, parserVersion: TOKEN_PARSER_VERSION, changedFiles, skippedFiles, records: records.length, ledger: LEDGER };
}

export function readUsageStats({ root, since = 0, until = Date.now() } = {}) {
  const state = readState(fs.realpathSync(root));
  const records = Object.values(state.files).flatMap(file => file.records || []).filter(record => record.timestamp >= since && record.timestamp <= until);
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
  const byModel = {}; const byDay = {}; const byProvider = {};
  for (const record of records) {
    const usage = record.usage;
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) totals[key] += usage[key] || 0;
    if (usage.cost !== undefined) totals.cost += usage.cost;
    const model = record.model; const provider = record.provider || 'unknown';
    const modelBucket = byModel[model] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, messages: 0 };
    const providerBucket = byProvider[provider] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, messages: 0 };
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) { modelBucket[key] += usage[key] || 0; providerBucket[key] += usage[key] || 0; }
    modelBucket.cost += usage.cost || 0; providerBucket.cost += usage.cost || 0; modelBucket.messages++; providerBucket.messages++;
    const day = new Date(record.timestamp).toISOString().slice(0, 10); const dayBucket = byDay[day] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, messages: 0 };
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) dayBucket[key] += usage[key] || 0;
    dayBucket.cost += usage.cost || 0; dayBucket.messages++;
  }
  return { schemaVersion: 2, parserVersion: state.parserVersion, since, until, records: records.length, totals, cacheRate: totals.input + totals.cacheRead ? totals.cacheRead / (totals.input + totals.cacheRead) : null, byModel, byProvider, byDay, tokenMeasurement: records.length ? 'reported-host-usage' : 'unavailable' };
}
