import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildLexicalIndex, searchIndexedDocuments } from '../lib/optional-capabilities.mjs';

const DEFAULT_ROOT = 'tests/fixtures/semantic-search-representative';
const LANGUAGES = ['JavaScript', 'TypeScript', 'Python'];
const DEFAULT_TOP_K = 3;
const DEFAULT_REPETITIONS = 5;
const DEFAULT_BUDGETS = {
  serializedIndexBytes: 128 * 1024,
  averageQueryLatencyMs: 5,
  p95QueryLatencyMs: 10
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function resolveFixturePath(root, documentPath) {
  if (typeof documentPath !== 'string' || !documentPath || path.posix.isAbsolute(documentPath)) {
    throw new Error(`Fixture path must be repository-relative: ${documentPath}`);
  }
  const resolved = path.resolve(root, documentPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Fixture path escapes root: ${documentPath}`);
  }
  return resolved;
}

function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    throw new Error('Fixture manifest needs schemaVersion 1.');
  }
  if (!Array.isArray(manifest.languages) ||
      JSON.stringify([...new Set(manifest.languages)].sort()) !== JSON.stringify([...LANGUAGES].sort())) {
    throw new Error('Fixture manifest must declare JavaScript, TypeScript and Python.');
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length < 12 || manifest.documents.length > 15) {
    throw new Error('Fixture manifest needs 12 to 15 documents.');
  }
  if (!Array.isArray(manifest.queries) || manifest.queries.length !== 20) {
    throw new Error('Fixture manifest needs exactly 20 queries.');
  }

  const documentPaths = new Set();
  for (const document of manifest.documents) {
    if (!isRecord(document) || typeof document.path !== 'string' || documentPaths.has(document.path)) {
      throw new Error('Fixture documents need unique relative paths.');
    }
    documentPaths.add(document.path);
    if (document.kind === 'source') {
      if (!LANGUAGES.includes(document.language)) throw new Error(`Unsupported source language: ${document.path}`);
    } else if (document.kind !== 'markdown') {
      throw new Error(`Unsupported fixture document kind: ${document.path}`);
    }
  }

  const queryIds = new Set();
  for (const query of manifest.queries) {
    if (!isRecord(query) || typeof query.id !== 'string' || queryIds.has(query.id)) {
      throw new Error('Fixture queries need unique ids.');
    }
    if (typeof query.text !== 'string' || !query.text.trim() || !Array.isArray(query.expectedPaths) || !query.expectedPaths.length) {
      throw new Error(`Fixture query needs text and expectedPaths: ${query.id}`);
    }
    if (query.expectedPaths.some(documentPath => !documentPaths.has(documentPath))) {
      throw new Error(`Fixture query references an unknown document: ${query.id}`);
    }
    queryIds.add(query.id);
  }

  const evaluation = manifest.evaluation ?? {};
  if (evaluation.topK !== DEFAULT_TOP_K || evaluation.repetitions !== DEFAULT_REPETITIONS) {
    throw new Error('Fixture evaluation must use top-k 3 and five repetitions.');
  }
  const budgets = evaluation.budgets ?? {};
  for (const [name, expected] of Object.entries(DEFAULT_BUDGETS)) {
    if (budgets[name] !== expected) throw new Error(`Fixture budget must set ${name} to ${expected}.`);
  }
}

export function loadFixture(rootInput = DEFAULT_ROOT) {
  const root = path.resolve(rootInput);
  const manifestPath = resolveFixturePath(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const documents = manifest.documents.map(document => ({
    path: document.path,
    text: fs.readFileSync(resolveFixturePath(root, document.path), 'utf8')
  }));
  return { root, manifest, documents };
}

function summarizeCase(query, resultPaths, topK) {
  const matchedPaths = query.expectedPaths.filter(documentPath => resultPaths.includes(documentPath));
  const recallAtK = matchedPaths.length / query.expectedPaths.length;
  return {
    id: query.id,
    expectedPaths: query.expectedPaths,
    resultPaths,
    matchedPaths,
    recallAtK: roundMilliseconds(recallAtK),
    correct: recallAtK === 1,
    topK
  };
}

function percentile(sortedSamples, quantile) {
  return sortedSamples[Math.max(0, Math.ceil(sortedSamples.length * quantile) - 1)];
}

export function runEvaluation({ root = DEFAULT_ROOT } = {}) {
  const fixture = loadFixture(root);
  const { manifest, documents } = fixture;
  const topK = manifest.evaluation.topK;
  const repetitions = manifest.evaluation.repetitions;
  const budgets = manifest.evaluation.budgets;
  const index = buildLexicalIndex(documents);
  const serializedIndexBytes = Buffer.byteLength(JSON.stringify(index));
  const samples = [];
  const cases = [];
  let correctCalls = 0;

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const query of manifest.queries) {
      const started = performance.now();
      const result = searchIndexedDocuments(index, query.text, { limit: topK });
      samples.push(performance.now() - started);
      const resultPaths = result.results.map(entry => entry.path);
      const summary = summarizeCase(query, resultPaths, topK);
      if (summary.correct) correctCalls += 1;
      if (repetition === 0) cases.push(summary);
    }
  }

  const expectedPathCount = cases.reduce((total, query) => total + query.expectedPaths.length, 0);
  const matchedExpectedPathCount = cases.reduce((total, query) => total + query.matchedPaths.length, 0);
  const correctQueries = cases.filter(query => query.correct).length;
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const average = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  const latency = {
    samples: samples.length,
    average: roundMilliseconds(average),
    p50: roundMilliseconds(percentile(sortedSamples, 0.5)),
    p95: roundMilliseconds(percentile(sortedSamples, 0.95)),
    min: roundMilliseconds(sortedSamples[0]),
    max: roundMilliseconds(sortedSamples.at(-1)),
    unit: 'milliseconds'
  };
  const correctness = {
    queries: cases.length,
    correctQueries,
    allQueriesCorrect: correctQueries === cases.length,
    expectedPathCount,
    matchedExpectedPathCount,
    expectedPathRecallAtK: roundMilliseconds(matchedExpectedPathCount / expectedPathCount),
    allMeasuredCallsCorrect: correctCalls === samples.length,
    cases
  };
  const indexWithinBudget = serializedIndexBytes <= budgets.serializedIndexBytes;
  const averageWithinBudget = latency.average <= budgets.averageQueryLatencyMs;
  const p95WithinBudget = latency.p95 <= budgets.p95QueryLatencyMs;

  return {
    schemaVersion: 1,
    fixture: path.relative(process.cwd(), fixture.root).split(path.sep).join('/'),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    counts: {
      documents: documents.length,
      sourceDocuments: manifest.documents.filter(document => document.kind === 'source').length,
      markdownDocuments: manifest.documents.filter(document => document.kind === 'markdown').length,
      queries: manifest.queries.length,
      topK,
      repetitions
    },
    index: {
      serializedBytes: serializedIndexBytes,
      budgetBytes: budgets.serializedIndexBytes,
      withinBudget: indexWithinBudget
    },
    correctness,
    latency,
    budgets: {
      serializedIndexBytes: budgets.serializedIndexBytes,
      averageQueryLatencyMs: budgets.averageQueryLatencyMs,
      p95QueryLatencyMs: budgets.p95QueryLatencyMs,
      indexWithinBudget,
      averageWithinBudget,
      p95WithinBudget
    },
    passed: correctness.allQueriesCorrect && correctness.allMeasuredCallsCorrect && indexWithinBudget && averageWithinBudget && p95WithinBudget
  };
}

function parseRoot(argumentsList) {
  let root = DEFAULT_ROOT;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--root') {
      root = argumentsList[++index];
      if (!root) throw new Error('--root needs a directory.');
    } else if (argument.startsWith('--root=')) {
      root = argument.slice('--root='.length);
      if (!root) throw new Error('--root needs a directory.');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return root;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const evidence = runEvaluation({ root: parseRoot(process.argv.slice(2)) });
    console.log(JSON.stringify(evidence, null, 2));
    if (!evidence.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
