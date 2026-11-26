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
