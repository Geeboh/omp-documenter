import test from 'node:test';
import assert from 'node:assert/strict';
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
