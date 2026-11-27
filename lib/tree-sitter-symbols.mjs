import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const TS = new Set(['.ts', '.tsx']);
const PY = new Set(['.py', '.pyw']);
const declarationTypes = new Set([
  'class_declaration',
  'function_declaration',
  'function_signature',
  'class_definition',
  'function_definition',
  'method_definition',
  'method_signature'
]);
const classTypes = new Set(['class_declaration', 'class_definition']);
const methodTypes = new Set(['method_definition', 'method_signature']);
const callTypes = new Set(['call_expression', 'optional_call_expression', 'call']);

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
  return node.childForFieldName?.('name') || node.namedChildren?.find(child => [
    'identifier',
    'type_identifier',
    'property_identifier',
    'private_property_identifier'
  ].includes(child.type)) || null;
}

function modulePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return path.posix.normalize(normalized).replace(/^(?:\.\/)+/, '') || '.';
}

function ownerNodeFor(node, language) {
  let parent = node.parent;
  while (parent) {
    if (classTypes.has(parent.type)) return parent;
    if (language === 'python' && parent.type === 'function_definition') return null;
    parent = parent.parent;
  }
  return null;
}

function exported(node, language, exportedNames, ownerNode) {
  if (ownerNode) return false;
  if (language === 'python') {
    return exportedNames.size ? exportedNames.has(nameNode(node)?.text) : !(nameNode(node)?.text || '').startsWith('_');
  }
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

function kindFor(node, language, ownerNode) {
  if (classTypes.has(node.type)) return 'class';
  if (methodTypes.has(node.type) || (language === 'python' && node.type === 'function_definition' && ownerNode)) return 'method';
  if (node.type === 'variable_declarator') return 'variable-function';
  return 'function';
}

function symbolFor(node, source, language, exportedNames) {
  const name = nameNode(node)?.text;
  if (!name) return null;
  const ownerNode = methodTypes.has(node.type) || (language === 'python' && node.type === 'function_definition')
    ? ownerNodeFor(node, language)
    : null;
  const kind = kindFor(node, language, ownerNode);
  const isPrivate = name.startsWith('_');
  const isExported = exported(node, language, exportedNames, ownerNode);
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
    overloadLike: node.type === 'function_signature' || node.type === 'method_signature' || nodeDecorators.some(value => value === 'overload' || value.endsWith('.overload')),
    overloadGroup: null,
    overloadIndex: null,
    _node: node,
    _ownerNode: ownerNode
  };
}

function finalizeSymbols(symbols, filePath) {
  const module = modulePath(filePath);
  const byNode = new Map(symbols.map(symbol => [symbol._node, symbol]));
  const finalize = symbol => {
    if (symbol._identityReady) return;
    const owner = symbol._ownerNode ? byNode.get(symbol._ownerNode) : null;
    if (owner) finalize(owner);
    const qualifiedName = owner ? `${owner._qualifiedName}.${symbol.name}` : symbol.name;
    symbol._qualifiedName = qualifiedName;
    symbol.qualifiedId = `${module}::${qualifiedName}`;
    symbol.id = `${module}:${symbol.kind}:${qualifiedName}`;
    if (owner) symbol.owner = owner.id;
    symbol._identityReady = true;
  };
  for (const symbol of symbols) finalize(symbol);
}

function markOverloads(symbols) {
  const groups = new Map();
  for (const symbol of symbols) {
    if (!['function', 'method'].includes(symbol.kind)) continue;
    const key = `${symbol.kind}:${symbol._qualifiedName || symbol.name}`;
    const group = groups.get(key) || [];
    group.push(symbol);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    if (group.length < 2 && !group.some(symbol => symbol.overloadLike)) continue;
    group.forEach((symbol, index) => {
      symbol.overloadLike = true;
      symbol.overloadGroup = key;
      symbol.overloadIndex = index + 1;
    });
  }
}

