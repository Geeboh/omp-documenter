#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { buildLexicalIndex, searchIndexedDocuments } from '../lib/optional-capabilities.mjs';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.rst', '.txt', '.py', '.js', '.ts', '.tsx', '.jsx', '.yml', '.yaml', '.toml']);
const SKIP_DIRECTORIES = new Set(['.git', '.venv', 'node_modules', '__pycache__', '.cache', 'dist', 'build']);
const DEFAULT_TOP_K = 5;
const DEFAULT_REPETITIONS = 5;

function usage() {
  return 'Usage: node scripts/semantic-search-real-eval.mjs --repo PATH --queries FILE [--output FILE]';
}

function parseArgs(argv) {
  const options = { repo: null, queries: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--repo', '--queries', '--output'].includes(argument)) throw new Error(`${usage()}\nUnknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options[argument.slice(2)] = path.resolve(value);
  }
  if (!options.repo || !options.queries) throw new Error(`${usage()}\n--repo and --queries are required.`);
  return options;
}

function walk(root, current = root, output = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) walk(root, absolute, output);
      continue;
    }
    if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const bytes = fs.readFileSync(absolute);
    if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) continue;
    output.push({ path: path.relative(root, absolute).split(path.sep).join('/'), text: bytes.toString('utf8') });
  }
  return output;
}

function repositoryCommit(repo) {
  return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function loadQueries(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.queries) || manifest.queries.length < 10 || manifest.queries.length > 50) throw new Error('Query manifest needs schemaVersion 1 and 10 to 50 queries.');
  const seen = new Set();
  for (const query of manifest.queries) {
    if (!query || typeof query.id !== 'string' || seen.has(query.id) || typeof query.text !== 'string' || !query.text.trim() || !Array.isArray(query.expectedPaths) || !query.expectedPaths.length) throw new Error('Each query needs a unique id, text and expectedPaths.');
    seen.add(query.id);
  }
  return manifest;
}

function round(value) {
  return Number(value.toFixed(3));
}

function percentile(values, quantile) {
  return values[Math.max(0, Math.ceil(values.length * quantile) - 1)];
}

function scoreCase(query, resultPaths, topK) {
  const matches = query.expectedPaths.filter(expected => resultPaths.includes(expected));
  const firstRank = resultPaths.findIndex(result => query.expectedPaths.includes(result));
  return {
    id: query.id,
    expectedPaths: query.expectedPaths,
    resultPaths,
    matchedPaths: matches,
    recallAtK: matches.length / query.expectedPaths.length,
    reciprocalRank: firstRank < 0 ? 0 : 1 / (firstRank + 1),
    correct: matches.length === query.expectedPaths.length,
    topK
  };
}

function evaluateMode(index, queries, mode, topK, repetitions) {
  const samples = [];
  const cases = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const query of queries) {
      const started = performance.now();
      const result = searchIndexedDocuments(index, query.text, { limit: topK, ranking: mode });
      samples.push(performance.now() - started);
      if (repetition === 0) cases.push(scoreCase(query, result.results.map(entry => entry.path), topK));
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    mode,
    correctness: {
      queries: cases.length,
      correctQueries: cases.filter(item => item.correct).length,
      recallAtK: cases.reduce((sum, item) => sum + item.recallAtK, 0) / cases.length,
      meanReciprocalRank: cases.reduce((sum, item) => sum + item.reciprocalRank, 0) / cases.length,
      cases
    },
    latency: {
      samples: samples.length,
      averageMs: average,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      minMs: sorted[0],
      maxMs: sorted.at(-1)
    }
  };
}

export function evaluateRepository({ repo, queriesFile, topK = DEFAULT_TOP_K, repetitions = DEFAULT_REPETITIONS }) {
  const root = fs.realpathSync(repo);
  const manifest = loadQueries(queriesFile);
  const commit = repositoryCommit(root);
  if (manifest.repository?.commit && manifest.repository.commit !== commit) throw new Error(`Repository commit mismatch: expected ${manifest.repository.commit}, observed ${commit}.`);
  const documents = walk(root);
  const documentPaths = new Set(documents.map(document => document.path));
  for (const query of manifest.queries) for (const expected of query.expectedPaths) if (!documentPaths.has(expected)) throw new Error(`Expected path is absent from repository: ${expected}`);
  const index = buildLexicalIndex(documents);
  const serializedIndexBytes = Buffer.byteLength(JSON.stringify(index));
  const baseline = evaluateMode(index, manifest.queries, 'overlap', topK, repetitions);
  const improved = evaluateMode(index, manifest.queries, 'weighted-v1', topK, repetitions);
  return {
    schemaVersion: 1,
    offline: true,
    networkUsed: false,
    embeddingsUsed: false,
    repository: { ...manifest.repository, observedCommit: commit, path: root },
    corpus: { documents: documents.length, bytes: documents.reduce((sum, document) => sum + Buffer.byteLength(document.text), 0), serializedIndexBytes },
    evaluation: { queries: manifest.queries.length, topK, repetitions, modes: [baseline, improved] },
    improvement: {
      recallAtKDelta: improved.correctness.recallAtK - baseline.correctness.recallAtK,
      meanReciprocalRankDelta: improved.correctness.meanReciprocalRank - baseline.correctness.meanReciprocalRank,
      averageLatencyDeltaMs: improved.latency.averageMs - baseline.latency.averageMs,
      p95LatencyDeltaMs: improved.latency.p95Ms - baseline.latency.p95Ms
    }
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(new URL('.', import.meta.url).pathname, 'semantic-search-real-eval.mjs')) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else {
      const result = evaluateRepository({ repo: options.repo, queriesFile: options.queries });
      const payload = `${JSON.stringify(result, null, 2)}\n`;
      if (options.output) {
        fs.mkdirSync(path.dirname(options.output), { recursive: true });
        fs.writeFileSync(options.output, payload, { flag: 'wx' });
      }
      process.stdout.write(payload);
    }
  } catch (error) {
    process.stderr.write(`Real semantic search evaluation: ${error.message}\n`);
    process.exitCode = 1;
  }
}
