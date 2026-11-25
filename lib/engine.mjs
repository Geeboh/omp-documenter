import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveStyle as resolveStyleProfile, hashStyleProfile } from './style.mjs';
import { inventorySymbols } from './symbols.mjs';

export const VERSION = '2.0.0';
const STATE = '.documenter';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULTS = {
  version: 1,
  docsRoot: 'docs/documenter',
  exclude: [],
  maxFileBytes: 2 * 1024 * 1024,
  gitPolicy: { branchMode: 'manual', branchPrefix: 'docs/' },
  parallel: { mode: 'auto', maxWorkers: 3 },
};
const OMIT_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__', '.cache']);
const encoder = new TextDecoder('utf-8', { fatal: true });
const diagnosticDetails = new Map();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const inside = (value, prefix) => value === prefix || value.startsWith(prefix + '/');
const problem = message => { throw new Error(message); };

function keys(value, allowed, name) {
  if (!obj(value)) problem(`${name} must be a JSON object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problem(`Unknown ${name} field: ${key}`);
}
function string(value, name, max = 100000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    problem(`${name} must be a nonempty string of at most ${max} characters.`);
  }
  return value;
}
function relative(value, name = 'path') {
  string(value, name, 4096);
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some(x => !x || x === '.' || x === '..')) {
    problem(`${name} must be a normalized, repository-relative path without traversal.`);
  }
  return value;
}
function array(value, name, max = 100000) {
  if (!Array.isArray(value) || value.length > max) problem(`${name} must be an array (maximum ${max} items).`);
  return value;
}
function hash(value, name) {
  if (typeof value !== 'string' || !HASH.test(value)) problem(`${name} must be a lowercase SHA-256 hash.`);
  return value;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) problem(`${name} must be a stable identifier using letters, numbers, dots, colons, underscores or hyphens.`);
  return value;
}

// Every existing component is checked. The repository must not be concurrently
// modified by an adversarial process; this is integrity tooling, not a sandbox.
function safePath(root, rel, { directory = false } = {}) {
  relative(rel);
  let cursor = root;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    let info;
    try { info = fs.lstatSync(cursor); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (info.isSymbolicLink()) problem(`Refusing a symbolic-link path: ${rel}`);
    if (i < parts.length - 1 && !info.isDirectory()) problem(`Path parent is not a directory: ${rel}`);
    if (directory && i === parts.length - 1 && !info.isDirectory()) problem(`Expected directory: ${rel}`);
  }
  return cursor;
}
function makeDir(root, rel) {
  safePath(root, rel, { directory: true });
  let cursor = root;
  for (const part of relative(rel).split('/')) {
    cursor = path.join(cursor, part);
    try { fs.mkdirSync(cursor, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = fs.lstatSync(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) problem(`Unsafe directory: ${rel}`);
  }
}
function readBytes(root, rel, limit = 64 * 1024 * 1024, { rejectHardlink = false } = {}) {
  const target = safePath(root, rel);
  let fd;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const info = fs.fstatSync(fd);
    if (!info.isFile()) problem(`Expected regular file: ${rel}`);
    if (rejectHardlink && info.nlink > 1) problem(`Refusing hardlinked file: ${rel}`);
    if (info.size > limit) problem(`File exceeds the ${limit}-byte limit: ${rel}`);
    return fs.readFileSync(fd);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function readText(root, rel, limit) {
  try { return encoder.decode(readBytes(root, rel, limit)); } catch (error) {
    if (error instanceof TypeError) problem(`File is not valid UTF-8 text: ${rel}`);
    throw error;
  }
}
function present(root, rel) {
  const target = safePath(root, rel);
  try { return fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function readJSON(root, rel, fallback) {
  if (!present(root, rel)) return clone(fallback);
  try { return JSON.parse(encoder.decode(readBytes(root, rel, 64 * 1024 * 1024, { rejectHardlink: true }))); }
  catch (error) { problem(`Cannot read ${rel}: ${error.message}`); }
}
function atomicWrite(root, rel, bytes, { exclusive = false, expectedHash = undefined } = {}) {
  relative(rel);
  const parent = path.posix.dirname(rel);
  if (parent !== '.') makeDir(root, parent);
  const target = safePath(root, rel);
  const info = present(root, rel);
  if (info && (!info.isFile() || info.nlink > 1)) problem(`Refusing nonregular or hardlinked output: ${rel}`);
  const temporary = `${rel}.tmp-${crypto.randomUUID()}`;
  const tempTarget = safePath(root, temporary);
  let fd;
  try {
    fd = fs.openSync(tempTarget, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    safePath(root, rel);
    if (expectedHash !== undefined) {
      const live = present(root, rel);
      const liveHash = live ? digest(readBytes(root, rel, 16 * 1024 * 1024, { rejectHardlink: true })) : null;
      if (liveHash !== expectedHash) {
        const error = new Error('The page changed while its replacement was being prepared.');
        error.code = 'DOCUMENTER_CONCURRENT_WRITE';
        throw error;
      }
    }
    if (exclusive) {
      // link() is an atomic no-clobber publication on the same filesystem.
      fs.linkSync(tempTarget, target);
      fs.unlinkSync(tempTarget);
    } else fs.renameSync(tempTarget, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tempTarget); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
const writeJSON = (root, rel, value) => atomicWrite(root, rel, JSON.stringify(value, null, 2) + '\n');

function configFor(root) {
  const config = readJSON(root, `${STATE}/config.json`, DEFAULTS);
  keys(config, ['version', 'docsRoot', 'exclude', 'maxFileBytes', 'gitPolicy', 'parallel'], 'config');
  if (own(config, 'gitPolicy')) keys(config.gitPolicy, ['branchMode', 'branchPrefix'], 'config.gitPolicy');
  if (own(config, 'parallel')) keys(config.parallel, ['mode', 'maxWorkers'], 'config.parallel');
  const result = { ...clone(DEFAULTS), ...config, gitPolicy: { ...DEFAULTS.gitPolicy, ...(config.gitPolicy || {}) }, parallel: { ...DEFAULTS.parallel, ...(config.parallel || {}) } };
  if (result.version !== 1) problem('Unsupported documenter config version; expected version 1.');
  relative(result.docsRoot, 'config.docsRoot');
  if (inside(result.docsRoot, STATE) || result.docsRoot.split('/').some(part => OMIT_DIRS.has(part))) problem('docsRoot cannot be a state, VCS, cache or dependency directory.');
  array(result.exclude, 'config.exclude').forEach(item => relative(item, 'config.exclude entry'));
  if (!Number.isSafeInteger(result.maxFileBytes) || result.maxFileBytes < 1 || result.maxFileBytes > 64 * 1024 * 1024) problem('maxFileBytes must be an integer from 1 through 67108864.');
  keys(result.gitPolicy, ['branchMode', 'branchPrefix'], 'config.gitPolicy');
  if (!['manual', 'require-docs-branch'].includes(result.gitPolicy.branchMode)) problem('gitPolicy.branchMode must be manual or require-docs-branch.');
  string(result.gitPolicy.branchPrefix, 'gitPolicy.branchPrefix', 200);
  if (!['auto', 'off'].includes(result.parallel.mode)) problem('parallel.mode must be auto or off.');
  if (!Number.isSafeInteger(result.parallel.maxWorkers) || result.parallel.maxWorkers < 1 || result.parallel.maxWorkers > 8) problem('parallel.maxWorkers must be an integer from 1 through 8.');
  return result;
}
function git(root, args, optional = false) {
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000,
    env: { ...cleanEnvironment, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0 || result.error) {
    if (optional) return null;
    problem(`Read-only Git command failed (${args[0]}): ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}
function gitDetails(root) {
  const top = git(root, ['rev-parse', '--show-toplevel'], true);
  if (top === null) return { available: false, head: null, branch: null };
  return { available: true, head: git(root, ['rev-parse', '--verify', 'HEAD'], true)?.trim() || null, branch: git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)?.trim() || null };
}
function assertBranch(config, details) {
  if (config.gitPolicy.branchMode === 'require-docs-branch' && (!details.available || !details.branch?.startsWith(config.gitPolicy.branchPrefix))) {
    problem(`This repository requires a documentation branch starting with ${config.gitPolicy.branchPrefix}. Create or select the branch yourself, then retry. No Git changes were made.`);
  }
}
function withLock(root, operation) {
  makeDir(root, STATE);
  const rel = `${STATE}/write.lock`;
  const target = safePath(root, rel);
  let fd;
  try { fd = fs.openSync(target, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') problem('Documenter write lock exists. Another run may be active. If the previous process ended, inspect .documenter/write.lock and remove only that stale lock before retrying.');
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: stamp() }) + '\n');
    fs.closeSync(fd); fd = undefined;
    return operation();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.unlinkSync(target);
  }
}
function isSensitive(rel) {
  const base = path.posix.basename(rel).toLowerCase();
  if (/^\.env(?:\.|$)/.test(base) && !/^\.env\.(example|sample|template)(\.|$)/.test(base)) return true;
  return /\.(pem|key|p12|pfx|jks|keystore)$/.test(base) || /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|credentials\.json|secrets?\.json|secrets?\.ya?ml)$/.test(base);
}
function excludedReason(rel, config) {
  if (inside(rel, STATE)) return 'documenter-state';
  if (inside(rel, config.docsRoot)) return 'documentation-output';
  if (config.exclude.some(prefix => inside(rel, prefix))) return 'configured-exclusion';
  if (rel.split('/').some(part => OMIT_DIRS.has(part))) return 'dependency-cache-or-vcs';
  return null;
}

