#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { mergeMarkdownSections, publishExternalFiles, searchDocuments } from '../lib/optional-capabilities.mjs';

function main() {
  const [action, inputPath, outputPath] = process.argv.slice(2);
  if (!['search', 'merge', 'external'].includes(action) || !inputPath) throw new Error('Usage: node scripts/optional-capabilities.mjs search|merge|external INPUT.json [OUTPUT.json]');
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const result = action === 'search' ? searchDocuments(input.documents, input.query, input.options) : action === 'merge' ? mergeMarkdownSections(input.base, input.current, input.candidate) : publishExternalFiles(input);
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try { main(); } catch (error) { process.stderr.write(`Documenter optional capability: ${error.message}\n`); process.exitCode = 1; }
