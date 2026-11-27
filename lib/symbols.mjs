import path from 'node:path';
import { inventoryTreeSitterSymbols } from './tree-sitter-symbols.mjs';

const JS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY = new Set(['.py', '.pyw']);
const ADAPTERS = Object.freeze({
  'javascript-family': Object.freeze({ id: 'javascript-family', version: 1 }),
  python: Object.freeze({ id: 'python', version: 1 }),
  unknown: Object.freeze({ id: 'unknown', version: 1 })
});

function range(text, index, length) {
  const before = text.slice(0, index);
  const startLine = before ? before.split('\n').length : 1;
  return { startLine, endLine: startLine + text.slice(index, index + length).split('\n').length - 1 };
}

function decoratorsBefore(text, index) {
  const lines = text.slice(0, index).split('\n');
  const decorators = [];
  for (let line = lines.length - 2; line >= 0; line -= 1) {
    const value = lines[line].trim();
    if (!value) break;
    const match = value.match(/^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/);
    if (!match) break;
    decorators.unshift(match[1]);
  }
  return decorators;
}

function declaration(name, kind, text, index, length, { exported = false, privateSymbol = !exported, indent, bases = [] } = {}) {
  const symbol = {
    id: `${kind}:${name}`,
    name,
    kind,
    ...range(text, index, length)
  };
  if (indent !== undefined) symbol.indent = indent;
  symbol.exported = exported;
  symbol.private = privateSymbol;
  symbol.visibility = exported ? 'exported' : privateSymbol ? 'private' : 'public';
  symbol.decorators = decoratorsBefore(text, index);
  symbol.bases = bases;
  symbol.extends = bases.length === 1 ? bases[0] : bases.length ? bases : null;
  symbol.overloadLike = false;
  symbol.overloadGroup = null;
  symbol.overloadIndex = null;
  return symbol;
}

function jsBases(text, index) {
  const end = text.indexOf('\n', index);
  const line = text.slice(index, end === -1 ? text.length : end);
  const heritage = line.match(/\bextends\s+([A-Za-z_$][\w$]*(?:\s*<[^>\n{}]+>)?(?:\.[A-Za-z_$][\w$]*)?)/);
  return heritage ? [heritage[1]] : [];
}

function exportedJavaScriptNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const entry of match[1].split(',')) {
      const local = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.add(local);
    }
  }
  return names;
}

function exportedPythonNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/\b__all__\s*=\s*[\[(]([\s\S]*?)[\])]/g)) {
    for (const name of match[1].matchAll(/['"]([A-Za-z_]\w*)['"]/g)) names.add(name[1]);
  }
  return names;
}

function applyExportedNames(symbols, names) {
  for (const symbol of symbols) {
    if (!names.has(symbol.name)) continue;
    symbol.exported = true;
    symbol.private = false;
    symbol.visibility = 'exported';
  }
}

function overloadDecorator(decorators) {
  return decorators.some(name => name === 'overload' || name.endsWith('.overload'));
}

function markOverloads(symbols) {
  const groups = new Map();
  for (const symbol of symbols) {
    if (!['function', 'variable-function'].includes(symbol.kind)) continue;
    const key = `${symbol.kind}:${symbol.name}`;
    const group = groups.get(key) ?? [];
    group.push(symbol);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    if (group.length < 2 && !overloadDecorator(group[0].decorators)) continue;
    group.forEach((symbol, index) => {
      symbol.overloadLike = true;
      symbol.overloadGroup = key;
      symbol.overloadIndex = index + 1;
    });
  }
}

function declarationCoverage(symbols) {
  return {
    declarations: symbols.length,
    exported: symbols.filter(symbol => symbol.exported).length,
    private: symbols.filter(symbol => symbol.private).length,
    decorated: symbols.filter(symbol => symbol.decorators.length > 0).length,
    inherited: symbols.filter(symbol => symbol.bases.length > 0).length,
    overloadLike: symbols.filter(symbol => symbol.overloadLike).length,
    exhaustive: false
  };
}

function adapter(language) {
  return { ...ADAPTERS[language] ?? ADAPTERS.unknown };
}

function finish(language, basis, symbols, limitations) {
  markOverloads(symbols);
  return {
    language,
    basis,
    exhaustive: false,
    symbols,
    limitations,
    adapter: adapter(language),
    coverage: declarationCoverage(symbols)
  };
}

function jsSymbols(text) {
  const symbols = [];
  const patterns = [
    {
      kind: 'function',
      expression: /(?<![\w$])(?<exportPrefix>export\s+(?:default\s+)?|)(?:declare\s+)?(?:async\s+)?function\s+\*?\s*(?<name>[A-Za-z_$][\w$]*)/g
    },
    {
      kind: 'class',
      expression: /(?<![\w$])(?<exportPrefix>export\s+(?:default\s+)?|)(?:declare\s+)?(?:abstract\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)/g
    },
    {
      kind: 'variable-function',
      expression: /(?<![\w$])(?<exportPrefix>export\s+(?:default\s+)?|)(?:declare\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^;\n]*\)|[A-Za-z_$][\w$]*)\s*=>/g
    }
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.expression)) {
      const name = match.groups.name;
      const exported = Boolean(match.groups.exportPrefix.trim());
      symbols.push(declaration(name, pattern.kind, text, match.index, match[0].length, {
        exported,
        privateSymbol: !exported,
        bases: pattern.kind === 'class' ? jsBases(text, match.index) : []
      }));
    }
  }
  applyExportedNames(symbols, exportedJavaScriptNames(text));
  return symbols.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}