function inventoryFor(root, config, context = {}) {
  const checkpoint = phase => {
    if (context.signal?.aborted) {
      const error = new Error(`Documentation operation cancelled during ${phase}.`);
      error.code = 'DOCUMENTER_CANCELLED';
      throw error;
    }
    context.onUpdate?.({ phase, completed: entries?.size || 0 });
  };
  const entries = new Map();
  const exclusions = new Map();
  const boundaries = [];
  const visited = new Set();
  const gitState = gitDetails(root);
  const addExcluded = (rel, reason) => {
    if (rel === STATE || inside(rel, STATE) || rel === config.docsRoot || inside(rel, config.docsRoot)) return;
    exclusions.set(`${reason}:${rel}`, { path: rel, reason, acknowledged: reason === 'configured-exclusion' || reason === 'dependency-cache-or-vcs' || reason === 'git-ignored' });
  };
  const gap = (rel, reason, extra = {}) => entries.set(rel, { path: rel, eligible: false, reason, ...extra });
  function file(rel) {
    checkpoint('inventory');
    const reason = excludedReason(rel, config);
    if (reason) { addExcluded(rel, reason); return; }
    let target = path.join(root, ...rel.split('/'));
    let info;
    try {
      // Detect symlinked parents without following their contents.
      safePath(root, path.posix.dirname(rel) === '.' ? rel : path.posix.dirname(rel));
      info = fs.lstatSync(target);
    } catch (error) { if (error.code === 'ENOENT') return; gap(rel, 'unavailable', { detail: error.message }); return; }
    if (info.isSymbolicLink()) { gap(rel, 'symbolic-link'); return; }
    if (info.isDirectory()) { walk(rel); return; }
    if (!info.isFile()) { gap(rel, 'special-file'); return; }
    if (isSensitive(rel)) { gap(rel, 'sensitive-file', { bytes: info.size }); return; }
    if (info.size > config.maxFileBytes) { gap(rel, 'oversize', { bytes: info.size }); return; }
    let bytes;
    try { bytes = readBytes(root, rel, config.maxFileBytes); }
    catch (error) { gap(rel, 'unreadable', { detail: error.message }); return; }
    let text;
    try { text = encoder.decode(bytes); } catch { gap(rel, 'binary-or-non-utf8', { bytes: bytes.length }); return; }
    if (bytes.includes(0)) { gap(rel, 'binary-or-non-utf8', { bytes: bytes.length }); return; }
    entries.set(rel, { path: rel, eligible: true, sha256: digest(bytes), bytes: bytes.length, lines: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0), kind: /\.(md|mdx|rst|txt)$/i.test(rel) ? 'documentation' : 'source-or-configuration' });
  }
  function collectGit(base, boundaryType = 'nested-repository') {
    const directory = base ? safePath(root, base, { directory: true }) : root;
    if (visited.has(directory)) return;
    visited.add(directory);
    if (base) boundaries.push({ path: base, type: boundaryType, ...gitDetails(directory), inspected: true });
    const names = git(directory, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    const stage = git(directory, ['ls-files', '--stage', '-z']);
    const modules = new Set(stage.split('\0').filter(Boolean).filter(row => row.startsWith('160000 ')).map(row => row.slice(row.indexOf('\t') + 1)));
    for (const name of new Set(names)) {
      checkpoint('inventory');
      const rel = base ? `${base}/${name.replace(/\/$/, '')}` : name.replace(/\/$/, '');
      try { relative(rel); } catch { problem('Git returned a path that cannot be safely represented.'); }
      const reason = excludedReason(rel, config);
      if (reason) { addExcluded(rel, reason); continue; }
      if (modules.has(name)) {
        const target = path.join(root, ...rel.split('/'));
        let available = false;
        try {
          safePath(root, rel, { directory: true });
          available = fs.existsSync(path.join(target, '.git')) && gitDetails(target).available;
        } catch { available = false; }
        if (available) collectGit(rel, 'git-submodule');
        else { boundaries.push({ path: rel, type: 'git-submodule', available: false, inspected: false }); gap(rel, 'unavailable-submodule'); }
      } else file(rel);
    }
    const ignored = git(directory, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']).split('\0').filter(Boolean);
    for (const name of ignored) {
      checkpoint('excluded-observations');
      const rel = (base ? `${base}/${name}` : name).replace(/\/$/, '');
      relative(rel);
      addExcluded(rel, excludedReason(rel, config) || 'git-ignored');
    }
  }
  function walk(base = '') {
    if (base) {
      const reason = excludedReason(base, config);
      if (reason) { addExcluded(base, reason); return; }
      let directory;
      try { directory = safePath(root, base, { directory: true }); }
      catch (error) { gap(base, 'unavailable', { detail: error.message }); return; }
      if (fs.existsSync(path.join(directory, '.git'))) { collectGit(base); return; }
    }
    const target = base ? safePath(root, base, { directory: true }) : root;
    if (visited.has(target)) return;
    visited.add(target);
    let children;
    try { children = fs.readdirSync(target, { withFileTypes: true }); }
    catch (error) { gap(base || '[root]', 'unreadable-directory', { detail: error.message }); return; }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      checkpoint('inventory');
      const rel = base ? `${base}/${child.name}` : child.name;
      if (child.isDirectory()) walk(rel); else file(rel);
    }
  }
  if (gitState.available) collectGit(''); else walk();
  const files = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  const excluded = [...exclusions.values()].sort((a, b) => a.path.localeCompare(b.path));
  const sourceState = files.map(({ path: p, eligible, sha256, reason, bytes }) => ({ path: p, eligible, sha256, reason, bytes }));
  const scope = { docsRoot: config.docsRoot, exclude: [...config.exclude].sort(), maxFileBytes: config.maxFileBytes };
  const documents = documentationFor(root, config);
  const observationSnapshot = digest(JSON.stringify(excluded));
  return { version: 1, generatedAt: stamp(), snapshot: digest(JSON.stringify({ files: sourceState, scope, boundaries: boundaries.map(({ path: p, type, available, inspected }) => ({ path: p, type, available, inspected })) })), observationSnapshot, documentSnapshot: digest(JSON.stringify(documents)), git: gitState, files, documents, exclusions: excluded, boundaries, scope: { ...scope, note: 'Git inventories tracked and nonignored untracked files; ignored paths are disclosed separately. Non-Git inventories walk local files. Markdown below docsRoot has a separate audit inventory and does not change the source snapshot. Symbol counts are agent-declared, not parser-complete.' } };
}

