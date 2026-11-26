#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as xberg from '@xberg-io/xberg';

function packageVersion() {
  const packageFile = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', '@xberg-io', 'xberg', 'package.json');
  return JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
}

async function main() {
  const args = process.argv.slice(2);
  const action = args.shift();
  if (action === 'probe') {
    process.stdout.write(JSON.stringify({ version: packageVersion(), formats: xberg.listSupportedFormats(), extractors: xberg.listDocumentExtractors(), ocr: xberg.listOcrBackends(), renderers: xberg.listRenderers(), doctor: xberg.doctor() }));
    return;
  }
  if (action !== 'extract') throw new Error('Usage: xberg-worker.mjs probe | extract PATH MIME FILENAME');
  const file = path.resolve(args.shift());
  const mimeType = args.shift() || undefined;
  const filename = args.shift() || path.basename(file);
  const bytes = new Uint8Array(fs.readFileSync(file));
  const result = await xberg.extract({ kind: 'bytes', bytes, mimeType, filename }, { useCache: false, enableQualityProcessing: false });
  process.stdout.write(JSON.stringify(result));
}
try { await main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
