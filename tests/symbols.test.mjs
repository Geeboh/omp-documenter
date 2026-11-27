import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSymbolGraph } from '../lib/symbol-graph.mjs';
import { inventorySymbols } from '../lib/symbols.mjs';

test('JavaScript symbol inventory reports bounded declarations and limits', () => {
  const result = inventorySymbols('src/app.js', 'export function run() {}\nexport class Worker {}\n');
  assert.equal(result.language, 'javascript-family');
  assert.deepEqual(result.symbols.map(symbol => symbol.name), ['run', 'Worker']);
  assert.equal(result.exhaustive, false);
});

test('Python symbol inventory preserves line ranges', () => {
  const result = inventorySymbols('app.py', 'class App:\n    def run(self):\n        return 1\n');
  assert.deepEqual(result.symbols.map(symbol => symbol.name), ['App', 'run']);
  assert.equal(result.symbols[1].startLine, 2);
});

test('Unsupported languages remain explicit', () => {
  const result = inventorySymbols('src/app.rs', 'fn main() {}\n');
  assert.equal(result.basis, 'unsupported');
  assert.equal(result.symbols.length, 0);
});

test('JavaScript adapter reports declaration metadata without claiming exhaustive parsing', () => {
  const result = inventorySymbols('src/api.ts', [
    '@sealed',
    'export class Child extends Base {}',
    '@memoize',
    'export function run() {}',
    'const _helper = value => value;'
  ].join('\n'));
  assert.equal(result.adapter.id, 'javascript-family');
  assert.equal(result.adapter.parser, 'tree-sitter');
  assert.deepEqual(result.symbols.map(symbol => ({
    name: symbol.name,
    exported: symbol.exported,
    private: symbol.private,
    visibility: symbol.visibility,
    decorators: symbol.decorators,
    bases: symbol.bases,
    overloadLike: symbol.overloadLike
  })), [
    { name: 'Child', exported: true, private: false, visibility: 'exported', decorators: ['sealed'], bases: ['Base'], overloadLike: false },
    { name: 'run', exported: true, private: false, visibility: 'exported', decorators: ['memoize'], bases: [], overloadLike: false },
    { name: '_helper', exported: false, private: true, visibility: 'private', decorators: [], bases: [], overloadLike: false }
  ]);
  assert.deepEqual(result.coverage, {
    declarations: 3,
    exported: 2,
    private: 1,
    decorated: 2,
    inherited: 1,
    overloadLike: 0,
    exhaustive: false
  });
});

test('TypeScript overload-like declarations stay grouped and bounded', () => {
  const result = inventorySymbols('src/parser.ts', [
    'export function parse(value: string): string;',
    'export function parse(value: number): number;',
    'export function parse(value: string | number) { return String(value); }'
  ].join('\n'));
  assert.deepEqual(result.symbols.map(symbol => ({
    name: symbol.name,
    overloadLike: symbol.overloadLike,
    overloadGroup: symbol.overloadGroup,
    overloadIndex: symbol.overloadIndex
  })), [
    { name: 'parse', overloadLike: true, overloadGroup: 'function:parse', overloadIndex: 1 },
    { name: 'parse', overloadLike: true, overloadGroup: 'function:parse', overloadIndex: 2 },
    { name: 'parse', overloadLike: true, overloadGroup: 'function:parse', overloadIndex: 3 }
  ]);
  assert.equal(result.exhaustive, false);
  assert.equal(result.coverage.overloadLike, 3);
});

test('Python adapter observes decorators, inheritance, private names and overload markers', () => {
  const result = inventorySymbols('app.py', [
    '@dataclass',
    'class Child(Base):',
    '    @overload',
    '    def parse(self, value: str):',
    '        ...',
    '    @overload',
    '    def parse(self, value: int):',
    '        ...',
    '    def _private(self):',
    '        ...'
  ].join('\n'));
  const child = result.symbols.find(symbol => symbol.name === 'Child');
  const parse = result.symbols.filter(symbol => symbol.name === 'parse');
  const privateSymbol = result.symbols.find(symbol => symbol.name === '_private');
  assert.equal(result.adapter.id, 'python');
  assert.equal(result.adapter.parser, 'tree-sitter');
  assert.deepEqual({ decorators: child.decorators, bases: child.bases, exported: child.exported }, { decorators: ['dataclass'], bases: ['Base'], exported: true });
  assert.deepEqual(parse.map(symbol => ({ decorators: symbol.decorators, overloadLike: symbol.overloadLike })), [
    { decorators: ['overload'], overloadLike: true },
    { decorators: ['overload'], overloadLike: true }
  ]);
  assert.deepEqual({ private: privateSymbol.private, visibility: privateSymbol.visibility }, { private: true, visibility: 'private' });
  assert.equal(result.coverage.inherited, 1);
  assert.equal(result.coverage.overloadLike, 2);
});

test('Tree-sitter symbols expose qualified IDs and method owners', () => {
  const result = inventorySymbols('src/worker.js', [
    'function helper(value) { return value; }',
    'class Worker {',
    '  method(value) { return helper(value); }',
    '}'
  ].join('\n'));
  const worker = result.symbols.find(symbol => symbol.name === 'Worker');
  const method = result.symbols.find(symbol => symbol.name === 'method');
  const helper = result.symbols.find(symbol => symbol.name === 'helper');
  assert.equal(worker.qualifiedId, 'src/worker.js::Worker');
  assert.equal(worker.id, 'src/worker.js:class:Worker');
  assert.equal(helper.qualifiedId, 'src/worker.js::helper');
  assert.equal(helper.id, 'src/worker.js:function:helper');
  assert.equal(method.kind, 'method');
  assert.equal(method.owner, worker.id);
  assert.equal(method.qualifiedId, 'src/worker.js::Worker.method');
});