function documentationFor(root, config) {
  const result = [];
  function visit(rel) {
    let info;
    try { info = fs.lstatSync(path.join(root, ...rel.split('/'))); }
    catch (error) { if (error.code === 'ENOENT') return; result.push({ path: rel, eligible: false, reason: 'unreadable-documentation' }); return; }
    if (info.isSymbolicLink()) { result.push({ path: rel, eligible: false, reason: 'symbolic-link-documentation' }); return; }
    try { safePath(root, rel); } catch { result.push({ path: rel, eligible: false, reason: 'unsafe-documentation-path' }); return; }
    if (info.isDirectory()) {
      let children;
      try { children = fs.readdirSync(path.join(root, ...rel.split('/')), { withFileTypes: true }); }
      catch { result.push({ path: rel, eligible: false, reason: 'unreadable-documentation-directory' }); return; }
      for (const child of children) if (!OMIT_DIRS.has(child.name)) visit(`${rel}/${child.name}`);
      return;
    }
    if (!/\.md$/i.test(rel)) return;
    if (!info.isFile() || info.size > 16 * 1024 * 1024) { result.push({ path: rel, eligible: false, reason: 'unreadable-or-oversize-documentation' }); return; }
    try {
      const bytes = readBytes(root, rel, 16 * 1024 * 1024);
      const text = encoder.decode(bytes);
      if (bytes.includes(0)) throw new Error('Binary content');
      result.push({ path: rel, eligible: true, sha256: digest(bytes), bytes: bytes.length, lines: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0), kind: 'documentation' });
    } catch { result.push({ path: rel, eligible: false, reason: 'unreadable-documentation' }); }
  }
  visit(config.docsRoot);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function validateInventory(value) {
  keys(value, ['version', 'generatedAt', 'snapshot', 'observationSnapshot', 'documentSnapshot', 'git', 'files', 'documents', 'exclusions', 'boundaries', 'scope'], 'inventory');
  if (value.version !== 1) problem('Unsupported inventory version.');
  hash(value.snapshot, 'inventory.snapshot');
  if (own(value, 'observationSnapshot')) hash(value.observationSnapshot, 'inventory.observationSnapshot');
  array(value.files, 'inventory.files').forEach(file => { if (!obj(file)) problem('Invalid inventory file.'); relative(file.path); if (file.eligible) hash(file.sha256, 'inventory file hash'); });
  if (own(value, 'documents')) array(value.documents, 'inventory.documents').forEach(file => { if (!obj(file)) problem('Invalid documentation inventory.'); relative(file.path); if (file.eligible) hash(file.sha256, 'documentation hash'); });
  return value;
}
function ledgerFor(root) {
  const value = readJSON(root, `${STATE}/ledger.json`, { version: 1, reviews: [], claims: [], unknowns: [], retired: [] });
  keys(value, ['version', 'reviews', 'claims', 'unknowns', 'retired'], 'ledger');
  if (value.version !== 1) problem('Unsupported ledger version.');
  if (!own(value, 'retired')) value.retired = [];
  array(value.retired, 'ledger.retired').forEach(entry => {
    keys(entry, ['kind', 'key', 'reason', 'retiredAt', 'record'], 'retired record');
    if (!['review', 'claim'].includes(entry.kind)) problem('Retired record kind must be review or claim.');
    if (entry.kind === 'review') relative(entry.key); else identifier(entry.key, 'retired claim key');
    string(entry.reason, 'retirement reason'); string(entry.retiredAt, 'retirement time');
    if (!obj(entry.record)) problem('A retirement must retain its original record.');
  });
  for (const collection of ['reviews', 'claims', 'unknowns']) {
    array(value[collection], `ledger.${collection}`);
    const seen = new Set();
    for (const entry of value[collection]) {
      if (!obj(entry)) problem(`Invalid ledger ${collection} entry.`);
      const id = collection === 'reviews' ? relative(entry.path) : identifier(entry.id, `ledger.${collection}.id`);
      if (seen.has(id)) problem(`Duplicate ledger record: ${id}`);
      seen.add(id);
      if (collection !== 'unknowns') {
        hash(entry.snapshot, 'ledger snapshot');
        if (!obj(entry.documentHashes)) problem('Missing documentHashes in ledger.');
        for (const [document, value] of Object.entries(entry.documentHashes)) { documentPath(document); hash(value, 'document hash'); }
        array(entry.documents, 'ledger documents').forEach(documentPath);
        if (Object.keys(entry.documentHashes).length !== new Set(entry.documents).size || entry.documents.some(document => !own(entry.documentHashes, document))) problem('Ledger document hashes must exactly match declared documents.');
      }
      if (collection === 'reviews') {
        keys(entry, ['path', 'sha256', 'summary', 'documents', 'symbols', 'documentHashes', 'snapshot', 'recordedAt'], 'stored review');
        hash(entry.sha256, 'review hash'); string(entry.summary, 'review summary');
        array(entry.symbols, 'review symbols').forEach(validateSymbol);
      } else if (collection === 'claims') {
        validateClaimShape(entry, true);
      } else validateUnknown(entry, true);
    }
  }
  return value;
}
function ownershipFor(root) {
  const value = readJSON(root, `${STATE}/ownership.json`, { version: 1, pages: [] });
  keys(value, ['version', 'pages'], 'ownership');
  if (value.version !== 1) problem('Unsupported ownership version.');
  const seen = new Set();
  array(value.pages, 'ownership.pages').forEach(item => {
    keys(item, ['path', 'sha256', 'updatedAt'], 'ownership page');
    relative(item.path); hash(item.sha256, 'ownership hash');
    if (seen.has(item.path)) problem(`Duplicate ownership page: ${item.path}`);
    seen.add(item.path);
  });
  return value;
}
function documentsFor(root, value) {
  array(value, 'documents', 10000);
  const hashes = {};
  for (const rel of value) {
    documentPath(rel);
    const bytes = readBytes(root, rel, 16 * 1024 * 1024);
    encoder.decode(bytes);
    hashes[rel] = digest(bytes);
  }
  return hashes;
}
function documentPath(rel) {
  relative(rel, 'document path');
  if (!/\.md$/i.test(rel) || inside(rel, STATE) || rel.split('/').includes('.git')) problem(`Document must be a Markdown page outside state/VCS: ${rel}`);
  return rel;
}
function validateSymbol(symbol) {
  keys(symbol, ['name', 'kind', 'signature', 'doc', 'notes'], 'symbol');
  for (const key of ['name', 'kind', 'signature', 'doc']) string(symbol[key], `symbol.${key}`);
  if (own(symbol, 'notes')) string(symbol.notes, 'symbol.notes');
}
function validateClaimShape(claim, stored = false) {
  keys(claim, ['id', 'text', 'status', 'evidence', 'documents', 'dependencies', 'reason', 'resolution', ...(stored ? ['snapshot', 'recordedAt', 'documentHashes'] : [])], 'claim');
  identifier(claim.id, 'claim.id'); string(claim.text, 'claim.text');
  if (!['supported', 'inference', 'unknown', 'conflict'].includes(claim.status)) problem('claim.status must be supported, inference, unknown or conflict.');
  array(claim.evidence, 'claim.evidence', 10000).forEach(item => {
    keys(item, ['path', 'sha256', 'startLine', 'endLine'], 'evidence');
    relative(item.path); hash(item.sha256, 'evidence.sha256');
    if (!Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) || item.startLine < 0 || item.endLine < item.startLine || (item.startLine === 0 && item.endLine !== 0)) problem('Evidence lines must be positive integers with endLine >= startLine, or exactly 0,0 for an empty file.');
  });
  if (own(claim, 'dependencies')) array(claim.dependencies, 'claim.dependencies', 10000).forEach(item => {
    keys(item, ['path', 'sha256'], 'claim dependency');
    relative(item.path);
    hash(item.sha256, 'claim dependency hash');
  });
  array(claim.documents, 'claim.documents').forEach(documentPath);
  if (claim.status === 'supported' && claim.evidence.length === 0) problem('A supported claim requires source evidence.');
  if (claim.status !== 'supported') { string(claim.reason, 'claim.reason'); string(claim.resolution, 'claim.resolution'); }
  else { if (own(claim, 'reason')) string(claim.reason, 'claim.reason'); if (own(claim, 'resolution')) string(claim.resolution, 'claim.resolution'); }
}
function validateUnknown(entry, stored = false) {
  keys(entry, ['id', 'question', 'whyItMatters', 'nextSteps', 'status', 'resolution', ...(stored ? ['recordedAt'] : [])], 'unknown');
  identifier(entry.id, 'unknown.id'); string(entry.question, 'unknown.question'); string(entry.whyItMatters, 'unknown.whyItMatters');
  array(entry.nextSteps, 'unknown.nextSteps', 1000).forEach(step => string(step, 'unknown next step'));
  if (!entry.nextSteps.length) problem('An unknown needs at least one actionable next step.');
  if (!['open', 'resolved'].includes(entry.status)) problem('unknown.status must be open or resolved.');
  if (entry.status === 'resolved') string(entry.resolution, 'unknown.resolution');
  else if (own(entry, 'resolution')) string(entry.resolution, 'unknown.resolution');
}
function record(root, config, inventory, input) {
  keys(input, ['expectedSnapshot', 'reviews', 'claims', 'unknowns', 'retireReviews', 'retireClaims'], 'record input');
  hash(input.expectedSnapshot, 'record.expectedSnapshot');
  if (input.expectedSnapshot !== inventory.snapshot) problem('Repository snapshot changed since analysis. Rescan and revalidate the affected findings before recording them.');
  const ledger = ledgerFor(root);
  const files = new Map([...inventory.files, ...inventory.documents].filter(item => item.eligible).map(item => [item.path, item]));
  const validateSource = (rel, sha256) => {
    relative(rel); hash(sha256, 'source hash');
    const current = files.get(rel);
    if (!current) problem(`Source is absent or outside readable inventory: ${rel}`);
    if (current.sha256 !== sha256) problem(`Source hash changed or is incorrect: ${rel}. Read the current file and rescan.`);
    return current;
  };
  const merge = (collection, additions, key) => {
    const map = new Map(collection.map(item => [item[key], item]));
    const seen = new Set();
    for (const item of additions) {
      if (seen.has(item[key])) problem(`Duplicate input record: ${item[key]}`);
      seen.add(item[key]); map.set(item[key], item);
    }
    return [...map.values()].sort((a, b) => a[key].localeCompare(b[key]));
  };
  const reviews = array(input.reviews ?? [], 'reviews').map(review => {
    keys(review, ['path', 'sha256', 'summary', 'documents', 'symbols'], 'review');
    validateSource(review.path, review.sha256); string(review.summary, 'review.summary');
    array(review.symbols, 'review.symbols').forEach(validateSymbol);
    return { ...review, documentHashes: documentsFor(root, review.documents), snapshot: inventory.snapshot, recordedAt: stamp() };
  });
  const claims = array(input.claims ?? [], 'claims').map(claim => {
    validateClaimShape(claim);
    for (const evidence of claim.evidence) {
      const file = validateSource(evidence.path, evidence.sha256);
      if (!validEvidenceRange(file, evidence)) problem(`Evidence line range exceeds the source or does not describe an empty file: ${evidence.path}`);
    }
    return { ...claim, documentHashes: documentsFor(root, claim.documents), snapshot: inventory.snapshot, recordedAt: stamp() };
  });
  const unknowns = array(input.unknowns ?? [], 'unknowns').map(unknown => { validateUnknown(unknown); return { ...unknown, recordedAt: stamp() }; });
  const retire = (collection, instructions, kind, key) => {
    let count = 0;
    for (const instruction of array(instructions ?? [], `retire ${kind}s`)) {
      keys(instruction, [key, 'reason'], `retire ${kind}`);
      if (kind === 'review') relative(instruction[key]); else identifier(instruction[key], 'retire claim id');
      string(instruction.reason, 'retirement reason');
      const index = collection.findIndex(entry => entry[key] === instruction[key]);
      if (index < 0) {
        if (ledger.retired.some(entry => entry.kind === kind && entry.key === instruction[key])) continue;
        problem(`Cannot retire an unknown ${kind}: ${instruction[key]}`);
      }
      const [original] = collection.splice(index, 1);
      ledger.retired.push({ kind, key: instruction[key], reason: instruction.reason, retiredAt: stamp(), record: original });
      count++;
    }
    return count;
  };
  const retiredReviews = retire(ledger.reviews, input.retireReviews, 'review', 'path');
  const retiredClaims = retire(ledger.claims, input.retireClaims, 'claim', 'id');
  ledger.reviews = merge(ledger.reviews, reviews, 'path');
  ledger.claims = merge(ledger.claims, claims, 'id');
  ledger.unknowns = merge(ledger.unknowns, unknowns, 'id');
  if (inventoryFor(root, config).snapshot !== inventory.snapshot || [...reviews, ...claims].some(entry => !documentFresh(root, entry))) {
    problem('Repository or documentation changed while records were being checked. No ledger update was written; rescan and retry with current evidence.');
  }
  writeJSON(root, `${STATE}/ledger.json`, ledger);
  return { ok: true, recorded: { reviews: reviews.length, claims: claims.length, unknowns: unknowns.length, retiredReviews, retiredClaims }, snapshot: inventory.snapshot, note: 'Evidence hashes and locations were checked. Semantic support is the reviewing agent\'s assessment, not a proof made by this engine.' };
}

