import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function safeAbsolute(destination) {
  const absolute = path.resolve(destination);
  let cursor = absolute;
  while (cursor !== path.dirname(cursor)) {
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`External destination component is unsafe: ${cursor}`);
    }
    cursor = path.dirname(cursor);
  }
  return absolute;
}
function sections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const result = [];
  let current = { key: '__preamble__', start: 0, lines: [] };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      result.push(current);
      current = { key: `${heading[1].length}:${heading[2].trim().toLowerCase()}`, start: result.length, lines: [line] };
    } else current.lines.push(line);
  }
  result.push(current);
  return result;
}

export function mergeMarkdownSections(base, current, candidate) {
  const baseSections = new Map(sections(base).map(section => [section.key, section]));
  const currentSections = new Map(sections(current).map(section => [section.key, section]));
  const candidateSections = new Map(sections(candidate).map(section => [section.key, section]));
  const order = [...new Set([...sections(current).map(section => section.key), ...sections(candidate).map(section => section.key)])];
  const conflicts = [];
  const merged = [];
  for (const key of order) {
    const baseText = baseSections.get(key)?.lines.join('\n') ?? null;
    const currentText = currentSections.get(key)?.lines.join('\n') ?? null;
    const candidateText = candidateSections.get(key)?.lines.join('\n') ?? null;
    const currentChanged = currentText !== baseText;
    const candidateChanged = candidateText !== baseText;
    if (currentChanged && candidateChanged && currentText !== candidateText) {
      conflicts.push({ section: key, base: baseText, current: currentText, candidate: candidateText });
      merged.push(currentText ?? candidateText ?? '');
    } else merged.push(candidateChanged ? candidateText : currentText);
  }
  return { schemaVersion: 2, merged: merged.filter(Boolean).join('\n\n') + '\n', conflicts, clean: conflicts.length === 0, basis: 'heading-identity three-way merge; moved headings and nested structural edits remain explicit conflicts' };
}

function tokens(text) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter(token => !['the', 'and', 'for', 'with', 'this', 'that'].includes(token)));
}
export function searchDocuments(documents, query, { limit = 20 } = {}) {
  if (!Array.isArray(documents) || typeof query !== 'string' || !query.trim()) throw new Error('Search needs documents and a nonempty query.');
  const wanted = tokens(query);
  const results = documents.map(document => {
    const text = `${document.path}\n${document.text || ''}`;
    const found = tokens(text);
    const score = [...wanted].reduce((sum, token) => sum + (found.has(token) ? 1 : 0), 0);
    return { path: document.path, score, excerpt: (document.text || '').slice(0, 512), evidence: { path: document.path, sha256: hash(document.text || '') } };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, Math.min(limit, 100));
  return { schemaVersion: 2, kind: 'lexical-search', query, results, fallback: 'repository lexical search; not embedding or semantic proof' };
}

export function publishExternalFiles({ destination, files, allowExternalOutput = false }) {
  if (!allowExternalOutput) throw new Error('External output requires explicit allowExternalOutput=true.');
  if (!Array.isArray(files) || !files.length) throw new Error('External output requires files.');
  const root = safeAbsolute(destination);
  const written = [];
  for (const file of files) {
    if (!isObject(file) || typeof file.path !== 'string' || path.isAbsolute(file.path) || file.path.split('/').includes('..') || typeof file.content !== 'string') throw new Error('External file mapping is unsafe.');
    const target = path.join(root, file.path);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('External file mapping escapes destination.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) throw new Error(`External output refuses overwrite: ${file.path}`);
    fs.writeFileSync(target, file.content, { flag: 'wx' });
    written.push({ path: file.path, sha256: hash(file.content), bytes: Buffer.byteLength(file.content) });
  }
  return { schemaVersion: 2, destination: root, written, atomicity: 'per-file no-clobber writes; multi-file output is not one filesystem transaction' };
}
