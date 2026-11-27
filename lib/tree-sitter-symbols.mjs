import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const TS = new Set(['.ts', '.tsx']);
const PY = new Set(['.py', '.pyw']);
const declarationTypes = new Set(['class_declaration', 'function_declaration', 'function_signature', 'class_definition', 'function_definition']);

function loadParser(extension) {
  try {
    const Parser = require('tree-sitter');
    if (JS.has(extension)) return { Parser, grammar: require('tree-sitter-javascript'), language: 'javascript-family' };
    if (TS.has(extension)) {
      const grammars = require('tree-sitter-typescript');
      return { Parser, grammar: extension === '.tsx' ? grammars.tsx : grammars.typescript, language: 'javascript-family' };
    }
    if (PY.has(extension)) return { Parser, grammar: require('tree-sitter-python'), language: 'python' };
  } catch {
    return null;
  }
  return null;
}

function descendants(node, predicate, result = []) {
  if (predicate(node)) result.push(node);
  for (const child of node.namedChildren || []) descendants(child, predicate, result);
  return result;
}

function nameNode(node) {
  return node.childForFieldName?.('name') || node.namedChildren?.find(child => ['identifier', 'type_identifier', 'property_identifier'].includes(child.type)) || null;
}

function exported(node, language, exportedNames) {
  if (language === 'python') return exportedNames.size ? exportedNames.has(nameNode(node)?.text) : !(nameNode(node)?.text || '').startsWith('_');
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'export_statement') return true;
    parent = parent.parent;
  }
  return false;
}

function decorators(node) {
  const found = [];
  let parent = node.parent;
  while (parent && ['decorated_definition', 'export_statement'].includes(parent.type)) {
    for (const child of parent.namedChildren || []) if (child.type === 'decorator') {
      const text = child.text.replace(/^@/, '').trim();
      if (text) found.push(text);
    }
    parent = parent.parent;
  }
  return [...new Set(found)];
}

function bases(node, source, language) {
  const firstLine = source.slice(node.startIndex, node.endIndex).split(/\r?\n/, 1)[0];
  if (language === 'python') {
    const match = /\bclass\s+[A-Za-z_]\w*\s*\(([^)]*)\)/.exec(firstLine);
    return match ? match[1].split(',').map(value => value.trim()).filter(Boolean) : [];
  }
  const result = [];
  const extendsMatch = /\bextends\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/.exec(firstLine);
  if (extendsMatch) result.push(extendsMatch[1]);
  const implementsMatch = /\bimplements\s+([^\{]+)/.exec(firstLine);
  if (implementsMatch) result.push(...implementsMatch[1].split(',').map(value => value.trim()).filter(Boolean));
  return result;
}

function isDeclaration(node) {
  if (declarationTypes.has(node.type)) return true;
  return node.type === 'variable_declarator' && node.childForFieldName?.('value')?.type === 'arrow_function';
}

function kindFor(node) {
  if (node.type === 'class_declaration' || node.type === 'class_definition') return 'class';
  if (node.type === 'variable_declarator') return 'variable-function';
  return 'function';
}

function symbolFor(node, source, language, exportedNames) {
  const name = nameNode(node)?.text;
  if (!name) return null;
  const kind = kindFor(node);
  const isPrivate = language === 'python' ? name.startsWith('_') : name.startsWith('_');
  const isExported = exported(node, language, exportedNames);
  const line = source.slice(node.startIndex, node.endIndex).split(/\r?\n/, 1)[0].trim();
  const nodeDecorators = decorators(node);
  const classBases = kind === 'class' ? bases(node, source, language) : [];
  return {
    id: `${kind}:${name}`,
    name,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: line.slice(0, 512),
    exported: isExported,
    private: isPrivate && !isExported,
    visibility: isExported ? 'exported' : isPrivate ? 'private' : 'public',
    decorators: nodeDecorators,
    bases: classBases,
    extends: classBases.length === 1 ? classBases[0] : classBases.length ? classBases : null,
    overloadLike: node.type === 'function_signature' || nodeDecorators.some(value => value === 'overload' || value.endsWith('.overload')),
    overloadGroup: null,
    overloadIndex: null
  };
}

function markOverloads(symbols) {
  const groups = new Map();
  for (const symbol of symbols) {
    if (symbol.kind !== 'function') continue;
    const group = groups.get(symbol.name) || [];
    group.push(symbol);
    groups.set(symbol.name, group);
  }
  for (const [name, group] of groups) {
    if (group.length < 2 && !group.some(symbol => symbol.overloadLike)) continue;
    group.forEach((symbol, index) => {
      symbol.overloadLike = true;
      symbol.overloadGroup = `function:${name}`;
      symbol.overloadIndex = index + 1;
    });
  }
}

export function inventoryTreeSitterSymbols(filePath, source) {
  const extension = path.extname(filePath).toLowerCase();
  const loaded = loadParser(extension);
  if (!loaded) return null;
  const parser = new loaded.Parser();
  parser.setLanguage(loaded.grammar);
  const tree = parser.parse(source);
  const exportedNames = loaded.language === 'python'
    ? new Set([...source.matchAll(/\b__all__\s*=\s*[\[(]([\s\S]*?)[\])]/g)].flatMap(match => [...match[1].matchAll(/["']([A-Za-z_]\w*)["']/g)].map(match => match[1])))
    : new Set([...source.matchAll(/\bexport\s*\{([^}]*)\}/g)].flatMap(match => match[1].split(',').map(entry => entry.trim().split(/\s+as\s+/)[0]).filter(Boolean)));
  const symbols = descendants(tree.rootNode, isDeclaration)
    .map(node => symbolFor(node, source, loaded.language, exportedNames))
    .filter(Boolean)
    .sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
  markOverloads(symbols);
  const limitations = [
    'Dynamic dispatch, re-exports, aliases, generated code, reflection and runtime registration are not resolved.',
    'The parser reports syntax structure, not semantic type resolution, call-graph completeness or runtime behavior.'
  ];
  if (tree.rootNode.hasError) limitations.push('The parser reported syntax errors; declarations are partial for this source snapshot.');
  return {
    language: loaded.language,
    basis: 'Tree-sitter concrete syntax tree declaration adapter',
    exhaustive: false,
    symbols,
    limitations,
    adapter: { id: loaded.language, version: 2, parser: 'tree-sitter', parserVersion: '0.21.1' },
    coverage: {
      declarations: symbols.length,
      exported: symbols.filter(symbol => symbol.exported).length,
      private: symbols.filter(symbol => symbol.private).length,
      decorated: symbols.filter(symbol => symbol.decorators.length > 0).length,
      inherited: symbols.filter(symbol => symbol.bases.length > 0).length,
      overloadLike: symbols.filter(symbol => symbol.overloadLike).length,
      exhaustive: false
    }
  };
}