function changes(previous, current) {
  if (!previous) return { added: current.files.map(x => x.path), changed: [], deleted: [] };
  const before = new Map(previous.files.map(x => [x.path, x]));
  const after = new Map(current.files.map(x => [x.path, x]));
  return {
    added: [...after.keys()].filter(p => !before.has(p)),
    changed: [...after.keys()].filter(p => before.has(p) && JSON.stringify(before.get(p)) !== JSON.stringify(after.get(p))),
    deleted: [...before.keys()].filter(p => !after.has(p)),
  };
}
function loadPrevious(root) {
  if (!present(root, `${STATE}/inventory.json`)) return null;
  return validateInventory(readJSON(root, `${STATE}/inventory.json`, null));
}
function documentFresh(root, record) {
  for (const rel of record.documents) {
    if (!own(record.documentHashes, rel)) return false;
    try { if (digest(readBytes(root, rel, 16 * 1024 * 1024)) !== record.documentHashes[rel]) return false; }
    catch { return false; }
  }
  return true;
}
function documentFreshCached(root, record, cache) {
  for (const rel of record.documents) {
    if (!own(record.documentHashes, rel)) return false;
    const expected = record.documentHashes[rel];
    const key = `${rel}:${expected}`;
    let current = cache.get(key);
    if (current === undefined) {
      try { current = digest(readBytes(root, rel, 16 * 1024 * 1024)); } catch { current = null; }
      cache.set(key, current);
    }
    if (current !== expected) return false;
  }
  return true;
}
function validEvidenceRange(file, evidence) {
  return file && (file.lines === 0 ? evidence.startLine === 0 && evidence.endLine === 0 : evidence.startLine >= 1 && evidence.endLine <= file.lines);
}
function evaluate(root, inventory) {
  const ledger = ledgerFor(root);
  const ownership = ownershipFor(root);
  const files = new Map(inventory.files.filter(f => f.eligible).map(f => [f.path, f]));
  const documents = new Map(inventory.documents.filter(f => f.eligible).map(f => [f.path, f]));
  const allFiles = new Map([...files, ...documents]);
  const documentCache = new Map();
  const currentReviews = ledger.reviews.filter(review => review.snapshot === inventory.snapshot && allFiles.get(review.path)?.sha256 === review.sha256 && documentFreshCached(root, review, documentCache));
  const currentClaims = ledger.claims.filter(claim => claim.snapshot === inventory.snapshot && (!claim.dependencies || claim.dependencies.every(dependency => allFiles.get(dependency.path)?.sha256 === dependency.sha256)) && claim.evidence.every(evidence => allFiles.get(evidence.path)?.sha256 === evidence.sha256 && validEvidenceRange(allFiles.get(evidence.path), evidence)) && documentFreshCached(root, claim, documentCache));
  const backed = currentClaims.filter(claim => claim.status === 'supported');
  const reviewed = new Set(currentReviews.filter(review => files.has(review.path)).map(review => review.path));
  const reviewedDocumentation = new Set(currentReviews.filter(review => documents.has(review.path)).map(review => review.path));
  const documented = new Set(currentReviews.filter(review => files.has(review.path) && review.documents.length && backed.some(claim => claim.evidence.some(e => e.path === review.path) && claim.documents.some(doc => review.documents.includes(doc)))).map(review => review.path));
  const staleReviews = ledger.reviews.filter(review => !currentReviews.includes(review)).map(review => review.path);
  const staleClaims = ledger.claims.filter(claim => !currentClaims.includes(claim)).map(claim => claim.id);
  const stalePages = ownership.pages.filter(page => {
    try { return digest(readBytes(root, page.path, 16 * 1024 * 1024)) !== page.sha256; } catch { return true; }
  }).map(page => page.path);
  const unreviewed = [...files.keys()].filter(rel => !reviewed.has(rel));
  const undocumented = [...files.keys()].filter(rel => !documented.has(rel));
  const gaps = inventory.files.filter(file => !file.eligible);
  const documentationGaps = inventory.documents.filter(file => !file.eligible);
  const unreviewedDocumentation = [...documents.keys()].filter(rel => !reviewedDocumentation.has(rel));
  const openUnknowns = ledger.unknowns.filter(entry => entry.status === 'open');
  const unsettledClaims = currentClaims.filter(claim => claim.status === 'unknown' || claim.status === 'conflict');
  const total = files.size;
  const percentage = count => total ? Math.round(count * 10000 / total) / 100 : null;
  return {
    ledger, ownership,
    summary: {
      snapshot: inventory.snapshot,
      scope: { eligibleFiles: total, gaps: gaps.length, documentationPages: documents.size, documentationGaps: documentationGaps.length, exclusions: inventory.exclusions.length, repositoryBoundaries: inventory.boundaries.length },
      coverage: {
        reviewed: { count: reviewed.size, denominator: total, percent: percentage(reviewed.size) },
        documented: { count: documented.size, denominator: total, percent: percentage(documented.size) },
        documentationPages: { count: reviewedDocumentation.size, denominator: documents.size, percent: documents.size ? Math.round(reviewedDocumentation.size * 10000 / documents.size) / 100 : null },
        claims: { total: ledger.claims.length, current: currentClaims.length, supported: backed.length, inference: currentClaims.filter(c => c.status === 'inference').length, stale: staleClaims.length },
        symbols: { declared: currentReviews.reduce((count, review) => count + review.symbols.length, 0), basis: 'declared_only/not_exhaustive', percent: null },
      },
      attention: { unreviewed, undocumented, unreviewedDocumentation, staleReviews, staleClaims, stalePages, gaps, documentationGaps, openUnknowns, unsettledClaims: unsettledClaims.map(claim => claim.id) },
      exclusions: inventory.exclusions,
      boundaries: inventory.boundaries,
      retiredRecords: ledger.retired.length,
      meaning: 'Reviewed and supported are recorded agent assessments tied to current file hashes. They do not establish semantic correctness or exhaustive symbol coverage. File coverage excludes disclosed ignored/configured paths; gaps remain visible.',
    },
  };
}
function bounded(summary) {
  const result = clone(summary);
  result.truncation = {};
  const compact = item => typeof item === 'string' ? item : item?.path ?? item?.id ?? item?.question ?? item?.reason ?? 'See retained details';
  for (const [key, value] of Object.entries(result.attention)) {
    if (Array.isArray(value) && value.length > 100) {
      result.truncation[`attention.${key}`] = value.length - 100;
      result.attention[key] = value.map(compact).slice(0, 100);
    }
  }
  for (const key of ['exclusions', 'boundaries']) if (Array.isArray(result[key]) && result[key].length > 100) {
    result.truncation[key] = result[key].length - 100;
    result[key] = result[key].map(compact).slice(0, 100);
  }
  let bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > 64 * 1024) {
    result.truncation.bytes = bytes - 64 * 1024;
    result.note = 'Output was bounded by item and byte budgets. Re-run a scoped query or use retained details where available.';
    for (const key of Object.keys(result.attention)) if (Array.isArray(result.attention[key])) result.attention[key] = result.attention[key].slice(0, 10);
    bytes = Buffer.byteLength(JSON.stringify(result));
  }
  result.resultBytes = bytes;
  return result;
}
function proposal(root, input, reason) {
  const name = crypto.randomUUID();
  const rel = `${STATE}/proposals/${name}.md`;
  atomicWrite(root, rel, input.content, { exclusive: true });
  writeJSON(root, `${STATE}/proposals/${name}.json`, { version: 1, path: input.path, expectedSha256: input.expectedSha256, reason, createdAt: stamp(), contentSha256: digest(input.content) });
  return { ok: false, conflict: true, path: input.path, reason, proposal: rel, note: 'Existing documentation was preserved. Review the proposal and update human-owned text deliberately; this tool will not adopt or overwrite it.' };
}
function publish(root, config, input) {
  keys(input, ['path', 'content', 'expectedSha256'], 'publish input');
  relative(input.path); string(input.content, 'publish.content', 16 * 1024 * 1024);
  if (Buffer.byteLength(input.content, 'utf8') > 16 * 1024 * 1024) problem('Published Markdown must be at most 16777216 UTF-8 bytes.');
  if (!inside(input.path, config.docsRoot) || input.path === config.docsRoot || !/\.md$/i.test(input.path)) problem(`Published pages must be Markdown below ${config.docsRoot}/.`);
  if (input.expectedSha256 !== null) hash(input.expectedSha256, 'publish.expectedSha256');
  const info = present(root, input.path);
  if (info && (!info.isFile() || info.nlink > 1)) problem(`Refusing nonregular or hardlinked documentation: ${input.path}`);
  const ownership = ownershipFor(root);
  const owned = ownership.pages.find(page => page.path === input.path);
  const bytes = info ? readBytes(root, input.path, 16 * 1024 * 1024, { rejectHardlink: true }) : null;
  const currentHash = bytes ? digest(bytes) : null;
  if (!info && input.expectedSha256 !== null) return proposal(root, input, 'Expected an existing page, but it is absent.');
  if (info && input.expectedSha256 === null) return proposal(root, input, 'A page already exists at the requested new-page path.');
  if (info && currentHash !== input.expectedSha256) return proposal(root, input, 'The page changed after it was read.');
  if (info && !owned) return proposal(root, input, 'This page is human-owned or predates Documenter.');
  if (info && owned.sha256 !== currentHash) return proposal(root, input, 'The generated page has manual changes.');
  const resultHash = digest(input.content);
  if (info && currentHash === resultHash) return { ok: true, path: input.path, sha256: currentHash, unchanged: true };
  const transaction = crypto.randomUUID();
  const journalBase = `${STATE}/journal/${transaction}`;
  if (bytes) atomicWrite(root, `${journalBase}.before.md`, bytes, { exclusive: true });
  writeJSON(root, `${journalBase}.json`, { version: 1, path: input.path, previousSha256: currentHash, nextSha256: resultHash, startedAt: stamp(), state: 'prepared' });
  try { atomicWrite(root, input.path, input.content, { exclusive: !info, expectedHash: currentHash }); }
  catch (error) {
    if (error.code !== 'DOCUMENTER_CONCURRENT_WRITE' && error.code !== 'EEXIST') throw error;
    writeJSON(root, `${journalBase}.json`, { version: 1, path: input.path, previousSha256: currentHash, nextSha256: resultHash, completedAt: stamp(), state: 'conflict' });
    return proposal(root, input, 'The page changed while its replacement was being prepared.');
  }
  const pages = ownership.pages.filter(page => page.path !== input.path);
  pages.push({ path: input.path, sha256: resultHash, updatedAt: stamp() });
  ownership.pages = pages.sort((a, b) => a.path.localeCompare(b.path));
  writeJSON(root, `${STATE}/ownership.json`, ownership);
  writeJSON(root, `${journalBase}.json`, { version: 1, path: input.path, previousSha256: currentHash, nextSha256: resultHash, completedAt: stamp(), state: 'committed' });
  return { ok: true, path: input.path, sha256: resultHash, created: !info, journal: `${journalBase}.json`, note: 'Page and ownership updates are recoverable but are not one cross-file atomic transaction. A crash can leave a prepared journal; inspect it before further edits.' };
}