function stringValue(node) {
  if (!node) return null;
  const fragment = descendants(node, child => child.type === 'string_fragment')[0];
  if (fragment) return fragment.text;
  return node.text.replace(/^(["'`])([\s\S]*)\1$/, '$2');
}

function importRecord(source, target, alias, kind) {
  return { source, target, alias, kind, resolved: false };
}

function javascriptImports(node) {
  const source = stringValue(node.childForFieldName?.('source'));
  if (!source) return [];
  const clause = node.namedChildren?.find(child => child.type === 'import_clause') || null;
  if (!clause) return [importRecord(source, null, null, 'side-effect')];
  const typeImport = /^\s*import\s+type\b/.test(node.text);
  const records = [];
  for (const child of clause.namedChildren || []) {
    if (child.type === 'identifier') {
      records.push(importRecord(source, 'default', child.text, typeImport ? 'type' : 'default'));
      continue;
    }
    if (child.type === 'namespace_import') {
      const local = child.namedChildren?.at(-1)?.text || null;
      records.push(importRecord(source, '*', local, typeImport ? 'type' : 'namespace'));
      continue;
    }
    if (child.type !== 'named_imports') continue;
    for (const specifier of child.namedChildren || []) {
      if (specifier.type !== 'import_specifier') continue;
      const imported = specifier.childForFieldName?.('name') || specifier.namedChildren?.[0];
      if (!imported) continue;
      const alias = specifier.childForFieldName?.('alias')?.text || null;
      const kind = typeImport || /^\s*type\b/.test(specifier.text) ? 'type' : 'named';
      records.push(importRecord(source, imported.text, alias, kind));
    }
  }
  return records;
}

function pythonImports(node) {
  if (node.type === 'import_statement') {
    return (node.namedChildren || []).flatMap(child => {
      if (child.type === 'aliased_import') {
        const target = child.namedChildren?.[0]?.text;
        const alias = child.namedChildren?.[1]?.text || null;
        return target ? [importRecord(target, target, alias, 'module')] : [];
      }
      if (['dotted_name', 'identifier'].includes(child.type)) return [importRecord(child.text, child.text, null, 'module')];
      return [];
    });
  }
  const moduleNode = node.childForFieldName?.('module_name');
  const source = moduleNode?.text || '';
  if (!source) return [];
  return (node.namedChildren || []).flatMap(child => {
    if (child === moduleNode) return [];
    if (child.type === 'aliased_import') {
      const target = child.namedChildren?.[0]?.text;
      const alias = child.namedChildren?.[1]?.text || null;
      return target ? [importRecord(source, target, alias, 'named')] : [];
    }
    if (child.type === 'wildcard_import') return [importRecord(source, '*', null, 'wildcard')];
    if (['dotted_name', 'identifier'].includes(child.type)) return [importRecord(source, child.text, null, 'named')];
    return [];
  });
}

function collectImports(root, language) {
  const imports = [];
  const importNodes = descendants(root, node => node.type === 'import_statement' || node.type === 'import_from_statement');
  for (const node of importNodes) imports.push(...(language === 'python' ? pythonImports(node) : javascriptImports(node)));
  return imports;
}

function importBinding(record) {
  if (record.alias) return record.alias;
  if (record.kind === 'module') return record.target?.split('.', 1)[0] || null;
  if (record.kind === 'named' || record.kind === 'type') return record.target;
  return null;
}

function callCallee(node) {
  return node.childForFieldName?.('function') || node.namedChildren?.[0] || null;
}

function memberParts(node) {
  if (!['member_expression', 'optional_member_expression', 'attribute'].includes(node.type)) return null;
  const object = node.childForFieldName?.('object') || node.namedChildren?.[0] || null;
  const property = node.childForFieldName?.('property') || node.childForFieldName?.('attribute') || node.namedChildren?.at(-1) || null;
  return object && property ? { object, property } : null;
}

function calleeInfo(node) {
  const callee = callCallee(node);
  if (!callee) return { type: 'dynamic', name: '<unknown>' };
  if (callee.type === 'identifier') return { type: 'identifier', name: callee.text };
  const member = memberParts(callee);
  if (member && member.property.type !== 'arguments') return {
    type: 'member',
    name: member.property.text,
    object: member.object
  };
  return { type: 'dynamic', name: callee.text.slice(0, 512) };
}

function containingSymbol(node, byNode) {
  let parent = node.parent;
  while (parent) {
    const symbol = byNode.get(parent);
    if (symbol) return symbol;
    parent = parent.parent;
  }
  return null;
}

function addUnresolved(unresolved, seen, kind, name, reason) {
  const boundedName = String(name || '<unknown>').slice(0, 512);
  const key = `${kind}\0${boundedName}\0${reason}`;
  if (seen.has(key)) return;
  seen.add(key);
  unresolved.push({ kind, name: boundedName, reason });
}

function buildRelationships(root, symbols, imports, filePath) {
  const references = [];
  const unresolved = [];
  const unresolvedKeys = new Set();
  const byNode = new Map(symbols.map(symbol => [symbol._node, symbol]));
  const localByName = new Map();
  const methodsByOwner = new Map();
  for (const symbol of symbols) {
    const local = localByName.get(symbol.name) || [];
    local.push(symbol);
    localByName.set(symbol.name, local);
    if (symbol.owner) {
      const key = `${symbol.owner}\0${symbol.name}`;
      const methods = methodsByOwner.get(key) || [];
      methods.push(symbol);
      methodsByOwner.set(key, methods);
    }
  }
  const importedNames = new Set(imports.map(importBinding).filter(Boolean));
  const calls = descendants(root, node => callTypes.has(node.type));
  for (const call of calls) {
    const caller = containingSymbol(call, byNode);
    const from = caller?.id || null;
    const info = calleeInfo(call);
    let target = null;
    let reason = null;
    if (info.type === 'identifier') {
      if (importedNames.has(info.name)) {
        reason = 'Imported calls are foreign until a module resolver is available.';
      } else {
        const ownerTarget = caller?.owner ? methodsByOwner.get(`${caller.owner}\0${info.name}`)?.[0] : null;
        target = ownerTarget || localByName.get(info.name)?.find(symbol => !symbol.owner) || null;
        if (!target) reason = 'No same-file declaration is visible; cross-file and runtime resolution are unsupported.';
      }
    } else if (info.type === 'member') {
      const receiver = info.object.text;
      const ownerTarget = caller?.owner && (info.object.type === 'this' || receiver === 'self' || receiver === 'cls')
        ? methodsByOwner.get(`${caller.owner}\0${info.name}`)?.[0]
        : null;
      target = ownerTarget || null;
      if (!target) {
        reason = info.object.type === 'this' || receiver === 'self' || receiver === 'cls'
          ? 'The current class has no statically declared method with this name.'
          : 'Dynamic receivers and dispatch are not resolved.';
      }
    } else {
      reason = 'Dynamic callees are not resolved.';
    }
    if (target) {
      references.push({ from, to: target.id, kind: 'call', resolved: true });
    } else {
      references.push({ from, to: info.name, kind: 'call', resolved: false });
      addUnresolved(unresolved, unresolvedKeys, 'call', info.name, reason);
    }
  }
  return { references, unresolved };
}

function cleanSymbols(symbols) {
  for (const symbol of symbols) {
    delete symbol._node;
    delete symbol._ownerNode;
    delete symbol._qualifiedName;
    delete symbol._identityReady;
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
  finalizeSymbols(symbols, filePath);
  markOverloads(symbols);
  const imports = collectImports(tree.rootNode, loaded.language);
  const relationships = buildRelationships(tree.rootNode, symbols, imports, filePath);
  const limitations = [
    'Dynamic dispatch, re-exports, aliases, generated code, reflection and runtime registration are not resolved.',
    'The parser reports syntax structure, not semantic type resolution, module resolution, call-graph completeness or runtime behavior.',
    'Imports are syntax-bounded records; resolved is false because cross-file module resolution is outside this adapter.',
    'References contain direct call expressions only; dynamic receivers, foreign calls and complete call graphs remain unresolved.'
  ];
  if (tree.rootNode.hasError) limitations.push('The parser reported syntax errors; declarations and relationships are partial for this source snapshot.');
  cleanSymbols(symbols);
  return {
    language: loaded.language,
    basis: 'Tree-sitter concrete syntax tree declaration and relationship adapter',
    exhaustive: false,
    symbols,
    imports,
    references: relationships.references,
    unresolved: relationships.unresolved,
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
