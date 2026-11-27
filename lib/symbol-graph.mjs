import path from 'node:path';
import { inventorySymbols } from './symbols.mjs';

const JS_EXTENSIONS = Object.freeze(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY_EXTENSIONS = Object.freeze(['.py', '.pyw']);
const GRAPH_LIMITATIONS = Object.freeze([
  'Module resolution covers relative JavaScript and TypeScript paths and local Python modules only; package metadata, aliases and re-export closure are not resolved.',
  'Call references resolve only statically unambiguous local declarations and direct imported bindings; dynamic dispatch, type checking and complete call graphs remain unresolved.',
  'The graph is bounded to supplied repository-relative file snapshots; generated code and runtime behavior are not inspected.'
]);

function compareStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function unique(values) {
  return [...new Set(values)];
}

function repositoryPath(value) {
  const normalized = path.posix.normalize(String(value).replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null;
  return normalized.replace(/^(?:\.\/)+/, '');
}

function validCandidate(value) {
  return repositoryPath(value);
}

function isRelativeSpecifier(source) {
  return source === '.' || source === '..' || source.startsWith('./') || source.startsWith('../');
}

function extensionOf(value) {
  return path.posix.extname(value).toLowerCase();
}

function addCandidate(candidates, value) {
  const candidate = validCandidate(value);
  if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
}

function javascriptCandidates(importerPath, source) {
  if (!isRelativeSpecifier(source)) return [];
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), source));
  if (!validCandidate(base)) return [];
  const candidates = [];
  const extension = extensionOf(base);
  addCandidate(candidates, base);
  if (JS_EXTENSIONS.includes(extension)) {
    const stem = base.slice(0, -extension.length);
    for (const variant of JS_EXTENSIONS) addCandidate(candidates, `${stem}${variant}`);
  } else {
    for (const variant of JS_EXTENSIONS) addCandidate(candidates, `${base}${variant}`);
  }
  for (const variant of JS_EXTENSIONS) addCandidate(candidates, path.posix.join(base, `index${variant}`));
  return candidates;
}

function pythonModuleParts(importerPath, source) {
  const match = /^(\.*)(.*)$/.exec(source);
  if (!match) return null;
  const level = match[1].length;
  let base = level ? path.posix.dirname(importerPath) : '.';
  for (let index = 1; index < level; index += 1) base = path.posix.dirname(base);
  const moduleName = match[2];
  const modulePath = moduleName ? moduleName.split('.').join('/') : '';
  const moduleBase = path.posix.normalize(path.posix.join(base, modulePath));
  if (!validCandidate(moduleBase)) return null;
  return { moduleBase, moduleName };
}

function pythonCandidates(importerPath, record) {
  const parts = pythonModuleParts(importerPath, String(record.source ?? ''));
  if (!parts) return [];
  const candidates = [];
  const addModuleCandidates = (moduleBase) => {
    addCandidate(candidates, `${moduleBase}.py`);
    addCandidate(candidates, `${moduleBase}.pyw`);
    addCandidate(candidates, path.posix.join(moduleBase, '__init__.py'));
    addCandidate(candidates, path.posix.join(moduleBase, '__init__.pyw'));
  };
  addModuleCandidates(parts.moduleBase);
  if (record.kind === 'named' && record.target && record.target !== '*') {
    const childBase = path.posix.join(parts.moduleBase, String(record.target).split('.').join('/'));
    addModuleCandidates(childBase);
  }
  return candidates;
}

function symbolId(symbol) {
  return symbol.id ?? symbol.qualifiedId ?? null;
}

function topLevelSymbols(file) {
  return file.inventory.symbols.filter(symbol => !symbol.owner);
}

function defaultExportNames(file) {
  const names = [];
  for (const match of String(file.text).matchAll(/\bexport\s+default\s+(?:(?:async\s+)?(?:function|class)\s*\*?\s*)?([A-Za-z_$][\w$]*)/g)) {
    if (match[1]) names.push(match[1]);
  }
  for (const match of String(file.text).matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const entry of match[1].split(',')) {
      const parts = entry.trim().split(/\s+as\s+/);
      if (parts.at(-1) === 'default' && /^[A-Za-z_$][\w$]*$/.test(parts[0])) names.push(parts[0]);
    }
  }
  return unique(names);
}