function markdownAnchors(text) {
  const anchors = new Set();
  const counts = new Map();
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (match) {
      const slug = match[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').replace(/ /g, '-');
      const count = counts.get(slug) || 0;
      counts.set(slug, count + 1); anchors.add(count ? `${slug}-${count}` : slug);
    }
    for (const found of line.matchAll(/<(?:a|[a-z][a-z0-9]*)\b[^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/gi)) anchors.add(found[1]);
  }
  return anchors;
}
function linksFor(root, pages) {
  const failures = [];
  let checked = 0;
  let skippedComplex = 0;
  for (const rel of pages) {
    let text;
    try { text = readText(root, rel, 16 * 1024 * 1024); }
    catch (error) { failures.push({ page: rel, reason: error.message }); continue; }
    // Conservative inline-link subset. Fenced examples and inline code are not links.
    const prose = text.replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm, '').replace(/`+[^`\n]*`+/g, '');
    skippedComplex += [...prose.matchAll(/^\s*\[[^\]]+\]:/gm)].length;
    for (const match of prose.matchAll(/!?\[[^\]\n]*\]\((<[^>]*>|[^\s()]+)(?:\s+["'][^\n]*?["'])?\)/g)) {
      let target = match[1].replace(/^<|>$/g, '');
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('//')) continue;
      if (target.startsWith('/')) { skippedComplex++; continue; }
      const hashIndex = target.indexOf('#');
      let fragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : '';
      target = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).split('?')[0];
      try { target = decodeURIComponent(target); fragment = decodeURIComponent(fragment); }
      catch { failures.push({ page: rel, target: match[1], reason: 'Invalid URL escaping.' }); continue; }
      const resolved = target ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), target)) : rel;
      try {
        relative(resolved);
        const info = present(root, resolved);
        if (!info) problem('Target does not exist.');
        if (fragment && info.isFile() && /\.md$/i.test(resolved) && !markdownAnchors(readText(root, resolved, 16 * 1024 * 1024)).has(fragment)) problem('Markdown heading or explicit anchor was not found.');
        checked++;
      } catch (error) { failures.push({ page: rel, target: match[1], reason: error.message }); }
    }
  }
  const detailResultId = crypto.randomUUID();
  diagnosticDetails.set(detailResultId, clone(failures));
  const failuresView = failures.slice(0, 100).map(failure => ({ page: String(failure.page).slice(0, 512), target: String(failure.target).slice(0, 512), reason: String(failure.reason).slice(0, 512) }));
  return { checked, totalFailures: failures.length, returnedFailures: failuresView.length, truncatedFailures: Math.max(0, failures.length - failuresView.length), failures: failuresView, detailResultId, skippedComplex, scope: 'Local inline Markdown links and ATX/explicit HTML anchors only. Reference-style links, complex destinations, site-root URLs and remote URLs need a renderer or separate review.' };
}
const V2 = 2;
const V2_STATE = '.documenter';
const V2_LIMITS = { pageBytes: 16 * 1024 * 1024, detailItems: 100, detailBytes: 64 * 1024 };
const V2_TOPICS = ['repository-discovery', 'overview-users', 'architecture-data-flow', 'setup-dependencies', 'configuration', 'user-workflows', 'code-api-reference', 'operations', 'examples', 'troubleshooting', 'testing', 'security', 'licensing-notices', 'compliance-information', 'contribution', 'release-process', 'changelog-history', 'glossary', 'index-navigation', 'evidence-coverage-unknowns'];
const v2Topics = () => Object.fromEntries(V2_TOPICS.map(topic => [topic, { status: 'unknown', reason: 'Requires coordinator evidence or a justified not-applicable decision.', evidence: [] }]));

function v2Read(root, rel, fallback = null) {
  return readJSON(root, rel, fallback);
}

function v2Write(root, rel, value) {
  return writeJSON(root, rel, value);
}

function v2Hash(value) {
  return digest(Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
}
function v2EnsureMigration(root) {
  const current = v2Read(root, `${V2_STATE}/config.json`, null);
  if (!current || current.schemaVersion === V2) return null;
  if (current.version !== 1) problem('Unsupported v1 state version; migration cannot continue safely.');
  const migrationId = `migration-${crypto.randomUUID()}`;
  const base = `${V2_STATE}/migrations/${migrationId}`;
  const original = {};
  for (const rel of ['config.json', 'inventory.json', 'ledger.json', 'ownership.json']) {
    if (!present(root, `${V2_STATE}/${rel}`)) continue;
    const bytes = readBytes(root, `${V2_STATE}/${rel}`, 64 * 1024 * 1024);
    atomicWrite(root, `${base}/original/${rel}`, bytes, { exclusive: true });
    original[rel] = { sha256: v2Hash(bytes), bytes: bytes.length };
  }
  v2Write(root, `${base}/manifest.json`, { schemaVersion: V2, migrationId, from: 1, to: V2, original, status: 'committed', createdAt: stamp() });
  return migrationId;
}

function v2SetId(value) {
  return identifier(value ?? 'default', 'setId');
}

function v2Destination(value) {
  const destination = value ?? 'docs/documenter';
  relative(destination, 'destination');
  if (inside(destination, STATE) || destination.split('/').some(part => OMIT_DIRS.has(part))) {
    problem('destination cannot be a state, VCS, cache or dependency directory.');
  }
  return destination;
}
function validateV2Destination(root, destination) {
  safePath(root, destination, { directory: true });
  return destination;

}
function v2Sets(root) {
  const registry = v2Read(root, `${V2_STATE}/sets.json`, { schemaVersion: V2, defaultSetId: 'default', sets: [] });
  keys(registry, ['schemaVersion', 'defaultSetId', 'sets'], 'sets');
  array(registry.sets, 'sets.sets', 1000);
  for (const set of registry.sets) {
    keys(set, ['setId', 'destination', 'frontpagePolicy', 'frontpages', 'activeGenerationId', 'selectedStyleHash', 'sourcePolicy'], 'documentation set');
    v2SetId(set.setId); v2Destination(set.destination);
    if (!['none', 'root', 'all'].includes(set.frontpagePolicy)) problem('frontpagePolicy must be none, root or all.');
    array(set.frontpages, 'set.frontpages', 1000).forEach(item => relative(item, 'frontpage'));
    if (set.activeGenerationId !== null) identifier(set.activeGenerationId, 'activeGenerationId');
    if (set.selectedStyleHash !== null) hash(set.selectedStyleHash, 'selectedStyleHash');
    if (!obj(set.sourcePolicy)) problem('set.sourcePolicy must be an object.');
  }
  return registry;
}

function v2Set(root, input = {}) {
  const registry = v2Sets(root);
  const setId = v2SetId(input.setId ?? registry.defaultSetId);
  const found = registry.sets.find(item => item.setId === setId);
  if (found) {
    validateV2Destination(root, found.destination);
    return { registry, set: found };
  }
  const set = {
    setId,
    destination: v2Destination(input.dest ?? input.destination),
    frontpagePolicy: input.frontpage ?? input.frontpagePolicy ?? 'none',
    frontpages: [],
    activeGenerationId: null,
    selectedStyleHash: null,
    sourcePolicy: { kind: 'repository-relative', exclusions: [] },
  };
  if (!['none', 'root', 'all'].includes(set.frontpagePolicy)) problem('frontpage must be none, root or all.');
  validateV2Destination(root, set.destination);
  return { registry, set };
}

function v2PersistSet(root, registry, set) {
  const sets = registry.sets.filter(item => item.setId !== set.setId);
  for (const other of sets) {
    if (inside(other.destination, set.destination) || inside(set.destination, other.destination)) {
      problem(`Documentation set destinations overlap: ${other.setId} and ${set.setId}.`);
    }
  }
  sets.push(set);
  registry.sets = sets.sort((a, b) => a.setId.localeCompare(b.setId));
  v2Write(root, `${V2_STATE}/sets.json`, registry);
  return set;
}

function v2Frontpages(root, destination, policy) {
  if (policy === 'none') return [];
  const pages = [];
  const add = rel => {
    try {
      const info = present(root, rel);
      if (info?.isFile() && /\.md$/i.test(rel)) pages.push(rel);
    } catch {}
  };
  if (policy === 'root' || policy === 'all') {
    add('README.md');
    add('index.md');
  }
  if (policy === 'all') {
    add(`${destination}/README.md`);
    add(`${destination}/index.md`);
  }
  if (policy === 'all' && present(root, destination)?.isDirectory()) {
    const visit = rel => {
      let entries;
      try { entries = fs.readdirSync(path.join(root, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory() && !OMIT_DIRS.has(entry.name)) {
          add(`${child}/README.md`);
          add(`${child}/index.md`);
          visit(child);
        }
      }
    };
    visit(destination);
  }
  return [...new Set(pages)].sort();
}

function v2Style(root, request, set, { persist = false } = {}) {
  const configured = configFor(root);
  const styleDestination = configured.docsRoot || set.destination;
  const configuredDocs = documentationFor(root, { docsRoot: styleDestination }).filter(item => item.eligible);
  const rootDocs = ['README.md', 'index.md'].flatMap(page => documentationFor(root, { docsRoot: page }).filter(item => item.eligible));
  const fallbackDocs = documentationFor(root, { docsRoot: 'docs' }).filter(item => item.eligible);
  const projectDocs = [...new Map([...rootDocs, ...configuredDocs, ...fallbackDocs].map(item => [item.path, item])).values()];
  const existingDocs = projectDocs.map(item => ({ path: item.path, text: readText(root, item.path, V2_LIMITS.pageBytes), role: 'project-documentation', sha256: item.sha256 }));
  const saved = set.selectedStyleHash
    ? v2Read(root, `${V2_STATE}/styles/${set.selectedStyleHash}.json`, null)
    : null;
  const profile = resolveStyleProfile({
    request: { style: request.style, styleFrom: request.styleFrom },
    savedProfile: saved,
    existingDocuments: existingDocs,
    source: request.styleFrom,
  });
  const styleHash = hashStyleProfile(profile);
  if (persist) {
    v2Write(root, `${V2_STATE}/styles/${styleHash}.json`, profile);
    set.selectedStyleHash = styleHash;
  }
  return { ...profile, hash: styleHash };
}

function v2Snapshot(root, config) {
  return inventoryFor(root, config).snapshot;
}

function v2LiveHash(root, rel) {
  const info = present(root, rel);
  return info ? v2Hash(readBytes(root, rel, V2_LIMITS.pageBytes, { rejectHardlink: true })) : null;
}

function v2Run(root, input, mode = 'overhaul', { persist = true } = {}) {
  keys(input, ['setId', 'dest', 'frontpage', 'style', 'styleFrom', 'mode', 'dryRun', 'idempotencyKey', 'expectedSnapshot', 'expectedDocumentHashes', 'pages'], 'run input');
  const { registry, set: existing } = v2Set(root, input);
  const set = clone(existing);
  if (input.dest !== undefined && existing.destination !== v2Destination(input.dest) && mode !== 'overhaul') {
    problem('Changing a documentation destination requires overhaul.');
  }
  if (input.dest !== undefined) set.destination = v2Destination(input.dest);
  if (input.frontpage !== undefined) set.frontpagePolicy = input.frontpage;
  const config = configFor(root);
  const inventoryConfig = { ...config, exclude: [...(config.exclude || []), existing.destination, set.destination] };
  const inventory = inventoryFor(root, inventoryConfig);
  const style = v2Style(root, input, set, { persist });
  const frontpages = input.frontpage === undefined && existing.frontpages.length
    ? existing.frontpages
    : v2Frontpages(root, set.destination, set.frontpagePolicy);
  set.frontpages = frontpages;
  const configuredDocs = documentationFor(root, { docsRoot: existing.destination }).filter(item => item.eligible);
  const projectDocs = configuredDocs.length ? configuredDocs : documentationFor(root, { docsRoot: config.docsRoot || 'docs' }).filter(item => item.eligible);
  const selected = [...new Set([...frontpages, ...projectDocs.map(item => item.path)])];
  const expectedDocumentHashes = {};
  for (const rel of selected) expectedDocumentHashes[rel] = v2LiveHash(root, rel);
  if (input.expectedSnapshot && input.expectedSnapshot !== inventory.snapshot) problem('Repository snapshot changed since analysis. Rescan and retry.');
  if (input.expectedDocumentHashes) {
    for (const [rel, expected] of Object.entries(input.expectedDocumentHashes)) if (v2LiveHash(root, rel) !== expected) problem(`Document changed since analysis: ${rel}`);
  }
  if (persist && input.idempotencyKey && fs.existsSync(path.join(root, V2_STATE, 'runs'))) {
    for (const existingRunId of fs.readdirSync(path.join(root, V2_STATE, 'runs'))) {
      const existingRun = v2Read(root, `${V2_STATE}/runs/${existingRunId}/manifest.json`, null);
      if (existingRun?.idempotencyKey === input.idempotencyKey && existingRun.setId === set.setId) return { ok: true, action: mode, runId: existingRun.runId, plan: existingRun, idempotent: true, nextAction: existingRun.nextAction };
    }
  }
  const runId = crypto.randomUUID();
  const plan = {
    schemaVersion: V2, runId, setId: set.setId, mode, status: 'planned',
    baselineCommit: gitDetails(root).head, expectedSnapshot: inventory.snapshot,
    scopePolicyHash: v2Hash(JSON.stringify({ destination: set.destination, frontpagePolicy: set.frontpagePolicy, frontpages: set.frontpages })),
    expectedDocumentHashes, styleHash: style.hash, destination: set.destination,
    frontpagePolicy: set.frontpagePolicy, previousDestination: existing.destination, scope: { frontpages, selectedDocuments: selected, topics: v2Topics() }, qualityDimensions: { integrity: 'pending', freshness: 'pending', coverage: 'pending', uncertainty: 'pending', editorial: 'pending', publicationReadiness: 'pending' },
    stagedFiles: [], validationReceiptId: null, idempotencyKey: input.idempotencyKey ?? runId,
    createdAt: stamp(), updatedAt: stamp(), journal: [], conflicts: [], nextAction: 'archive',
  };
  plan.manifestHash = v2Hash(JSON.stringify({ ...plan, status: undefined, updatedAt: undefined, journal: undefined, conflicts: undefined, nextAction: undefined, manifestHash: undefined }));
  if (!persist || input.dryRun) return { ok: true, action: 'preview', plan, style, set, dryRun: true };
  v2PersistSet(root, registry, set);
  v2Write(root, `${V2_STATE}/runs/${runId}/manifest.json`, plan);
  v2Write(root, `${V2_STATE}/runs/${runId}/events.jsonl`, '');
  return { ok: true, action: mode, runId, set, plan, style, nextAction: 'archive' };
}

function v2LoadRun(root, runId) {
  identifier(runId, 'runId');
  const rel = `${V2_STATE}/runs/${runId}/manifest.json`;
  const run = v2Read(root, rel, null);
  if (!run) problem(`Unknown run: ${runId}`);
  if (run.schemaVersion !== V2) problem('Unsupported run schema version; expected 2.');
  return run;
}

function v2SaveRun(root, run) {
  run.updatedAt = stamp();
  v2Write(root, `${V2_STATE}/runs/${run.runId}/manifest.json`, run);
}

function v2Archive(root, run) {
  if (run.archiveId) return { ok: true, archiveId: run.archiveId, unchanged: true };
  const archiveId = crypto.randomUUID();
  const entries = [];
  const archiveRoot = `${V2_STATE}/archives/${archiveId}`;
  for (const [rel, expected] of Object.entries(run.expectedDocumentHashes)) {
    const current = v2LiveHash(root, rel);
    if (current !== expected) problem(`Document changed during archive: ${rel}`);
    if (expected === null) continue;
    const bytes = readBytes(root, rel, V2_LIMITS.pageBytes, { rejectHardlink: true });
    const destination = `${archiveRoot}/files/${rel}`;
    atomicWrite(root, destination, bytes, { exclusive: true });
    entries.push({ path: rel, archivePath: destination, sha256: v2Hash(bytes), bytes: bytes.length });
  }
  const manifest = { schemaVersion: V2, archiveId, runId: run.runId, setId: run.setId, destination: run.destination, frontpages: run.scope.frontpages, previousGenerationId: run.previousGenerationId, entries, verified: true, createdAt: stamp(), manifestHash: v2Hash(JSON.stringify(entries)) };
  v2Write(root, `${archiveRoot}/manifest.json`, manifest);
  run.archiveId = archiveId; run.status = 'archived'; run.nextAction = 'stage';
  v2SaveRun(root, run);
  return { ok: true, archiveId, entries: entries.length, verified: true, nextAction: 'stage' };
}

function v2Stage(root, run, input) {
  const pages = input.pages ?? [];
  if (!run.archiveId || !['archived', 'drafting', 'ready'].includes(run.status)) problem('A verified archive is required before staging.');
  const archiveManifest = v2Read(root, `${V2_STATE}/archives/${run.archiveId}/manifest.json`, null);
  if (!archiveManifest?.verified) problem('The run archive is missing or unverified.');
  array(pages, 'pages', 10000);
  if (!pages.length) problem('stage requires pages.');
  const staged = [];
  for (const page of pages) {
    keys(page, ['path', 'content'], 'staged page');
    documentPath(page.path); string(page.content, 'page.content', V2_LIMITS.pageBytes);
    const expected = run.expectedDocumentHashes[page.path];
    if (expected === undefined && !inside(page.path, run.destination) && !run.scope.frontpages.includes(page.path)) problem(`Staged path is outside the planned scope: ${page.path}`);
    const stagePath = `${V2_STATE}/runs/${run.runId}/staged/${page.path}`;
    atomicWrite(root, stagePath, page.content, { exclusive: true });
    staged.push({ path: page.path, stagePath, sha256: v2Hash(page.content), bytes: Buffer.byteLength(page.content), styleHash: run.styleHash });
  }
  run.stagedFiles = staged; run.status = 'drafting'; run.nextAction = 'validate'; v2SaveRun(root, run);
  return { ok: true, runId: run.runId, stagedFiles: staged, nextAction: 'validate' };
}

function v2Validate(root, run) {
  const config = configFor(root);
  const current = v2Snapshot(root, { ...config, exclude: [...(config.exclude || []), run.destination, run.previousDestination].filter(Boolean) });
  if (current !== run.expectedSnapshot) problem('Source changed since the run plan; promotion is blocked.');
  for (const [rel, expected] of Object.entries(run.expectedDocumentHashes)) if (v2LiveHash(root, rel) !== expected) problem(`Document changed since the run plan: ${rel}`);
  if (!run.stagedFiles.length) problem('No staged files to validate.');
  for (const staged of run.stagedFiles) {
    const bytes = readBytes(root, staged.stagePath, V2_LIMITS.pageBytes);
    if (v2Hash(bytes) !== staged.sha256) problem(`Staged bytes changed: ${staged.path}`);
  }
  const receipt = { schemaVersion: V2, receiptId: crypto.randomUUID(), runId: run.runId, sourceSnapshot: current, styleHash: run.styleHash, stagedFiles: run.stagedFiles, passed: true, createdAt: stamp() };
  receipt.hash = v2Hash(JSON.stringify(receipt));
  v2Write(root, `${V2_STATE}/runs/${run.runId}/validation/${receipt.receiptId}.json`, receipt);
  run.validationReceiptId = receipt.receiptId; run.status = 'ready'; run.nextAction = 'promote'; v2SaveRun(root, run);
  return { ok: true, receiptId: receipt.receiptId, passed: true, nextAction: 'promote' };
}

function v2Promote(root, run) {
  if (run.status === 'active') return { ok: true, runId: run.runId, unchanged: true, generationId: run.candidateGenerationId };
  const resuming = run.status === 'promoting';
  if (run.status !== 'ready' && !resuming) problem(`Run is not ready for promotion; current status is ${run.status}.`);
  const generationId = run.candidateGenerationId || crypto.randomUUID();
  run.status = 'promoting'; run.candidateGenerationId = generationId;
  if (!resuming) run.journal = [];
  v2SaveRun(root, run);
  for (const staged of run.stagedFiles) {
    const current = v2LiveHash(root, staged.path);
    const journaled = run.journal.find(entry => entry.path === staged.path && entry.state === 'committed');
    if (journaled && current === staged.sha256) continue;
    const expected = run.expectedDocumentHashes[staged.path] ?? null;
    if (current !== expected) {
      run.status = 'conflicted'; run.conflicts.push({ path: staged.path, expected, actual: current }); v2SaveRun(root, run);
      problem(`Document changed during promotion: ${staged.path}`);
    }
    const bytes = readBytes(root, staged.stagePath, V2_LIMITS.pageBytes);
    atomicWrite(root, staged.path, bytes, { exclusive: current === null, expectedHash: current });
    run.journal.push({ path: staged.path, state: 'committed', beforeSha256: current, afterSha256: staged.sha256 });
    v2SaveRun(root, run);
  }
  if (run.previousDestination && run.previousDestination !== run.destination) {
    const stagedPaths = new Set(run.stagedFiles.map(file => file.path));
    for (const rel of run.scope.selectedDocuments) {
      if (!inside(rel, run.previousDestination) || stagedPaths.has(rel) || run.scope.frontpages.includes(rel)) continue;
      const expected = run.expectedDocumentHashes[rel];
      if (expected === undefined || v2LiveHash(root, rel) !== expected) continue;
      fs.unlinkSync(safePath(root, rel));
      run.journal.push({ path: rel, state: 'removed-old-destination', beforeSha256: expected, afterSha256: null });
    }
  }
  const generation = { schemaVersion: V2, generationId, runId: run.runId, files: run.stagedFiles, topics: run.scope.topics, qualityDimensions: run.qualityDimensions, styleHash: run.styleHash, createdAt: stamp() };
  v2Write(root, `${V2_STATE}/sets/${run.setId}/generations/${generationId}/manifest.json`, generation);
  const registry = v2Sets(root);
  const set = registry.sets.find(item => item.setId === run.setId) ?? v2Set(root, { setId: run.setId, dest: run.destination }).set;
  set.activeGenerationId = generationId; v2PersistSet(root, registry, set);
  run.status = 'active'; run.nextAction = null; v2SaveRun(root, run);
  return { ok: true, runId: run.runId, generationId, status: 'active', journal: run.journal };
}

function v2Page(root, input) {
  keys(input, ['operation', 'setId', 'path', 'newPath', 'expectedSha256', 'reason', 'replacement'], 'page input');
  const { registry, set } = v2Set(root, input);
  documentPath(input.path);
  const pagesRel = `${V2_STATE}/sets/${set.setId}/pages.json`;
  const state = v2Read(root, pagesRel, { schemaVersion: V2, pages: [], history: [] });
  const current = v2LiveHash(root, input.path);
  if (input.expectedSha256 === undefined) problem('Page transitions require expectedSha256 to guard the current bytes.');
  if (input.expectedSha256 !== current) problem(`Page changed since it was read: ${input.path}`);
  const index = state.pages.findIndex(page => page.path === input.path);
  const old = index >= 0 ? state.pages[index] : { path: input.path, policy: 'generated', acceptedSha256: current };
  if (!['accept', 'release', 'rename', 'retire'].includes(input.operation)) problem('page operation must be accept, release, rename or retire.');
  if (input.operation === 'accept') {
    old.acceptedSha256 = current; old.policy = input.replacement ?? old.policy; old.updatedAt = stamp();
    if (index < 0) state.pages.push(old);
  } else if (input.operation === 'release') {
    old.policy = 'human'; old.updatedAt = stamp(); if (index < 0) state.pages.push(old);
  } else if (input.operation === 'rename') {
    documentPath(input.newPath); if (v2LiveHash(root, input.newPath) !== null) problem(`Destination already exists: ${input.newPath}`);
    if (current !== null) atomicWrite(root, input.newPath, readBytes(root, input.path, V2_LIMITS.pageBytes), { exclusive: true });
    if (current !== null) fs.unlinkSync(path.join(root, ...input.path.split('/')));
    old.path = input.newPath; old.updatedAt = stamp(); state.history.push({ operation: 'rename', from: input.path, to: input.newPath, at: stamp() });
    if (index < 0) state.pages.push(old);
  } else {
    old.policy = 'retired'; old.updatedAt = stamp(); if (index < 0) state.pages.push(old);
    state.history.push({ operation: 'retire', path: input.path, at: stamp(), reason: input.reason ?? 'retired by request' });
  }
  if (input.operation === 'rename') set.frontpages = set.frontpages.map(page => page === input.path ? input.newPath : page);
  if (input.operation === 'retire') set.frontpages = set.frontpages.filter(page => page !== input.path);
  v2Write(root, pagesRel, state); v2PersistSet(root, registry, set);
  return { ok: true, operation: input.operation, page: old, history: state.history };
}

function v2StyleOperation(root, input) {
  const { registry, set } = v2Set(root, input);
  if (input.operation === 'show') {
    const profile = set.selectedStyleHash ? v2Read(root, `${V2_STATE}/styles/${set.selectedStyleHash}.json`, null) : null;
    return { ok: true, operation: 'show', set, profile };
  }
  if (!['import', 'refresh'].includes(input.operation)) problem('style operation must be show, import or refresh.');
  const profile = v2Style(root, { styleFrom: input.source, style: input.mode }, set, { persist: true });
  set.selectedStyleHash = profile.hash; v2PersistSet(root, registry, set);
  return { ok: true, operation: input.operation, profile, set };
}

function runV2Operation(action, options = {}) {
  const root = fs.realpathSync(path.resolve(options.root ?? process.cwd()));
  if (!fs.statSync(root).isDirectory()) problem('root must identify a directory.');
  const input = options.input ?? {};
  const execute = () => {
    if (!input.dryRun && ['plan', 'initial', 'maintain', 'overhaul', 'archive', 'stage', 'validate', 'promote', 'resume', 'restore', 'page', 'style'].includes(action)) v2EnsureMigration(root);
    if (action === 'preview') return v2Run(root, { ...input, dryRun: true }, input.mode ?? 'overhaul', { persist: false });
    if (action === 'plan' || action === 'initial' || action === 'maintain' || action === 'overhaul') return v2Run(root, input, action, { persist: !input.dryRun });
    if (action === 'archives') {
      const list = [];
      const base = path.join(root, V2_STATE, 'archives');
      if (fs.existsSync(base)) for (const archiveId of fs.readdirSync(base).sort()) {
        const manifest = v2Read(root, `${V2_STATE}/archives/${archiveId}/manifest.json`, null);
        if (manifest) list.push(manifest);
      }
      return { ok: true, archives: list };
    }
    if (action === 'doctor') {
      const lock = present(root, `${V2_STATE}/write.lock`);
      return { ok: true, schemaVersion: V2, version: '2.0.0', lock: lock ? v2Read(root, `${V2_STATE}/write.lock`, null) : null, sets: v2Sets(root).sets };
    }
    if (action === 'details') {
      const resultId = identifier(input.resultId, 'resultId');
      const retained = diagnosticDetails.get(resultId);
      const detail = retained ?? v2Read(root, `${V2_STATE}/diagnostics/${resultId}.json`, null);
      if (!detail) return { ok: false, resultId, expired: true, items: [] };
      const source = Array.isArray(detail) ? detail : (detail.failures || detail.items || []);
      const offset = Number.isSafeInteger(input.offset) ? Math.max(0, input.offset) : 0;
      const limit = Number.isSafeInteger(input.limit) ? Math.min(100, Math.max(1, input.limit)) : 100;
      return { ok: true, resultId, total: source.length, offset, limit, items: source.slice(offset, offset + limit) };
    }
    if (action === 'archive' || action === 'stage' || action === 'validate' || action === 'promote') {
      const run = v2LoadRun(root, input.runId);
      if (action === 'archive') return v2Archive(root, run);
      if (action === 'stage') return v2Stage(root, run, input);
      if (action === 'validate') return v2Validate(root, run);
      return v2Promote(root, run);
    }
    if (action === 'resume') {
      const run = v2LoadRun(root, input.runId);
      if (run.status === 'planned') return v2Archive(root, run);
      if (run.status === 'archived') return { ok: true, runId: run.runId, nextAction: 'stage' };
      if (run.status === 'ready') return v2Promote(root, run);
      if (run.status === 'promoting') {
        for (const staged of run.stagedFiles) {
          const current = v2LiveHash(root, staged.path);
          const expected = run.expectedDocumentHashes[staged.path] ?? null;
          if (current !== expected && current !== staged.sha256) {
            run.status = 'conflicted';
            run.conflicts.push({ path: staged.path, expected, actual: current });
            v2SaveRun(root, run);
            return { ok: false, runId: run.runId, status: run.status, conflicts: run.conflicts };
          }
          if (current === staged.sha256 && !run.journal.some(entry => entry.path === staged.path && entry.state === 'committed')) {
            run.journal.push({ path: staged.path, state: 'committed', beforeSha256: expected, afterSha256: current });
          }
        }
        return v2Promote(root, run);
      }
      return { ok: true, runId: run.runId, status: run.status, nextAction: run.nextAction };
    }
    if (action === 'restore') {
      const manifest = v2Read(root, `${V2_STATE}/archives/${input.archiveId}/manifest.json`, null);
      if (!manifest?.verified) problem('Archive is missing or not verified.');
      for (const entry of manifest.entries) documentPath(entry.path);
      const entries = manifest.entries.map(entry => ({ path: entry.path, sha256: entry.sha256, bytes: entry.bytes }));
      if (input.dryRun) return { ok: true, archiveId: input.archiveId, dryRun: true, entries };
      if (!obj(input.expectedDocumentHashes)) problem('restore requires expectedDocumentHashes for every archived document.');
      for (const entry of manifest.entries) {
        if (input.expectedDocumentHashes[entry.path] === undefined) problem(`restore is missing the expected hash for ${entry.path}.`);
      }
      const restored = [];
      for (const entry of manifest.entries) {
        const current = v2LiveHash(root, entry.path);
        if (input.expectedDocumentHashes[entry.path] !== current) problem(`Document changed during restore: ${entry.path}`);
        const bytes = readBytes(root, entry.archivePath, V2_LIMITS.pageBytes);
        if (v2Hash(bytes) !== entry.sha256) problem(`Archive content is corrupt: ${entry.path}`);
        atomicWrite(root, entry.path, bytes, { exclusive: current === null, expectedHash: current });
        restored.push(entry.path);
      }
      return { ok: true, archiveId: input.archiveId, restored };
    }
    if (action === 'page') return v2Page(root, input);
    if (action === 'style') return v2StyleOperation(root, input);
    if (action === 'scan-v2') {
      const config = configFor(root);
      const inventory = inventoryFor(root, config);
      const symbols = inventory.files.filter(file => file.eligible).map(file => ({ path: file.path, ...inventorySymbols(file.path, readText(root, file.path, config.maxFileBytes)) }));
      return { ok: true, action, snapshot: inventory.snapshot, inventory, symbols };
    }
  };
  const readOnlyAction = action === 'preview' || action === 'archives' || action === 'doctor' || action === 'details' || (action === 'style' && input.operation === 'show') || (action === 'restore' && input.dryRun) || (['plan', 'initial', 'maintain', 'overhaul'].includes(action) && input.dryRun);
  const writes = !readOnlyAction && ['plan', 'overhaul', 'archive', 'stage', 'validate', 'promote', 'resume', 'restore', 'page', 'style', 'scan-v2'].includes(action);
  return writes ? withLock(root, execute) : execute();
}

/** Run a deterministic operation. V1 actions remain compatibility operations; v2 actions use the guarded lifecycle above. */
export function runOperation(action, { root, input, strict = false, signal, onUpdate } = {}) {
  const v2Actions = new Set(['preview', 'plan', 'initial', 'maintain', 'overhaul', 'archive', 'stage', 'validate', 'promote', 'resume', 'archives', 'restore', 'page', 'style', 'doctor', 'details', 'scan-v2']);
  if (v2Actions.has(action)) return runV2Operation(action, { root, input, strict });
  if (!['scan', 'status', 'record', 'publish', 'check'].includes(action)) problem(`Unknown operation: ${action}`);
  string(root, 'root', 4096);
  const absolute = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(absolute).isDirectory()) problem('root must identify a directory.');
  const config = configFor(absolute);
  const mutates = ['scan', 'record', 'publish'].includes(action);
  if (mutates) assertBranch(config, gitDetails(absolute));
  const execute = () => {
    if (mutates) {
      assertBranch(config, gitDetails(absolute));
      if (!present(absolute, `${STATE}/config.json`)) writeJSON(absolute, `${STATE}/config.json`, config);
    }
    if (action === 'publish') return publish(absolute, config, input);
    const inventory = inventoryFor(absolute, config, { signal, onUpdate });
    const previous = loadPrevious(absolute);
    const delta = changes(previous, inventory);
    if (action === 'record') return record(absolute, config, inventory, input);
    if (action === 'scan') writeJSON(absolute, `${STATE}/inventory.json`, inventory);
    const evaluated = evaluate(absolute, inventory);
    const result = { ok: true, action, ...bounded(evaluated.summary), configuration: config, changes: Object.fromEntries(Object.entries(delta).map(([key, values]) => [key, { count: values.length, paths: values.slice(0, 100), truncated: Math.max(0, values.length - 100) }])), state: { inventory: `${STATE}/inventory.json`, ledger: `${STATE}/ledger.json`, ownership: `${STATE}/ownership.json` }, inventoryPersisted: action === 'scan', git: inventory.git };
    if (action === 'check') {
      const pages = [...new Set([...inventory.documents.filter(page => page.eligible).map(page => page.path), ...inventory.files.filter(page => page.eligible && /\.md$/i.test(page.path)).map(page => page.path), ...evaluated.ownership.pages.map(page => page.path), ...evaluated.ledger.reviews.flatMap(review => review.documents), ...evaluated.ledger.claims.flatMap(claim => claim.documents)])];
      const links = linksFor(absolute, pages);
      const attention = evaluated.summary.attention;
      const integrity = !attention.staleReviews.length && !attention.staleClaims.length && !attention.stalePages.length && !links.failures.length && !attention.unsettledClaims.length;
      const complete = integrity && inventory.files.some(file => file.eligible) && !attention.unreviewed.length && !attention.undocumented.length && !attention.unreviewedDocumentation.length && !attention.gaps.length && !attention.documentationGaps.length && !attention.openUnknowns.length && evaluated.summary.coverage.claims.supported > 0;
      return { ...result, ok: strict ? complete : integrity, strict, integrity, complete, links, note: 'PASS means the selected mechanical checks passed. It is not a guarantee that every statement is true, every symbol was enumerated, or every command was executed.' };
    }
    return result;
  };
  return mutates ? withLock(absolute, execute) : execute();
}
