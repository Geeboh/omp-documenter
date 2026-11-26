import path from 'node:path';

const JS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY = new Set(['.py', '.pyw']);

function range(text, index, length) {
  const before = text.slice(0, index);
  const startLine = before ? before.split('\n').length : 1;
  return { startLine, endLine: startLine + text.slice(index, index + length).split('\n').length - 1 };
}

function jsSymbols(text) {
  const symbols = [];
  const patterns = [
    { kind: 'function', expression: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'class', expression: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'variable-function', expression: /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^\n]*\)\s*=>/g }
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern.expression)) symbols.push({ id: `${pattern.kind}:${match[1]}`, name: match[1], kind: pattern.kind, ...range(text, match.index, match[0].length) });
  return symbols.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}

function pythonSymbols(text) {
  const symbols = [];
  for (const match of text.matchAll(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)) symbols.push({ id: `function:${match[2]}`, name: match[2], kind: 'function', ...range(text, match.index, match[0].length), indent: match[1].length });
  for (const match of text.matchAll(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(|:)/gm)) symbols.push({ id: `class:${match[2]}`, name: match[2], kind: 'class', ...range(text, match.index, match[0].length), indent: match[1].length });
  return symbols.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}

export function inventorySymbols(filePath, text) {
  const extension = path.extname(filePath).toLowerCase();
  if (JS.has(extension)) return { language: 'javascript-family', basis: 'bounded lexical declaration scan', exhaustive: false, symbols: jsSymbols(text), limitations: ['Dynamic dispatch, decorators, re-exports, aliases, overloads, generated code, reflection and nested scope semantics are not resolved.'] };
  if (PY.has(extension)) return { language: 'python', basis: 'bounded declaration scan', exhaustive: false, symbols: pythonSymbols(text), limitations: ['Decorators, dynamic attributes, imports, generated code, inheritance and runtime registration are not resolved.'] };
  return { language: 'unknown', basis: 'unsupported', exhaustive: false, symbols: [], limitations: [`No symbol adapter is declared for ${extension || 'extensionless'} files.`] };
}