function symbolsForImport(file, record) {
  const symbols = topLevelSymbols(file);
  if (record.kind === 'side-effect' || record.kind === 'module') return [];
  if (record.target === '*') return symbols.filter(symbol => symbol.exported).map(symbolId).filter(Boolean);
  if (record.target === 'default') {
    const names = defaultExportNames(file);
    const matches = names.flatMap(name => symbols.filter(symbol => symbol.name === name));
    if (matches.length) return unique(matches.map(symbolId).filter(Boolean));
    const exported = symbols.filter(symbol => symbol.exported);
    return exported.length === 1 ? [symbolId(exported[0])].filter(Boolean) : [];
  }
  return symbols.filter(symbol => symbol.name === record.target).map(symbolId).filter(Boolean);
}

function importNeedsSymbol(record) {
  return !['side-effect', 'module'].includes(record.kind) && record.target !== '*';
}

function resolveImport(file, record, filesByPath) {
  const source = String(record.source ?? '');
  const isJavaScript = file.inventory.language === 'javascript-family';
  const isPython = file.inventory.language === 'python';
  let candidates = [];
  if (isJavaScript) {
    if (!isRelativeSpecifier(source)) return { reason: 'Third-party, package and aliased JavaScript imports are not resolved.' };
    candidates = javascriptCandidates(file.path, source);
  } else if (isPython) {
    candidates = pythonCandidates(file.path, record);
  } else {
    return { reason: 'This file has no import-resolution adapter.' };
  }
  let foundPath = null;
  for (const candidate of candidates) {
    const targetFile = filesByPath.get(candidate);
    if (!targetFile) continue;
    if (!foundPath) foundPath = candidate;
    const resolvedSymbols = symbolsForImport(targetFile, record);
    const exact = !importNeedsSymbol(record) || resolvedSymbols.length > 0 || record.target === 'default';
    if (exact) return { resolvedPath: candidate, resolvedSymbols, targetFile };
  }
  if (foundPath) {
    return {
      reason: `Local import target ${JSON.stringify(record.target ?? '<module>')} has no exact declaration in the supplied file.`,
      foundPath
    };
  }
  if (isPython && source.startsWith('.')) return { reason: 'Relative Python import target is not present in the supplied files.' };
  if (isPython) return { reason: 'Python import is third-party or outside the supplied local module paths.' };
  return { reason: 'Relative JavaScript or TypeScript import target is not present in the supplied files.' };
}

function importBinding(record) {
  if (record.alias) return record.alias;
  if (record.kind === 'module') return record.target?.split('.', 1)[0] || null;
  if (record.kind === 'named' || record.kind === 'type' || record.kind === 'default') return record.target;
  return null;
}

function addUnresolved(unresolved, seen, entry) {
  const key = JSON.stringify(entry);
  if (seen.has(key)) return;
  seen.add(key);
  unresolved.push(entry);
}

function unresolvedReasonFor(file, reference) {
  return file.inventory.unresolved.find(entry => entry.kind === reference.kind && entry.name === reference.to)?.reason
    || 'The reference could not be resolved from the supplied syntax snapshot.';
}

function bindingMap(entries) {
  const bindings = new Map();
  for (const entry of entries) {
    const binding = importBinding(entry.record);
    if (!binding) continue;
    const records = bindings.get(binding) || [];
    records.push(entry);
    bindings.set(binding, records);
  }
  return bindings;
}

function publicFile(file) {
  return { path: file.path, ...file.inventory };
}

