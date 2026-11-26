import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Error code for an explicit Existing request with no usable basis. */
export const STYLE_EXISTING_UNAVAILABLE = 'STYLE_EXISTING_UNAVAILABLE';
/** Error code for an explicit source that cannot be read or extracted. */
export const STYLE_SOURCE_UNAVAILABLE = 'STYLE_SOURCE_UNAVAILABLE';
/** Error code for conflicting style selectors. */
export const STYLE_SELECTION_CONFLICT = 'STYLE_SELECTION_CONFLICT';
/** Error code for malformed or tampered saved profiles. */
export const STYLE_PROFILE_INVALID = 'STYLE_PROFILE_INVALID';

export const FRESH_PROFILE_ID = 'human-centred-v1';
export const FRESH_PROFILE_VERSION = 1;
export const QUALITY_STANDARD_VERSION = 'human-centred-v1';

const DEFAULT_LIMITS = Object.freeze({ maxPages: 20, maxBytes: 2 * 1024 * 1024, maxExamples: 3, maxExampleBytes: 2048 });
const PROFILE_ROLES = new Set(['style', 'practice', 'project-truth', 'historical-context']);
const ROLE_ALIASES = new Map([
  ['editorial-guidance', 'practice'],
  ['style-example', 'style'],
  ['project-documentation', 'project-truth'],
  ['factual-reference', 'historical-context'],
]);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkdn']);
const TEXT_EXTENSIONS = new Set(['.txt', '.text', '']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const encoder = new TextEncoder();

export class StyleError extends Error {
  constructor(code, message, cause) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = 'StyleError';
    this.code = code;
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function nowIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return new Date().toISOString();
}

function canonical(value, { omit = new Set(), pathParts = [] } = {}) {
  if (Array.isArray(value)) return `[${value.map((item, index) => canonical(item, { omit, pathParts: [...pathParts, String(index)] })).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).filter(key => !omit.has([...pathParts, key].join('.')) && !omit.has(key)).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], { omit, pathParts: [...pathParts, key] })}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashInput(profile) {
  const value = clone(profile);
  delete value.profileHash;
  delete value.createdAt;
  delete value.updatedAt;
  delete value.selection;
  delete value.selectionReason;
  if (Array.isArray(value.provenance)) {
    value.provenance = value.provenance.map(entry => {
      const copy = { ...entry };
      delete copy.retrievedAt;
      return copy;
    });
  }
  return canonical(value);
}

/** Return the stable SHA-256 identity for a style profile's editorial content. */
export function hashStyleProfile(profile) {
  if (!isObject(profile)) throw new StyleError(STYLE_PROFILE_INVALID, 'Style profile must be an object.');
  return sha256(hashInput(profile));
}

function profileWithHash(profile) {
  const result = clone(profile);
  result.profileHash = hashStyleProfile(result);
  return result;
}

function normalizeRoles(role, fallback = 'style') {
  const values = Array.isArray(role) ? role : [role];
  const roles = values
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => ROLE_ALIASES.get(value.trim()) || value.trim())
    .filter(value => PROFILE_ROLES.has(value));
  return roles.length ? [...new Set(roles)] : [fallback];
}

function normalizeRole(role, fallback = 'style') {
  return normalizeRoles(role, fallback)[0];
}

function normalizeLimits(options = {}) {
  const provided = isObject(options.limits) ? options.limits : options;
  const limits = { ...DEFAULT_LIMITS, ...provided };
  for (const key of ['maxPages', 'maxBytes', 'maxExamples', 'maxExampleBytes']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `limits.${key} must be a non-negative safe integer.`);
  }
  return limits;
}

function formatFor(location, declared) {
  if (typeof declared === 'string' && declared.trim()) {
    const value = declared.toLowerCase().replace(/^\./, '');
    if (['md', 'markdown'].includes(value)) return 'markdown';
    if (['txt', 'text', 'plain'].includes(value)) return 'text';
    if (['html', 'htm'].includes(value)) return 'html';
    throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Unsupported source format: ${declared}. Supported formats are Markdown, plain text and HTML.`);
  }
  const extension = path.extname(typeof location === 'string' ? location : '').toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return null;
}

