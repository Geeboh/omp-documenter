#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evaluateRepository } from './semantic-search-real-eval.mjs';

function usage() {
  return 'Usage: node scripts/semantic-search-multi-repo-eval.mjs --manifest FILE [--output FILE]';
}

function parseArgs(argv) {
  const options = { manifest: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument !== '--manifest' && argument !== '--output') throw new Error(`${usage()}\nUnknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options[argument.slice(2)] = path.resolve(value);
  }
  if (!options.manifest) throw new Error(`${usage()}\n--manifest is required.`);
  return options;
}

export function evaluateRepositories(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length) throw new Error('Repository manifest needs schemaVersion 1 and cases.');
  const results = manifest.cases.map(item => {
    if (!item || typeof item.id !== 'string' || typeof item.repo !== 'string' || typeof item.queries !== 'string') throw new Error('Each repository case needs id, repo and queries.');
    return { id: item.id, result: evaluateRepository({ repo: path.resolve(item.repo), queriesFile: path.resolve(item.queries) }) };
  });
  const totals = results.reduce((summary, item) => {
    const modes = item.result.evaluation.modes;
    for (const mode of modes) {
      const target = summary[mode.mode] ||= { queries: 0, documents: 0, correctQueries: 0, recallAtK: 0, mrr: 0, averageMs: 0, p95Ms: 0 };
      target.queries += mode.correctness.queries;
      target.documents += item.result.corpus.documents;
      target.correctQueries += mode.correctness.correctQueries;
      target.recallAtK += mode.correctness.recallAtK * mode.correctness.queries;
      target.mrr += mode.correctness.meanReciprocalRank * mode.correctness.queries;
      target.averageMs += mode.latency.averageMs;
      target.p95Ms += mode.latency.p95Ms;
    }
    return summary;
  }, {});
  for (const summary of Object.values(totals)) {
    summary.recallAtK /= summary.queries;
    summary.mrr /= summary.queries;
    summary.averageMs /= results.length;
    summary.p95Ms /= results.length;
  }
  return { schemaVersion: 1, offline: true, embeddingsUsed: false, repositories: results, aggregate: totals };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(new URL('.', import.meta.url).pathname, 'semantic-search-multi-repo-eval.mjs')) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else {
      const result = evaluateRepositories(options.manifest);
      const payload = `${JSON.stringify(result, null, 2)}\n`;
      if (options.output) {
        fs.mkdirSync(path.dirname(options.output), { recursive: true });
        fs.writeFileSync(options.output, payload, { flag: 'wx' });
      }
      process.stdout.write(payload);
    }
  } catch (error) {
    process.stderr.write(`Multi-repository semantic search evaluation: ${error.message}\n`);
    process.exitCode = 1;
  }
}