function pythonBases(text, index) {
  const end = text.indexOf('\n', index);
  const line = text.slice(index, end === -1 ? text.length : end);
  const match = line.match(/\bclass\s+[A-Za-z_]\w*\s*(?:\(([^)]*)\))?/);
  return match?.[1] ? match[1].split(',').map(base => base.trim()).filter(Boolean) : [];
}

function pythonSymbols(text) {
  const symbols = [];
  const exportedNames = exportedPythonNames(text);
  for (const match of text.matchAll(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)) {
    const name = match[2];
    const privateSymbol = name.startsWith('_');
    symbols.push(declaration(name, 'function', text, match.index, match[0].length, {
      exported: exportedNames.size ? exportedNames.has(name) : !privateSymbol,
      privateSymbol,
      indent: match[1].length
    }));
  }
  for (const match of text.matchAll(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(|:)/gm)) {
    const name = match[2];
    const privateSymbol = name.startsWith('_');
    symbols.push(declaration(name, 'class', text, match.index, match[0].length, {
      exported: exportedNames.size ? exportedNames.has(name) : !privateSymbol,
      privateSymbol,
      indent: match[1].length,
      bases: pythonBases(text, match.index)
    }));
  }
  return symbols.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}

export function inventorySymbols(filePath, text) {
  const extension = path.extname(filePath).toLowerCase();
  const parsed = inventoryTreeSitterSymbols(filePath, text);
  if (parsed) return parsed;
  if (JS.has(extension)) return finish('javascript-family', 'bounded lexical declaration scan', jsSymbols(text), [
    'Dynamic dispatch, re-exports, aliases, generated code, reflection and nested scope semantics are not resolved.',
    'Decorators and inheritance are recorded only from direct lexical declarations; decorator effects, mixins, interfaces and runtime prototype changes are not resolved.',
    'Overload-like declarations are heuristic duplicate names or overload decorators; signatures and implementation relationships are not resolved.'
  ]);
  if (PY.has(extension)) return finish('python', 'bounded declaration scan', pythonSymbols(text), [
    'Decorators, dynamic attributes, imports, generated code and runtime registration are not resolved.',
    'Inheritance records direct class bases only; metaclasses and runtime mutation are not resolved.',
    'Overload-like declarations are heuristic duplicate names or overload decorators; signatures and dispatch relationships are not resolved.'
  ]);
  return finish('unknown', 'unsupported', [], [`No symbol adapter is declared for ${extension || 'extensionless'} files.`]);
}
