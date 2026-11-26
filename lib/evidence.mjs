import path from 'node:path';
import crypto from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS = new Set(['implementation', 'configuration', 'test-definition', 'execution', 'external-reference', 'operator-knowledge', 'historical-documentation']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function required(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${name} must be a nonempty string.`);
}
function hash(value, name) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error(`${name} must be a lowercase SHA-256 hash.`);
}
function relative(value, name) {
  required(value, name);
  if (path.isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${name} must be repository-relative.`);
}
function lines(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative integer.`);
}

export function validateEvidenceRecord(record) {
  if (!isObject(record)) throw new Error('Evidence record must be an object.');
  if (typeof record.id !== 'string' || !ID.test(record.id)) throw new Error('Evidence id is invalid.');
  if (!KINDS.has(record.kind)) throw new Error(`Unsupported evidence kind: ${record.kind}`);
  if (!isObject(record.provenance)) throw new Error('Evidence provenance must be an object.');
  required(record.createdAt, 'Evidence createdAt');
  if (record.sha256 !== undefined) hash(record.sha256, 'Evidence sha256');
  if (record.kind === 'implementation') {
    relative(record.path, 'implementation path'); hash(record.contentSha256, 'implementation contentSha256'); lines(record.startLine, 'implementation startLine'); lines(record.endLine, 'implementation endLine');
  } else if (record.kind === 'configuration') {
    relative(record.path, 'configuration path'); hash(record.contentSha256, 'configuration contentSha256');
  } else if (record.kind === 'test-definition') {
    relative(record.path, 'test-definition path'); hash(record.contentSha256, 'test-definition contentSha256'); required(record.assertion, 'test-definition assertion');
  } else if (record.kind === 'execution') {
    if (!Array.isArray(record.command) || !record.command.length || record.command.some(value => typeof value !== 'string')) throw new Error('Execution command must be an argv array.');
    required(record.cwd, 'execution cwd');
    if (!Number.isInteger(record.exitCode)) throw new Error('Execution exitCode must be an integer.');
  } else if (record.kind === 'external-reference') {
    required(record.location, 'external-reference location'); required(record.role, 'external-reference role');
  } else if (record.kind === 'operator-knowledge') {
    required(record.attribution, 'operator-knowledge attribution'); required(record.observation, 'operator-knowledge observation');
  } else {
    relative(record.archivePath, 'historical archivePath'); hash(record.archivedSha256, 'historical archivedSha256');
  }
  return record;
}

export function validateEvidenceRecords(records) {
  if (!Array.isArray(records) || records.length > 1000) throw new Error('Evidence records must be an array of at most 1000 items.');
  const seen = new Set();
  return records.map(record => {
    validateEvidenceRecord(record);
    if (seen.has(record.id)) throw new Error(`Duplicate evidence id: ${record.id}`);
    seen.add(record.id);
    return record;
  });
}

export function evidenceId(kind, subject) {
  return `${kind}:${sha256(`${kind}\0${subject}`).slice(0, 32)}`;
}
