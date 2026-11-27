import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sortedUnique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));

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

function headingFor(line) {
  const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
  if (!match) return null;
  let title = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
  const anchor = /\s+\{#([A-Za-z][\w:.-]*)\}\s*$/.exec(title);
  const explicitId = anchor ? anchor[1].toLowerCase() : null;
  if (anchor) title = title.slice(0, anchor.index).trim();
  return title ? { level: match[1].length, title, explicitId } : null;
}

function headingSlug(title) {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

function parseSections(markdown) {
  if (typeof markdown !== 'string') throw new Error('Section merge needs Markdown strings.');
  const lines = markdown.split(/\r?\n/);
  const result = [];
  const seen = new Map();
  const ambiguous = new Set();
  const stack = [];
  let current = { key: '__preamble__', identity: 'preamble', level: 0, title: null, parent: null, lines: [] };
  const flush = () => result.push(current);
  for (const line of lines) {
    const heading = headingFor(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    flush();
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const identity = heading.explicitId ? `id:${heading.explicitId}` : `heading:${headingSlug(heading.title)}`;
    const occurrence = (seen.get(identity) || 0) + 1;
    seen.set(identity, occurrence);
    if (occurrence > 1) ambiguous.add(identity);
    const key = occurrence === 1 ? identity : `${identity}#${occurrence}`;
    current = {
      key,
      identity,
      occurrence,
      level: heading.level,
      title: heading.title,
      explicitId: heading.explicitId,
      parent: stack.length ? stack[stack.length - 1].key : null,
      lines: [line]
    };
    stack.push({ key, level: heading.level });
  }
  flush();
  const siblings = new Map();
  const positions = new Map();
  for (const section of result) {
    if (section.key === '__preamble__') continue;
    const siblingList = siblings.get(section.parent) || [];
    positions.set(section.key, { parent: section.parent, previous: siblingList.length ? siblingList[siblingList.length - 1] : null, level: section.level });
    siblingList.push(section.key);
    siblings.set(section.parent, siblingList);
  }
  return { sections: result, positions, ambiguous: [...ambiguous].sort() };
}

function positionEqual(left, right) {
  if (!left || !right) return !left && !right;
  return left.parent === right.parent && left.previous === right.previous && left.level === right.level;
}
function comparablePosition(parsed, key, referenceKeys) {
  const position = parsed.positions.get(key);
  if (!position) return null;
  let previous = position.previous;
  while (previous && !referenceKeys.has(previous)) previous = parsed.positions.get(previous)?.previous ?? null;
  return { parent: referenceKeys.has(position.parent) ? position.parent : null, previous, level: position.level };
}

function renderSections(order, selected) {
  const chunks = order.map(key => selected.get(key)).filter(text => text !== null && text !== undefined && text !== '');
  if (!chunks.length) return '\n';
  return `${chunks.join('\n\n').replace(/\n+$/u, '')}\n`;
}

function interruptedMerge(current, reason) {
  return {
    schemaVersion: 2,
    merged: current,
    conflicts: [],
    moves: [],
    insertions: [],
    deletions: [],
    identity: { scheme: 'explicit heading id or normalized heading identity with occurrence', ambiguous: [] },
    unknowns: [{ code: 'merge-interrupted', reason }],
    clean: false,
    interrupted: true,
    basis: 'baseline-preserving three-way merge; interrupted candidates never replace current content'
  };
}

export function mergeMarkdownSections(base, current, candidate, options = {}) {
  if (typeof options !== 'object' || options === null) options = {};
  if ((!candidate.trim() && base.trim()) || options.interrupted || options.candidateInterrupted || options.signal?.aborted) return interruptedMerge(current, 'The candidate merge was interrupted before completion.');
  const baseParsed = parseSections(base);
  const currentParsed = parseSections(current);
  const candidateParsed = parseSections(candidate);
  const baseSections = new Map(baseParsed.sections.map(section => [section.key, section]));
  const currentSections = new Map(currentParsed.sections.map(section => [section.key, section]));
  const candidateSections = new Map(candidateParsed.sections.map(section => [section.key, section]));
  const referenceKeys = new Set(baseSections.keys());
  const baseOrder = baseParsed.sections.map(section => section.key);
  const currentOrder = currentParsed.sections.map(section => section.key);
  const candidateOrder = candidateParsed.sections.map(section => section.key);
  const order = [...new Set([...baseOrder, ...currentOrder, ...candidateOrder])];
  const conflicts = [];
  const moves = [];
  const insertions = [];
  const deletions = [];
  const unknowns = [...new Set([...baseParsed.ambiguous, ...currentParsed.ambiguous, ...candidateParsed.ambiguous])].sort().map(identity => ({
    code: 'ambiguous-heading-identity',
    identity,
    reason: 'Duplicate headings use occurrence-based identity. Add explicit {#id} anchors for stable moves.'
  }));
  const selected = new Map();
  const currentMoved = new Set();
  const candidateMoved = new Set();
  for (const key of order) {
    if (options.signal?.aborted) return interruptedMerge(current, 'The candidate merge was interrupted while comparing sections.');
    const baseSection = baseSections.get(key);
    const currentSection = currentSections.get(key);
    const candidateSection = candidateSections.get(key);
    const basePosition = comparablePosition(baseParsed, key, referenceKeys);
    const currentPosition = comparablePosition(currentParsed, key, referenceKeys);
    const candidatePosition = comparablePosition(candidateParsed, key, referenceKeys);
    if (baseSection && currentSection && !positionEqual(basePosition, currentPosition)) currentMoved.add(key);
    if (baseSection && candidateSection && !positionEqual(basePosition, candidatePosition)) candidateMoved.add(key);
    if (baseSection && (!currentSection || !candidateSection)) deletions.push({ section: key, current: Boolean(currentSection), candidate: Boolean(candidateSection) });
    if (!baseSection && (currentSection || candidateSection)) insertions.push({ section: key, current: Boolean(currentSection), candidate: Boolean(candidateSection) });
    if (baseSection && currentSection && candidateSection && (!positionEqual(currentPosition, candidatePosition)) && (currentMoved.has(key) || candidateMoved.has(key))) {
      const currentDidMove = !positionEqual(basePosition, currentPosition);
      const candidateDidMove = !positionEqual(basePosition, candidatePosition);
      if (currentDidMove && candidateDidMove && !positionEqual(currentPosition, candidatePosition)) {
        conflicts.push({ section: key, reason: 'move', base: basePosition, current: currentPosition, candidate: candidatePosition });
      }
      moves.push({ section: key, base: basePosition, current: currentPosition, candidate: candidatePosition, changedBy: [currentDidMove ? 'current' : null, candidateDidMove ? 'candidate' : null].filter(Boolean), conflict: currentDidMove && candidateDidMove && !positionEqual(currentPosition, candidatePosition) });
    }
    const baseText = baseSection?.lines.join('\n') ?? null;
    const currentText = currentSection?.lines.join('\n') ?? null;
    const candidateText = candidateSection?.lines.join('\n') ?? null;
    const currentChanged = Boolean(currentSection) !== Boolean(baseSection) || currentText !== baseText;
    const candidateChanged = Boolean(candidateSection) !== Boolean(baseSection) || candidateText !== baseText;
    if (!baseSection && currentSection && candidateSection && currentText !== candidateText) {
      conflicts.push({ section: key, reason: 'insertion', base: null, current: currentText, candidate: candidateText });
      selected.set(key, currentText);
    } else if (baseSection && currentChanged && candidateChanged && currentText !== candidateText) {
      conflicts.push({ section: key, reason: !currentSection || !candidateSection ? 'deletion' : 'content', base: baseText, current: currentText, candidate: candidateText });
      selected.set(key, currentSection ? currentText : null);
    } else if (candidateChanged && !currentChanged) {
      selected.set(key, candidateText);
    } else {
      selected.set(key, currentSection ? currentText : candidateSection ? candidateText : null);
    }
  }
  const moveKeys = new Set([...currentMoved, ...candidateMoved]);
  const preferredOrder = candidateMoved.size && !currentMoved.size ? candidateOrder : currentOrder;
  const finalOrder = [...new Set([...preferredOrder, ...baseOrder, ...candidateOrder])].filter(key => selected.has(key));
  for (const key of moveKeys) {
    if (!moves.some(move => move.section === key)) {
    const basePosition = comparablePosition(baseParsed, key, referenceKeys);
    const currentPosition = comparablePosition(currentParsed, key, referenceKeys);
    const candidatePosition = comparablePosition(candidateParsed, key, referenceKeys);
    const currentDidMove = currentMoved.has(key);
    const candidateDidMove = candidateMoved.has(key);
    moves.push({ section: key, base: basePosition, current: currentPosition, candidate: candidatePosition, changedBy: [currentDidMove ? 'current' : null, candidateDidMove ? 'candidate' : null].filter(Boolean), conflict: currentDidMove && candidateDidMove && !positionEqual(currentPosition, candidatePosition) });
    }
  }
  moves.sort((a, b) => a.section.localeCompare(b.section));
  conflicts.sort((a, b) => a.section.localeCompare(b.section) || a.reason.localeCompare(b.reason));
  insertions.sort((a, b) => a.section.localeCompare(b.section));
  deletions.sort((a, b) => a.section.localeCompare(b.section));
  return {
    schemaVersion: 2,
    merged: renderSections(finalOrder, selected),
    conflicts,
    moves,
    insertions,
    deletions,
    identity: {
      scheme: 'explicit heading id or normalized heading identity with occurrence',
      ambiguous: [...new Set([...baseParsed.ambiguous, ...currentParsed.ambiguous, ...candidateParsed.ambiguous])].sort()
    },
    unknowns,
    clean: conflicts.length === 0 && unknowns.length === 0,
    interrupted: false,
    basis: 'baseline-preserving three-way merge with explicit heading identity, move reporting and current-content conflict selection'
  };
}

function recordList(value, key = 'path') {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];
  return Object.entries(value).map(([name, record]) => isObject(record) ? { ...record, [key]: record[key] ?? name } : { [key]: name });
}

function referenceItems(value) {
  if (Array.isArray(value)) return value.flatMap(referenceItems);
  if (isObject(value)) {
    if (['path', 'file', 'target', 'id', 'name', 'symbol', 'interface'].some(key => has(value, key))) return [value];
    return Object.entries(value).flatMap(([key, entry]) => entry === true ? [key] : entry === false || entry == null ? [] : isObject(entry) ? [{ ...entry, id: entry.id ?? key }] : [{ id: key, target: entry }]);
  }
  return value == null ? [] : [value];
}

function referenceTarget(reference, files, interfaces) {
  const type = isObject(reference) ? String(reference.kind ?? reference.type ?? '').toLowerCase() : '';
  const raw = isObject(reference) ? reference.path ?? reference.file ?? reference.target ?? reference.interface ?? reference.id ?? reference.name ?? reference.symbol : reference;
  if (typeof raw !== 'string' || !raw.trim() || (isObject(reference) && (reference.unknown === true || reference.dynamic === true || reference.resolved === false))) return null;
  const value = raw.trim();
  if (type.includes('interface') || value.startsWith('interface:')) {
    const name = value.replace(/^interface:/, '');
    return interfaces.get(name) || interfaces.get(value) || null;
  }
  if (files.has(value)) return value;
  if (interfaces.has(value)) return interfaces.get(value);
  return null;
}

function dependencyFields(record) {
  return ['dependencies', 'imports', 'requires', 'dependsOn', 'includes', 'references', 'uses', 'interfaceDependencies', 'interfaceUses', 'usesInterfaces', 'calls', 'extends', 'implements'].filter(field => has(record, field));
}

function dynamicReason(record) {
  if (record.dynamic === true || record.dynamicDependencies === true || record.dynamicImports === true || record.dependenciesUnknown === true || record.runtimeDependenciesUnknown === true || record.dependencyComplete === false || record.exhaustive === false || record.complete === false) return 'Dependency records declare dynamic or incomplete resolution.';
  return null;
}

export function buildDependencyGraph(input = {}, interfacesInput = [], optionsInput = {}) {
  const positionalOptions = Array.isArray(optionsInput) ? {} : optionsInput;
  const options = isObject(input) && !Array.isArray(input) ? (isObject(input.options) ? input.options : positionalOptions) : (isObject(positionalOptions) ? positionalOptions : {});
  const filesInput = Array.isArray(input) ? input : input.files ?? input.fileRecords ?? [];
  const interfaceRecordsInput = Array.isArray(input) ? (Array.isArray(interfacesInput) ? interfacesInput : []) : input.interfaces ?? input.interfaceRecords ?? [];
  const changesInput = Array.isArray(input) ? (Array.isArray(optionsInput) ? optionsInput : options.changes ?? options.changed ?? []) : input.changes ?? input.changed ?? options.changes ?? options.changed ?? [];
  const fileRecords = recordList(filesInput);
  const declaredInterfaces = [];
  for (const record of fileRecords) {
    if (!isObject(record)) continue;
    const filePath = String(record.path ?? record.id ?? '').trim();
    for (const field of ['interfaces', 'exports', 'providedInterfaces']) {
      if (!filePath || !has(record, field)) continue;
      for (const reference of referenceItems(record[field])) {
        const name = String(isObject(reference) ? reference.id ?? reference.name ?? reference.symbol ?? reference.interface ?? '' : reference).trim().replace(/^interface:/, '');
        if (name) declaredInterfaces.push({ id: name, path: filePath, complete: true });
      }
    }
  }
  const suppliedInterfaces = recordList(interfaceRecordsInput, 'id');
  const suppliedNames = new Set(suppliedInterfaces.map(record => String(record.id ?? record.name ?? record.symbol ?? '').trim().replace(/^interface:/, '')));
  const interfaceRecords = [...suppliedInterfaces, ...declaredInterfaces.filter(record => !suppliedNames.has(record.id))];
  const nodes = [];
  const nodeMap = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const unknowns = [];
  const unknownKeys = new Set();
  const filePaths = new Set();
  const interfaces = new Map();
  const addUnknown = (code, details = {}) => {
    const unknown = { code, ...details };
    const key = JSON.stringify(unknown);
    if (!unknownKeys.has(key)) {
      unknownKeys.add(key);
      unknowns.push(unknown);
    }
  };
  const addNode = (node) => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, node);
      nodes.push(node);
    }
    return nodeMap.get(node.id);
  };
  for (const record of fileRecords) {
    const filePath = isObject(record) ? String(record.path ?? record.id ?? '').trim() : '';
    if (!filePath) {
      addUnknown('invalid-file-record', { record });
      continue;
    }
    if (filePaths.has(filePath)) addUnknown('duplicate-file-record', { path: filePath });
    filePaths.add(filePath);
    addNode({ id: filePath, kind: 'file', path: filePath, status: record.status ?? 'present' });
  }
  for (const record of interfaceRecords) {
    const name = isObject(record) ? String(record.id ?? record.name ?? record.symbol ?? '').trim().replace(/^interface:/, '') : '';
    if (!name) {
      addUnknown('invalid-interface-record', { record });
      continue;
    }
    const id = `interface:${name}`;
    if (interfaces.has(name)) addUnknown('duplicate-interface-record', { id });
    interfaces.set(name, id);
    interfaces.set(id, id);
    addNode({ id, kind: 'interface', name, path: record.path ?? record.file ?? null, status: record.status ?? 'present' });
  }
  const addEdge = (from, to, kind, source = null) => {
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind, known: true, source });
  };
  const addDependencyReferences = (from, value, kind, source) => {
    for (const reference of referenceItems(value)) {
      const target = referenceTarget(reference, filePaths, interfaces);
      if (!target) {
        addUnknown('unresolved-dependency', { source, field: kind, reference });
        continue;
      }
      addEdge(from, target, kind, source);
    }
  };
  for (const record of fileRecords) {
    if (!isObject(record)) continue;
    const filePath = String(record.path ?? record.id ?? '').trim();
    if (!filePaths.has(filePath)) continue;
    const fields = dependencyFields(record);
    const dynamic = dynamicReason(record);
    if (dynamic) addUnknown('dynamic-dependency', { source: filePath, reason: dynamic });
    if (record.config === true || String(record.kind ?? record.type ?? '').toLowerCase() === 'config') addUnknown('configuration-dependency', { source: filePath, reason: 'Configuration records can alter runtime dependencies outside explicit static edges.' });
    if (!fields.length && record.dependencyComplete !== true && record.complete !== true && !dynamic) addUnknown('missing-dependency-record', { source: filePath, reason: 'No explicit dependency fields or completeness declaration were supplied.' });
    for (const field of fields) addDependencyReferences(filePath, record[field], field, filePath);
    for (const field of ['interfaces', 'exports', 'providedInterfaces']) {
      if (!has(record, field)) continue;
      for (const reference of referenceItems(record[field])) {
        const target = referenceTarget({ ...(isObject(reference) ? reference : { id: reference }), kind: 'interface' }, filePaths, interfaces);
        if (!target) addUnknown('unresolved-interface', { source: filePath, field, reference });
        else addEdge(filePath, target, 'defines', filePath);
      }
    }
  }
  for (const record of interfaceRecords) {
    if (!isObject(record)) continue;
    const name = String(record.id ?? record.name ?? record.symbol ?? '').trim().replace(/^interface:/, '');
    const interfaceId = interfaces.get(name);
    if (!interfaceId) continue;
    const owner = String(record.path ?? record.file ?? record.owner ?? '').trim();
    if (owner) {
      if (filePaths.has(owner)) addEdge(owner, interfaceId, 'defines', owner);
      else addUnknown('unresolved-interface-owner', { interface: interfaceId, owner });
    }
    for (const field of ['providers', 'owners', 'implementations', 'definedBy']) {
      if (!has(record, field)) continue;
      for (const reference of referenceItems(record[field])) {
        const target = referenceTarget(reference, filePaths, interfaces);
        if (!target || !filePaths.has(target)) addUnknown('unresolved-interface-provider', { interface: interfaceId, field, reference });
        else addEdge(target, interfaceId, 'defines', interfaceId);
      }
    }
    const fields = dependencyFields(record);
    for (const field of fields) addDependencyReferences(interfaceId, record[field], field, interfaceId);
    for (const field of ['consumers', 'dependents', 'usedBy', 'callers']) {
      if (!has(record, field)) continue;
      for (const reference of referenceItems(record[field])) {
        const target = referenceTarget(reference, filePaths, interfaces);
        if (!target) addUnknown('unresolved-interface-consumer', { interface: interfaceId, field, reference });
        else addEdge(target, interfaceId, field, interfaceId);
      }
    }
    if (!fields.length && !['consumers', 'dependents', 'usedBy', 'callers', 'providers', 'owners', 'implementations', 'definedBy'].some(field => has(record, field)) && record.complete !== true)
      addUnknown('missing-interface-relationships', { interface: interfaceId, reason: 'Interface record has no dependency, provider, consumer or completeness declaration.' });
    const dynamic = dynamicReason(record);
    if (dynamic) addUnknown('dynamic-dependency', { source: interfaceId, reason: dynamic });
  }
  const implicitChanges = [...fileRecords, ...interfaceRecords].flatMap(record => {
    if (!isObject(record)) return [];
    const status = record.status ?? record.change;
    if (!['added', 'changed', 'modified', 'deleted', 'removed'].includes(String(status).toLowerCase())) return [];
    const isInterface = interfaceRecords.includes(record);
    const value = String(record.path ?? record.file ?? record.id ?? record.name ?? '').trim();
    return value ? [{ path: isInterface ? `interface:${value.replace(/^interface:/, '')}` : value, kind: isInterface ? 'interface' : 'file', status }] : [];
  });
  const changeEntries = [...referenceItems(changesInput), ...implicitChanges];
  const seenChanges = new Set();
  const changes = [];
  for (const entry of changeEntries) {
    const raw = isObject(entry) ? entry.path ?? entry.file ?? entry.target ?? entry.id ?? entry.name : entry;
    if (typeof raw !== 'string' || !raw.trim()) {
      addUnknown('invalid-change-record', { record: entry });
      continue;
    }
    const value = raw.trim();
    const type = isObject(entry) ? String(entry.kind ?? entry.type ?? '').toLowerCase() : '';
    const id = type.includes('interface') || value.startsWith('interface:') ? interfaces.get(value.replace(/^interface:/, '')) || `interface:${value.replace(/^interface:/, '')}` : value;
    const status = isObject(entry) ? entry.status ?? entry.change ?? 'changed' : 'changed';
    const changeKey = `${id}\u0000${status}`;
    if (seenChanges.has(changeKey)) continue;
    seenChanges.add(changeKey);
    changes.push({ id, status });
    if (!nodeMap.has(id)) {
      addNode({ id, kind: id.startsWith('interface:') ? 'interface' : 'file', path: id.startsWith('interface:') ? null : id, status });
      addUnknown('change-record-missing', { id, status, reason: 'Changed node is absent from the supplied file/interface records.' });
    }
    if (isObject(entry) && (entry.config === true || type === 'config' || /\.(?:json|ya?ml|toml|ini|env)$/iu.test(value))) addUnknown('config-change', { id, reason: 'Configuration changes may alter runtime dependencies not present in static records.' });
  }
  const impactEdges = [];
  const impactKeys = new Set();
  const addImpactEdge = (from, to, kind) => {
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (!impactKeys.has(key)) {
      impactKeys.add(key);
      impactEdges.push({ from, to, kind });
    }
  };
  for (const edge of edges) {
    if (edge.kind === 'defines') addImpactEdge(edge.from, edge.to, 'defines');
    else addImpactEdge(edge.to, edge.from, edge.kind);
  }
  const changed = sortedUnique(changes.map(change => change.id));
  const impactedSet = new Set(changed);
  const queue = [...changed];
  const outgoing = new Map();
  for (const edge of impactEdges) {
    const list = outgoing.get(edge.from) || [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  while (queue.length) {
    const current = queue.shift();
    for (const next of sortedUnique(outgoing.get(current) || [])) {
      if (!impactedSet.has(next)) {
        impactedSet.add(next);
        queue.push(next);
      }
    }
  }
  const fallback = unknowns.length && changed.length ? {
    mode: 'all-files',
    reason: 'Dependency graph is incomplete. Revalidate every file because unaffected status cannot be proven.'
  } : null;
  if (fallback) {
    for (const node of nodes) impactedSet.add(node.id);
  }
  const impacted = sortedUnique([...impactedSet]);
  const fileIds = sortedUnique(nodes.filter(node => node.kind === 'file').map(node => node.id));
  const dependents = {};
  for (const edge of impactEdges) (dependents[edge.from] ||= []).push(edge.to);
  for (const ids of Object.values(dependents)) ids.sort((a, b) => a.localeCompare(b));
  const dependencies = edges.filter(edge => edge.kind !== 'defines').map(edge => ({ dependent: edge.from, dependency: edge.to, kind: edge.kind })).sort((a, b) => a.dependent.localeCompare(b.dependent) || a.dependency.localeCompare(b.dependency) || a.kind.localeCompare(b.kind));
  const complete = unknowns.length === 0;
  const unaffected = fallback ? [] : fileIds.filter(id => !impactedSet.has(id));
  return {
    schemaVersion: 2,
    kind: 'dependency-impact-graph',
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind)),
    impactEdges: impactEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind)),
    dependencies,
    dependents,
    changes: changes.sort((a, b) => a.id.localeCompare(b.id) || String(a.status).localeCompare(String(b.status))),
    changed,
    impacted,
    affected: impacted,
    unaffected,
    impact: { changed, impacted, affected: impacted, unaffected, complete, fallback },
    complete,
    unknowns: unknowns.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    fallback,
    basis: 'explicit file and interface records with dependency-to-dependent impact traversal; unresolved, dynamic and configuration relationships fall back conservatively'
  };
}