function looksLikeInline(value) {
  return value.includes('\n') || value.includes('\r') || /^\s*(?:#|<(!DOCTYPE|html|head|body|main|article|section|h[1-6])\b)/i.test(value) || (!value.includes('/') && !value.startsWith('.') && !/\.(?:md|markdown|txt|text|html?|pdf|docx?)$/i.test(value));
}

function readLocalFile(filePath, maxBytes) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch (error) {
    throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Cannot access source file ${filePath}: ${error.message}`, error);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Source is not a regular file: ${filePath}.`);
  const size = info.size;
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const bytesToRead = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    let offset = 0;
    while (offset < bytesToRead) {
      const count = fs.readSync(fd, buffer, offset, bytesToRead - offset, offset);
      if (!count) break;
      offset += count;
    }
    const bytes = offset === buffer.length ? buffer : buffer.subarray(0, offset);
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), truncated: size > maxBytes, size };
  } catch (error) {
    if (error instanceof TypeError) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Source is not valid UTF-8 text: ${filePath}.`, error);
    if (error instanceof StyleError) throw error;
    throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Cannot read source file ${filePath}: ${error.message}`, error);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sourceDescriptor(source, limits, { explicit = true } = {}) {
  if (isObject(source)) {
    const roles = normalizeRoles(source.role, 'style');
    const role = roles[0];
    const location = source.location || source.path || source.name || 'inline';
    const declaredFormat = source.format || source.type;
    if (own(source, 'content') || own(source, 'text') || own(source, 'html')) {
      const content = source.content ?? source.text ?? source.html;
      if (typeof content !== 'string' || !content.trim()) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, 'Explicit source content is empty.');
      const format = formatFor(location, declaredFormat) || (own(source, 'html') ? 'html' : /<\/?[a-z][^>]*>/i.test(content) ? 'html' : 'text');
      return { content, format, location: String(location), role, roles, revision: source.revision ?? null, retrievedAt: source.retrievedAt, originalBytes: encoder.encode(content).byteLength, truncated: false };
    }
    if (typeof source.path === 'string') {
      const format = formatFor(source.path, declaredFormat);
      if (!format) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Unsupported source format for ${source.path}. Supported formats are Markdown, plain text and HTML.`);
      const read = readLocalFile(source.path, limits.maxBytes);
      if (!read.content.trim()) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Source file is empty: ${source.path}.`);
      return {
        content: read.content,
        format,
        location: String(source.location || source.path),
        role,
        roles,
        revision: source.revision ?? null,
        retrievedAt: source.retrievedAt,
        originalBytes: read.size,
        truncated: read.truncated,
      };
    }
    throw new StyleError(STYLE_SOURCE_UNAVAILABLE, 'Source object must contain content or a local path.');
  }
  if (typeof source !== 'string' || !source.trim()) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, 'Explicit source must be a nonempty local path or text value.');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(source)) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Remote source is unavailable offline: ${source}`);
  const location = source;
  const declaredFormat = undefined;
  let exists = false;
  try { exists = fs.existsSync(source); } catch { exists = false; }
  if (exists) {
    const format = formatFor(location, declaredFormat);
    if (!format) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Unsupported source format for ${source}. Supported formats are Markdown, plain text and HTML.`);
    const read = readLocalFile(source, limits.maxBytes);
    if (!read.content.trim()) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Source file is empty: ${source}.`);
    return { content: read.content, format, location, role: 'style', roles: ['style'], revision: null, retrievedAt: null, originalBytes: read.size, truncated: read.truncated };
  }
  if (!looksLikeInline(source)) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, `Cannot access source file ${source}.`);
  const format = /<\/?(?:html|head|body|main|article|section|h[1-6]|p|ul|ol|pre)\b/i.test(source) ? 'html' : 'text';
  if (!source.trim()) throw new StyleError(STYLE_SOURCE_UNAVAILABLE, 'Explicit source content is empty.');
  return { content: source, format, location: 'inline', role: 'style', roles: ['style'], revision: null, retrievedAt: null, originalBytes: encoder.encode(source).byteLength, truncated: false };
}

function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function markdownParts(content) {
  const headings = [];
  const codeExamples = [];
  const lines = content.split(/\r?\n/);
  let fence = null;
  let block = [];
  let language = '';
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) headings.push({ level: heading[1].length, text: heading[2].trim() });
    const opener = line.match(/^\s*(`{3,}|~{3,})\s*([^\s]*)?.*$/);
    if (!fence && opener) {
      fence = opener[1][0];
      language = opener[2] || '';
      block = [];
    } else if (fence && new RegExp(`^\\s*${fence}{3,}\\s*$`).test(line)) {
      codeExamples.push({ language, text: block.join('\n') });
      fence = null;
      block = [];
      language = '';
    } else if (fence) block.push(line);
  }
  return { text: content, headings, codeExamples };
}