export function buildSymbolGraph(files) {
  if (!Array.isArray(files)) throw new TypeError('buildSymbolGraph expects an array of { path, text } files.');
  const parsedFiles = files.map(file => {
    if (!file || typeof file.path !== 'string' || typeof file.text !== 'string') {
      throw new TypeError('buildSymbolGraph files must contain string path and text fields.');
    }
    const filePath = repositoryPath(file.path);
    if (!filePath) throw new TypeError(`Invalid repository-relative file path: ${file.path}`);
    return { path: filePath, text: file.text, inventory: inventorySymbols(filePath, file.text) };
  }).sort((left, right) => compareStrings(left.path, right.path));

  const filesByPath = new Map();
  for (const file of parsedFiles) {
    if (filesByPath.has(file.path)) throw new TypeError(`Duplicate repository file path: ${file.path}`);
    filesByPath.set(file.path, file);
  }

  const importEntries = [];
  const importsByPath = new Map();
  const unresolved = [];
  const unresolvedKeys = new Set();
  const limitations = [...GRAPH_LIMITATIONS];

  for (const file of parsedFiles) {
    const entries = [];
    for (const rawImport of file.inventory.imports) {
      const resolution = resolveImport(file, rawImport, filesByPath);
      const record = { path: file.path, ...rawImport };
      const entry = { file, record, resolution };
      if (resolution.resolvedPath) {
        record.resolved = true;
        record.resolvedPath = resolution.resolvedPath;
        record.resolvedSymbols = resolution.resolvedSymbols;
      } else {
        record.resolved = false;
        addUnresolved(unresolved, unresolvedKeys, {
          path: file.path,
          kind: 'import',
          name: rawImport.source,
          reason: resolution.reason
        });
      }
      entries.push(entry);
      importEntries.push(entry);
    }
    importsByPath.set(file.path, entries);
    for (const limitation of file.inventory.limitations) limitations.push(limitation);
  }

  const references = [];
  for (const file of parsedFiles) {
    const entries = importsByPath.get(file.path) || [];
    const bindings = bindingMap(entries);
    const resolvedImportedReferences = new Set();
    const unresolvedReferenceKeys = new Set();
    for (const rawReference of file.inventory.references) {
      const edge = { path: file.path, ...rawReference };
      if (!rawReference.resolved && rawReference.kind === 'call') {
        const matching = bindings.get(rawReference.to) || [];
        if (matching.length === 1) {
          const resolution = matching[0].resolution;
          if (resolution.resolvedPath && resolution.resolvedSymbols.length === 1) {
            edge.to = resolution.resolvedSymbols[0];
            edge.resolved = true;
            resolvedImportedReferences.add(`${rawReference.kind}\0${rawReference.to}`);
          } else if (resolution.resolvedPath && resolution.resolvedSymbols.length > 1) {
            const unresolvedEntry = {
              path: file.path,
              kind: rawReference.kind,
              name: rawReference.to,
              reason: 'Imported call target is ambiguous because multiple local declarations match.'
            };
            addUnresolved(unresolved, unresolvedKeys, unresolvedEntry);
            unresolvedReferenceKeys.add(`${rawReference.kind}\0${rawReference.to}`);
          }
        } else if (matching.length > 1) {
          const unresolvedEntry = {
            path: file.path,
            kind: rawReference.kind,
            name: rawReference.to,
            reason: 'Imported call target is ambiguous because multiple import bindings match.'
          };
          addUnresolved(unresolved, unresolvedKeys, unresolvedEntry);
          unresolvedReferenceKeys.add(`${rawReference.kind}\0${rawReference.to}`);
        }
      }
      references.push(edge);
    }
    for (const rawUnresolved of file.inventory.unresolved) {
      const key = `${rawUnresolved.kind}\0${rawUnresolved.name}`;
      if (resolvedImportedReferences.has(key)) continue;
      if (unresolvedReferenceKeys.has(key)) continue;
      addUnresolved(unresolved, unresolvedKeys, { path: file.path, ...rawUnresolved });
    }
  }

  return {
    schemaVersion: 1,
    files: parsedFiles.map(publicFile),
    symbols: parsedFiles.flatMap(file => file.inventory.symbols),
    imports: importEntries.map(entry => entry.record),
    references,
    unresolved,
    limitations: unique(limitations)
  };
}