export const buildImpactGraph = buildDependencyGraph;
export const buildDependencyImpactGraph = buildDependencyGraph;
export const constructDependencyGraph = buildDependencyGraph;

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that']);
function tokens(text) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter(token => !STOP_WORDS.has(token)));
}

function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) throw new Error('Search needs a documents array.');
  const seen = new Set();
  return documents.map((document, index) => {
    if (!isObject(document) || typeof document.path !== 'string' || !document.path.trim()) throw new Error(`Search document ${index} needs a path.`);
    if (seen.has(document.path)) throw new Error(`Search document path is duplicated: ${document.path}`);
    seen.add(document.path);
    return { path: document.path, text: typeof document.text === 'string' ? document.text : '' };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function corpusDigest(documents) {
  return hash(documents.map(document => `${JSON.stringify(document.path)}:${hash(document.text)}:${Buffer.byteLength(document.text)}`).join('\n'));
}

function invalidationFor(previous, documents, digest) {
  const current = new Map(documents.map(document => [document.path, hash(document.text)]));
  const currentPaths = [...current.keys()].sort((a, b) => a.localeCompare(b));
  if (!isObject(previous) || previous.kind !== 'lexical-index' || !Array.isArray(previous.documents)) {
    return {
      schemaVersion: 1,
      basis: 'initial-build-or-invalid-previous-index',
      previousCorpusDigest: null,
      corpusDigest: digest,
      added: currentPaths,
      changed: [],
      removed: [],
      unchanged: [],
      invalidated: currentPaths,
      previousValid: previous == null
    };
  }
  const old = new Map(previous.documents.filter(document => isObject(document) && typeof document.path === 'string').map(document => [document.path, document.sha256]));
  const added = currentPaths.filter(pathName => !old.has(pathName));
  const changed = currentPaths.filter(pathName => old.has(pathName) && old.get(pathName) !== current.get(pathName));
  const unchanged = currentPaths.filter(pathName => old.has(pathName) && old.get(pathName) === current.get(pathName));
  const removed = [...old.keys()].filter(pathName => !current.has(pathName)).sort((a, b) => a.localeCompare(b));
  return {
    schemaVersion: 1,
    basis: previous.corpusDigest === digest ? 'corpus-unchanged' : 'content-addressed-document-diff',
    previousCorpusDigest: previous.corpusDigest ?? null,
    corpusDigest: digest,
    added,
    changed,
    removed,
    unchanged,
    invalidated: sortedUnique([...added, ...changed, ...removed]),
    previousValid: true
  };
}

function semanticState(options = {}) {
  if (options.semantic === true && options.measuredSemantic !== true) throw new Error('Semantic search is disabled until an explicit measured capability is supplied.');
  return {
    enabled: false,
    measured: options.measuredSemantic === true,
    reason: options.measuredSemantic === true ? 'semantic capability is not implemented by this local index' : 'semantic capability is not measured'
  };
}

export function buildLexicalIndex(documents, options = {}) {
  if (isObject(options) && options.kind === 'lexical-index') options = { previousIndex: options };
  if (!isObject(options)) options = {};
  const normalized = normalizeDocuments(documents);
  const semantic = semanticState(options);
  const digest = corpusDigest(normalized);
  const metadata = normalized.map(document => ({
    path: document.path,
    sha256: hash(document.text),
    bytes: Buffer.byteLength(document.text),
    tokens: [...tokens(`${document.path}\n${document.text}`)].sort((a, b) => a.localeCompare(b)),
    excerpt: document.text.slice(0, 512)
  }));
  const postings = {};
  for (const document of metadata) {
    for (const token of document.tokens) (postings[token] ||= []).push(document.path);
  }
  for (const paths of Object.values(postings)) paths.sort((a, b) => a.localeCompare(b));
  const invalidation = invalidationFor(options.previousIndex ?? options.previous ?? null, normalized, digest);
  const index = {
    schemaVersion: 2,
    kind: 'lexical-index',
    corpusDigest: digest,
    documents: metadata,
    postings,
    invalidation,
    semantic
  };
  index.indexDigest = hash(JSON.stringify(index));
  return index;
}

export const buildSearchIndex = buildLexicalIndex;
export const createLexicalIndex = buildLexicalIndex;
export const createSearchIndex = buildLexicalIndex;

function searchLimit(limit) {
  if (!Number.isFinite(limit)) return 20;
  return Math.max(0, Math.min(100, Math.floor(limit)));
}

export function searchIndexedDocuments(index, query, { limit = 20, semantic = false, measuredSemantic = false } = {}) {
  if (!isObject(index) || index.kind !== 'lexical-index' || !Array.isArray(index.documents) || !isObject(index.postings)) throw new Error('Search needs a valid lexical index.');
  if (typeof query !== 'string' || !query.trim()) throw new Error('Search needs documents and a nonempty query.');
  if (semantic && !(measuredSemantic || index.semantic?.measured === true)) throw new Error('Semantic search is disabled until an explicit measured capability is supplied.');
  const wanted = [...tokens(query)];
  const scores = new Map();
  for (const token of wanted) {
    for (const pathName of index.postings[token] || []) scores.set(pathName, (scores.get(pathName) || 0) + 1);
  }
  const results = index.documents.filter(document => scores.has(document.path)).map(document => ({
    path: document.path,
    score: scores.get(document.path),
    excerpt: document.excerpt,
    evidence: { path: document.path, sha256: document.sha256 }
  })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, searchLimit(limit));
  return {
    schemaVersion: 2,
    kind: 'lexical-search',
    query,
    results,
    indexed: true,
    corpusDigest: index.corpusDigest,
    indexDigest: index.indexDigest,
    invalidation: index.invalidation,
    semantic: index.semantic ?? { enabled: false, measured: false, reason: 'semantic capability is not measured' },
    index,
    fallback: 'repository lexical search; deterministic indexed path; not embedding or semantic proof'
  };
}

export const searchDocumentsIndexed = searchIndexedDocuments;

export function searchDocuments(documents, query, options = {}) {
  if (!isObject(options)) options = {};
  if (isObject(documents) && documents.kind === 'lexical-index') return searchIndexedDocuments(documents, query, options);
  const index = buildLexicalIndex(documents, {
    previousIndex: options.index ?? options.previousIndex ?? null,
    semantic: options.semantic,
    measuredSemantic: options.measuredSemantic
  });
  return searchIndexedDocuments(index, query, { limit: options.limit, semantic: options.semantic === true, measuredSemantic: options.measuredSemantic === true });
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
