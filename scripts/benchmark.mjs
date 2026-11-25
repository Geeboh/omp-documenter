#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runOperation } from '../lib/engine.mjs';

function write(root, rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export function benchmark({ files = 50, pageLinks = 100 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-benchmark-'));
  try {
    for (let index = 0; index < files; index++) write(root, `src/module-${index}.js`, `export const value${index} = ${index};\n`);
    const links = Array.from({ length: pageLinks }, (_, index) => `[Missing ${index}](missing-${index}.md)`).join('\n');
    write(root, 'docs/documenter/guide.md', `# Guide\n\n${links}\n`);
    const runs = [];
    for (const operation of ['status', 'check']) {
      const started = performance.now();
      const result = runOperation(operation, { root });
      runs.push({ operation, elapsedMs: Math.round((performance.now() - started) * 1000) / 1000, eligibleFiles: result.scope?.eligibleFiles ?? result.inventory?.eligible, linkFailures: result.links?.totalFailures ?? 0, resultBytes: Buffer.byteLength(JSON.stringify(result)) });
    }
    return { schemaVersion: 2, runtime: process.version, platform: `${process.platform}/${process.arch}`, fixture: { files, pageLinks }, runs, note: 'Controlled local wall-time observation. It is not a universal speedup, token, CPU, or memory claim.' };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.stdout.write(`${JSON.stringify(benchmark(), null, 2)}\n`);