test('Tree-sitter imports and bounded call references preserve unresolved calls', () => {
  const result = inventorySymbols('src/run.js', [
    "import defaultValue, { external as ext } from './dep.js';",
    'function helper(value) { return value; }',
    'export function run(value) { return [helper(value), ext(value)]; }'
  ].join('\n'));
  const run = result.symbols.find(symbol => symbol.name === 'run');
  const helper = result.symbols.find(symbol => symbol.name === 'helper');
  assert.deepEqual(result.imports, [
    { source: './dep.js', target: 'default', alias: 'defaultValue', kind: 'default', resolved: false },
    { source: './dep.js', target: 'external', alias: 'ext', kind: 'named', resolved: false }
  ]);
  assert.deepEqual(result.references, [
    { from: run.id, to: helper.id, kind: 'call', resolved: true },
    { from: run.id, to: 'ext', kind: 'call', resolved: false }
  ]);
  assert.deepEqual(result.unresolved, [{
    kind: 'call',
    name: 'ext',
    reason: 'Imported calls are foreign until a module resolver is available.'
  }]);
  assert.ok(result.limitations.some(limitation => limitation.includes('complete call graphs')));
});

test('Python class functions are methods with qualified owners', () => {
  const result = inventorySymbols('app.py', [
    'class App:',
    '    def run(self):',
    '        return self.finish()',
    '    def finish(self):',
    '        return 1'
  ].join('\n'));
  const app = result.symbols.find(symbol => symbol.name === 'App');
  const run = result.symbols.find(symbol => symbol.name === 'run');
  const finish = result.symbols.find(symbol => symbol.name === 'finish');
  assert.equal(run.kind, 'method');
  assert.equal(run.owner, app.id);
  assert.equal(run.qualifiedId, 'app.py::App.run');
  assert.equal(result.references[0].to, finish.id);
  assert.equal(result.references[0].resolved, true);
});

test('Symbol graph resolves local JavaScript and Python imports while preserving unknown edges', () => {
  const graph = buildSymbolGraph([
    {
      path: 'src/api.js',
      text: [
        "import { helper } from './helper';",
        "import { external } from 'external-package';",
        'export function api(value) { return [helper(value), missing(value)]; }'
      ].join('\n')
    },
    {
      path: 'src/helper.js',
      text: 'export function helper(value) { return value; }\n'
    },
    {
      path: 'pkg/api.py',
      text: [
        'from .helper import helper',
        'import requests',
        'def api(value):',
        '    return [helper(value), requests.get(value)]'
      ].join('\n')
    },
    {
      path: 'pkg/helper.py',
      text: 'def helper(value):\n    return value\n'
    }
  ]);
  assert.equal(graph.schemaVersion, 1);
  assert.deepEqual(graph.files.map(file => file.path), ['pkg/api.py', 'pkg/helper.py', 'src/api.js', 'src/helper.js']);

  const jsHelper = graph.symbols.find(symbol => symbol.qualifiedId === 'src/helper.js::helper');
  const pyHelper = graph.symbols.find(symbol => symbol.qualifiedId === 'pkg/helper.py::helper');
  const jsImport = graph.imports.find(record => record.path === 'src/api.js' && record.source === './helper');
  const pyImport = graph.imports.find(record => record.path === 'pkg/api.py' && record.source === '.helper');
  assert.deepEqual({
    resolved: jsImport.resolved,
    resolvedPath: jsImport.resolvedPath,
    resolvedSymbols: jsImport.resolvedSymbols
  }, { resolved: true, resolvedPath: 'src/helper.js', resolvedSymbols: [jsHelper.id] });
  assert.deepEqual({
    resolved: pyImport.resolved,
    resolvedPath: pyImport.resolvedPath,
    resolvedSymbols: [pyHelper.id]
  }, { resolved: true, resolvedPath: 'pkg/helper.py', resolvedSymbols: [pyHelper.id] });

  const jsCall = graph.references.find(reference => reference.path === 'src/api.js' && reference.from?.includes(':function:api'));
  const pyCall = graph.references.find(reference => reference.path === 'pkg/api.py' && reference.from?.includes(':function:api'));
  assert.equal(jsCall.to, jsHelper.id);
  assert.equal(jsCall.resolved, true);
  assert.equal(pyCall.to, pyHelper.id);
  assert.equal(pyCall.resolved, true);
  assert.equal(graph.imports.find(record => record.path === 'pkg/api.py' && record.source === 'requests').resolved, false);
  assert.ok(graph.unresolved.some(entry => entry.path === 'pkg/api.py' && entry.kind === 'import' && entry.name === 'requests'));
  assert.ok(graph.unresolved.some(entry => entry.path === 'pkg/api.py' && entry.kind === 'call' && entry.name === 'get'));
  assert.ok(graph.unresolved.some(entry => entry.path === 'src/api.js' && entry.kind === 'call' && entry.name === 'missing'));
});