function htmlParts(content) {
  const headings = [];
  const codeExamples = [];
  let safe = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  safe = safe.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (whole, level, value) => {
    const text = decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text) headings.push({ level: Number(level), text });
    return `\n${text}\n`;
  });
  safe = safe.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (whole, value) => {
    const code = decodeEntities(value.replace(/<code\b[^>]*>|<\/code\s*>/gi, '')).trim();
    if (code) codeExamples.push({ language: '', text: code });
    return `\n${code}\n`;
  });
  const text = decodeEntities(safe
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|ul|ol|section|article|main|blockquote|table|tr|td|th)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, headings, codeExamples };
}

function partsFor(content, format) {
  if (format === 'html') return htmlParts(content);
  if (format === 'markdown') return markdownParts(content);
  return { text: content, headings: [], codeExamples: [] };
}

function headingRule(headings) {
  if (!headings.length) return 'Use descriptive sentence-case headings with a shallow hierarchy.';
  const sentenceCase = headings.filter(({ text }) => /^[A-Z][^A-Z]*$/.test(text.replace(/[`*_]/g, ''))).length;
  const style = sentenceCase * 2 >= headings.length ? 'sentence case' : 'the established capitalization from the source';
  const maxLevel = Math.max(...headings.map(({ level }) => level));
  return `Use descriptive ${style} headings and keep hierarchy shallow (observed depth ${maxLevel}).`;
}

function spellingRule(text) {
  const colour = (text.match(/\bcolour|\bcolours|\bbehaviour|\borganisation/gi) || []).length;
  const color = (text.match(/\bcolor|\bcolors|\bbehavior|\borganization/gi) || []).length;
  if (colour > color) return 'Retain the project spelling observed in the source, including British or Australian forms.';
  if (color > colour) return 'Retain the project spelling observed in the source, including American forms.';
  return 'Use one consistent project spelling and preserve exact technical identifiers.';
}

function termsFrom(text) {
  const terms = new Map();
  for (const match of text.matchAll(/`([^`\n]{1,80})`/g)) {
    const term = match[1].trim();
    if (term && /^[A-Za-z][A-Za-z0-9_.:/-]*$/.test(term)) terms.set(term, term);
  }
  return Object.fromEntries([...terms.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 32));
}

const PAGE_PATTERNS = Object.freeze({
  frontpage: ['State purpose, intended reader, supported capability, first useful action and next links.'],
  tutorial: ['State prerequisites, guide one small first-use journey, check intermediate results and name the next task.'],
  howto: ['Start from a clear state, order the actions, show expected results and include relevant recovery.'],
  reference: ['Define exact inputs, defaults, outputs, errors, side effects and concise examples.'],
  explanation: ['Explain responsibilities, relationships, tradeoffs and established limitations.'],
  troubleshooting: ['Name the symptom, inspect evidence-supported causes, apply bounded correction and confirm recovery.'],
});

const BASE_RULES = Object.freeze({
  audience: ['A reader who knows the goal but is new to this project.'],
  voice: ['Use a direct, respectful and technically precise voice.', 'Prefer active voice and explain unfamiliar terms before relying on them.'],
  links: ['Use descriptive link text and stable local routes.', 'Keep task, component and reference paths connected.'],
  codeExamples: ['State prerequisites, runtime, working directory and inputs.', 'Label examples as observed, checked or illustrative; do not imply execution.'],
  evidencePresentation: ['Support product claims with current evidence.', 'State uncertainty, limits and recovery guidance without inventing facts.'],
  accessibility: ['Keep essential actions and explanations available as searchable text.', 'Provide text alternatives for essential visual or timed content.'],
});

function safeExample(value, maxBytes) {
  const text = value.text.trim();
  if (!text) return null;
  if (/(?:password|secret|token|api[_-]?key|private[_-]?key)\s*[:=]/i.test(text)) return '[example omitted because it resembles credential material]';
  const bytes = encoder.encode(text);
  return new TextDecoder().decode(bytes.subarray(0, maxBytes));
}

function makeProvenance(descriptor, parts, limits, options = {}) {
  const original = descriptor.content;
  const byteLength = encoder.encode(original).byteLength;
  const truncated = descriptor.truncated || byteLength > limits.maxBytes;
  const contentHash = truncated ? null : sha256(original);
  const roles = descriptor.roles || [descriptor.role || 'style'];
  return roles.map(role => ({
    role,
    location: descriptor.location,
    samplePaths: descriptor.location === 'inline' ? [] : [descriptor.location],
    retrievedAt: descriptor.retrievedAt ? nowIso(descriptor.retrievedAt) : nowIso(options.now),
    revision: descriptor.revision ?? null,
    contentHash,
    hashUnavailableReason: contentHash ? null : `Source exceeded the ${limits.maxBytes}-byte extraction limit.`,
  }));
}

function profileFromDescriptor(descriptor, { origin = 'supplied-reference', selection = 'explicit', selectionReason, now, limits } = {}) {
  const parts = partsFor(descriptor.content, descriptor.format);
  const sampledPages = Math.min(parts.headings.length || 1, limits.maxPages);
  const examples = parts.codeExamples.slice(0, limits.maxExamples).map(example => ({
    purpose: example.language ? `Illustrative ${example.language} example from the selected source.` : 'Illustrative code example from the selected source.',
    text: safeExample(example, limits.maxExampleBytes),
    status: 'illustrative',
  })).filter(example => example.text);
  const rules = {
    audience: [...BASE_RULES.audience],
    voice: [...BASE_RULES.voice],
    spelling: spellingRule(parts.text),
    terminology: termsFrom(parts.text),
    headings: [headingRule(parts.headings)],
    links: [...BASE_RULES.links],
    codeExamples: [...BASE_RULES.codeExamples],
    evidencePresentation: [...BASE_RULES.evidencePresentation],
    accessibility: [...BASE_RULES.accessibility],
  };
  const profile = {
    schemaVersion: 2,
    profileId: origin === 'fresh' ? FRESH_PROFILE_ID : `${origin}-v1`,
    profileVersion: 1,
    profileHash: '',
    qualityStandardVersion: QUALITY_STANDARD_VERSION,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    origin,
    selection,
    selectionReason: selectionReason || 'Style conventions were derived from the selected source without importing its factual authority.',
    provenance: makeProvenance(descriptor, parts, limits, { now }),
    rules,
    pagePatterns: clone(PAGE_PATTERNS),
    decisions: [{
      topic: 'source authority',
      selected: 'Presentation conventions only',
      rejected: ['Source facts, product claims and operational instructions as target-project authority'],
      reason: 'The selected source informs style, not the target project evidence record.',
    }],
    extractionLimits: {
      maxPages: limits.maxPages,
      maxBytes: limits.maxBytes,
      sampledPages,
      omissions: descriptor.truncated ? ['Source content was truncated at the configured byte limit.'] : [],
    },
    examples,
  };
  return profileWithHash(profile);
}

/** Create the versioned offline Fresh style profile. */
export function createFreshProfile({ selection = 'default', selectionReason, now } = {}) {
  const profile = {
    schemaVersion: 2,
    profileId: FRESH_PROFILE_ID,
    profileVersion: FRESH_PROFILE_VERSION,
    profileHash: '',
    qualityStandardVersion: QUALITY_STANDARD_VERSION,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    origin: 'fresh',
    selection,
    selectionReason: selectionReason || 'No adopted profile or usable existing documentation was available.',
    provenance: [],
    rules: {
      audience: [...BASE_RULES.audience],
      voice: [...BASE_RULES.voice],
      spelling: 'Use one consistent project spelling and preserve exact technical identifiers.',
      terminology: {},
      headings: ['Use descriptive sentence-case headings with a shallow hierarchy.'],
      links: [...BASE_RULES.links],
      codeExamples: [...BASE_RULES.codeExamples],
      evidencePresentation: [...BASE_RULES.evidencePresentation],
      accessibility: [...BASE_RULES.accessibility],
    },
    pagePatterns: clone(PAGE_PATTERNS),
    decisions: [],
    extractionLimits: { maxPages: DEFAULT_LIMITS.maxPages, maxBytes: DEFAULT_LIMITS.maxBytes, sampledPages: 0, omissions: [] },
    examples: [],
  };
  return profileWithHash(profile);
}

function validateProfile(value, { verifyHash = true } = {}) {
  if (!isObject(value) || value.schemaVersion !== 2 || typeof value.profileId !== 'string' || !value.profileId || !Number.isSafeInteger(value.profileVersion) || value.profileVersion < 1 || !isObject(value.rules) || !isObject(value.pagePatterns) || !Array.isArray(value.provenance)) {
    throw new StyleError(STYLE_PROFILE_INVALID, 'Saved style profile does not match schema version 2.');
  }
  const profile = clone(value);
  if (verifyHash && typeof profile.profileHash === 'string' && profile.profileHash !== hashStyleProfile(profile)) throw new StyleError(STYLE_PROFILE_INVALID, 'Saved style profile hash does not match its content.');
  profile.profileHash = hashStyleProfile(profile);
  return profile;
}

/** Serialize a profile as stable, reusable JSON without writing to disk. */
export function serializeStyleProfile(profile) {
  return `${JSON.stringify(validateProfile(profile), null, 2)}\n`;
}

/** Parse and verify a serialized profile for offline reuse. */
export function parseStyleProfile(serialized) {
  if (typeof serialized !== 'string') throw new StyleError(STYLE_PROFILE_INVALID, 'Serialized style profile must be text.');
  try {
    return validateProfile(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof StyleError) throw error;
    throw new StyleError(STYLE_PROFILE_INVALID, `Cannot parse saved style profile: ${error.message}`, error);
  }
}

function normalizeSavedProfile(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? parseStyleProfile(value) : validateProfile(value);
  } catch {
    return null;
  }
}

function documentEntries(existingDocuments) {
  if (!existingDocuments) return [];
  if (isObject(existingDocuments) && Array.isArray(existingDocuments.documents)) return documentEntries(existingDocuments.documents);
  if (isObject(existingDocuments) && !own(existingDocuments, 'content') && !own(existingDocuments, 'path') && !own(existingDocuments, 'text')) return Object.entries(existingDocuments).map(([documentPath, content]) => ({ path: documentPath, content }));
  if (!Array.isArray(existingDocuments)) return [existingDocuments];
  return existingDocuments;
}

function usableDocumentDescriptor(entry, limits) {
  if (typeof entry === 'string') entry = looksLikeInline(entry) ? { content: entry } : { path: entry };
  if (!isObject(entry)) return null;
  const location = entry.path || entry.location || entry.name;
  const declaredFormat = entry.format || entry.type;
  if (typeof entry.content === 'string' || typeof entry.text === 'string' || typeof entry.html === 'string') {
    const content = entry.content ?? entry.text ?? entry.html;
    if (!content.trim()) return null;
    let format;
    try { format = formatFor(location, declaredFormat) || (own(entry, 'html') ? 'html' : /<\/?[a-z][^>]*>/i.test(content) ? 'html' : 'text'); } catch { return null; }
  return { content, format, location: String(location || 'inline'), roles: normalizeRoles(entry.role, 'project-truth'), role: normalizeRole(entry.role, 'project-truth'), revision: entry.revision ?? null, retrievedAt: entry.retrievedAt, originalBytes: encoder.encode(content).byteLength, truncated: false };
  }
  if (typeof entry.path !== 'string') return null;
  let format;
  try { format = formatFor(entry.path, declaredFormat); } catch { return null; }
  if (!format) return null;
  try {
    const read = readLocalFile(entry.path, limits.maxBytes);
    return { content: read.content, format, location: entry.path, roles: normalizeRoles(entry.role, 'project-truth'), role: normalizeRole(entry.role, 'project-truth'), revision: entry.revision ?? null, retrievedAt: entry.retrievedAt, originalBytes: read.size, truncated: read.truncated };
  } catch {
    return null;
  }
}

function deriveExisting(existingDocuments, { selection, now, limits }) {
  const descriptors = documentEntries(existingDocuments).map(entry => usableDocumentDescriptor(entry, limits)).filter(Boolean).slice(0, limits.maxPages);
  if (!descriptors.length) return null;
  const combined = descriptors.map(({ content }) => content).join('\n\n');
  const first = descriptors[0];
  const profile = profileFromDescriptor({ ...first, content: combined, location: first.location, roles: ['project-truth'], role: 'project-truth', truncated: descriptors.some(item => item.truncated) }, {
    origin: 'existing-derived',
    selection,
    selectionReason: 'Usable project documentation was available; its presentation conventions were derived before any destination changes.',
    now,
    limits,
  });
  profile.provenance = descriptors.flatMap(descriptor => {
    const parts = partsFor(descriptor.content, descriptor.format);
    return makeProvenance(descriptor, parts, limits, { now });
  });
  profile.extractionLimits.sampledPages = descriptors.length;
  profile.extractionLimits.omissions = descriptors.length < documentEntries(existingDocuments).length ? ['Additional documentation was outside the configured sample limit or unsupported.'] : profile.extractionLimits.omissions;
  profile.profileHash = hashStyleProfile(profile);
  return profile;
}

/** Extract a bounded style profile from local Markdown, plain text or HTML content. */
export function extractStyleProfile(source, options = {}) {
  const limits = normalizeLimits(options);
  const descriptor = sourceDescriptor(source, limits);
  return profileFromDescriptor(descriptor, {
    origin: options.origin || 'supplied-reference',
    selection: options.selection || 'explicit',
    selectionReason: options.selectionReason,
    now: options.now,
    limits,
  });
}

function requestMode(request, source) {
  if (typeof request === 'string') {
    const mode = request.toLowerCase();
    if (source !== undefined && mode !== 'source' && mode !== 'style-from') throw new StyleError(STYLE_SELECTION_CONFLICT, 'Choose one of Existing, Fresh or a supplied style source.');
    return { mode, source };
  }
  if (!isObject(request)) return { mode: source === undefined ? null : 'source', source };
  const style = request.style ?? request.mode ?? request.kind;
  const supplied = request.styleFrom ?? request.source ?? source;
  if (style !== undefined && supplied !== undefined && !['source', 'style-from'].includes(String(style).toLowerCase())) throw new StyleError(STYLE_SELECTION_CONFLICT, 'Choose one of Existing, Fresh or a supplied style source.');
  if (supplied !== undefined) return { mode: 'source', source: supplied };
  return { mode: style === undefined || style === null ? null : String(style).toLowerCase(), source: undefined };
}

/** Resolve saved Existing, usable documentation, Fresh, or an explicit source in deterministic order. */
export function resolveStyle({ request, savedProfile, existingDocuments, source, now, limits } = {}) {
  const selection = requestMode(request, source);
  const normalizedLimits = normalizeLimits({ limits });
  const saved = normalizeSavedProfile(savedProfile);
  if (!selection.mode) {
    if (saved) return saved;
    const existing = deriveExisting(existingDocuments, { selection: 'default', now, limits: normalizedLimits });
    return existing || createFreshProfile({ selection: 'default', now });
  }
  if (selection.mode === 'fresh') return createFreshProfile({ selection: 'explicit', selectionReason: 'Fresh style was explicitly selected.', now });
  if (selection.mode === 'existing') {
    if (saved) return saved;
    const existing = deriveExisting(existingDocuments, { selection: 'explicit', now, limits: normalizedLimits });
    if (existing) return existing;
    throw new StyleError(STYLE_EXISTING_UNAVAILABLE, 'No saved adopted profile or usable existing documentation was available.');
  }
  if (selection.mode === 'source' || selection.mode === 'style-from') {
    try {
      return extractStyleProfile(selection.source, { now, limits: normalizedLimits, selection: 'explicit' });
    } catch (error) {
      if (error instanceof StyleError && error.code === STYLE_SOURCE_UNAVAILABLE) throw error;
      throw new StyleError(STYLE_SOURCE_UNAVAILABLE, error.message, error);
    }
  }
  throw new StyleError(STYLE_SELECTION_CONFLICT, `Unknown style selection ${selection.mode}. Use existing, fresh or a supplied source.`);
}

export const extractStyle = extractStyleProfile;
export const parseStyleProfileJson = parseStyleProfile;
export const serializeStyleProfileJson = serializeStyleProfile;
