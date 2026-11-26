#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyExamples, loadJson, writeJson } from '../lib/verification.mjs';

function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');
  if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error('Usage: node scripts/verify-examples.mjs --input examples.json [--root PATH] [--output FILE]');
  const inputPath = path.resolve(args[inputIndex + 1]);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : process.cwd();
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;
  const receipt = verifyExamples(loadJson(inputPath), { root });
  if (output) writeJson(output, receipt); else process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.passed) process.exitCode = 2;
}

try { main(); } catch (error) { process.stderr.write(`Documenter examples: ${error.message}\n`); process.exitCode = 1; }
