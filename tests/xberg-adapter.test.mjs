import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { acquireAuthenticatedSource, extractAuthenticatedSource, extractXbergBatch, extractXbergFile, probeXberg } from '../lib/xberg-adapter.mjs';
import { runOperation } from '../lib/engine.mjs';

const pdf = '/code/GT-N7105T/android-work/src/cts/tests/pdf/module/res/raw/sample_test.pdf';
const docx = '/code/GT-N7105T/android-work/src/developers/build/prebuilts/gradle/StorageProvider/Application/src/main/res/raw/example.docx';

test('Xberg probe reports pinned backend capabilities', () => {
  const result = probeXberg();
  assert.equal(result.available, true);
  assert.ok(result.formats.some(format => format.extension === 'pdf'));
  assert.ok(result.formats.some(format => format.extension === 'docx'));
});

test('Xberg extracts real PDF and DOCX fixtures through the adapter', t => {
  if (!fs.existsSync(pdf) || !fs.existsSync(docx)) return t.skip('repository fixtures unavailable');
  const pdfResult = extractXbergFile(pdf, { mimeType: 'application/pdf' });
  const docxResult = extractXbergFile(docx, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(pdfResult.ok, true);
  assert.equal(docxResult.ok, true);
  assert.match(pdfResult.receipt.content, /sample|test/i);
  assert.match(docxResult.receipt.content, /Example|Blah/);
  assert.equal(pdfResult.receipt.source.sha256.length, 64);
  assert.equal(docxResult.receipt.backend.id, '@xberg-io/xberg');
});
test('adapter rejects empty batches and malformed credential references', async () => {
  assert.equal(extractXbergBatch([]).code, 'BATCH_EMPTY');
  const invalid = await acquireAuthenticatedSource({ url: 'http://127.0.0.1:1', credentialEnv: 'bad-name', allowedOrigins: ['http://127.0.0.1:1'] });
  assert.equal(invalid.code, 'AUTH_CREDENTIAL_REFERENCE_INVALID');
});

test('batch extraction preserves successes and classifies a failing source', t => {
  if (!fs.existsSync(pdf) || !fs.existsSync(docx)) return t.skip('repository fixtures unavailable');

  const missing = `/tmp/${t.name.replace(/[^A-Za-z0-9_-]/g, '-')}-missing.pdf`;
  const result = extractXbergBatch([pdf, docx, missing]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.summary, { total: 3, succeeded: 2, failed: 1 });
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[1].ok, true);
  assert.equal(result.results[2].ok, false);
});
test('Xberg rejects corrupt declared PDF and DOCX sources', t => {
  const pdfPath = `/tmp/${t.name.replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`;
  const docxPath = `/tmp/${t.name.replace(/[^A-Za-z0-9_-]/g, '-')}.docx`;
  fs.writeFileSync(pdfPath, 'not a PDF');
  fs.writeFileSync(docxPath, 'not a DOCX');
  t.after(() => { fs.rmSync(pdfPath, { force: true }); fs.rmSync(docxPath, { force: true }); });
  const pdfResult = extractXbergFile(pdfPath, { mimeType: 'application/pdf' });
  const docxResult = extractXbergFile(docxPath, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(pdfResult.ok, false);
  assert.equal(docxResult.ok, false);
  assert.equal(pdfResult.code, 'XBERG_WORKER_FAILED');
  assert.equal(docxResult.code, 'XBERG_WORKER_FAILED');
});


test('public style operation persists Xberg extraction evidence for explicit PDF style', t => {
  if (!fs.existsSync(pdf)) return t.skip('repository fixture unavailable');
  const root = fs.mkdtempSync('/tmp/documenter-xberg-engine-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = runOperation('style', { root, input: { operation: 'import', source: pdf } });
  assert.equal(result.ok, true);
  assert.equal(result.profile.extractionEvidence.status, 'complete');
  assert.equal(result.profile.extractionEvidence.backend.id, '@xberg-io/xberg');
  assert.ok(result.set.selectedStyleHash);
});


test('authenticated acquisition scopes credentials, rejects login pages, and extracts bytes', async t => {
  let transientAttempts = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/protected' });
      response.end();
      return;
    }
    if (request.url === '/transient' && transientAttempts++ === 0) {
      response.writeHead(503); response.end('retry');
      return;
    }
    if (request.url === '/transient' && request.headers.authorization === 'Bearer test-token') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('# Retried style');
      return;
    }
    if (request.url === '/protected' && request.headers.authorization === 'Bearer test-token') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('# Protected style\n\nUse short headings.');
      return;
    }
    if (request.url === '/login') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<form action="/login"><input type="password"></form>');
      return;
    }
    response.writeHead(401); response.end('no');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  process.env.DOCUMENTER_TEST_TOKEN = 'test-token';
  t.after(() => delete process.env.DOCUMENTER_TEST_TOKEN);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const redirected = await acquireAuthenticatedSource({ url: `${origin}/redirect`, credentialEnv: 'DOCUMENTER_TEST_TOKEN', allowedOrigins: [origin] });
  assert.equal(redirected.ok, true);
  assert.equal(redirected.source.redirects, 1);
  const retried = await acquireAuthenticatedSource({ url: `${origin}/transient`, credentialEnv: 'DOCUMENTER_TEST_TOKEN', allowedOrigins: [origin], maxAttempts: 2 });
  assert.equal(retried.ok, true);
  assert.equal(retried.source.attempts, 2);
  const acquired = await acquireAuthenticatedSource({ url: `${origin}/protected`, credentialEnv: 'DOCUMENTER_TEST_TOKEN', allowedOrigins: [origin] });
  assert.equal(acquired.ok, true);
  assert.equal('authorization' in acquired.source.headers, false);
  assert.equal(acquired.source.authorizationContext.length, 64);
  const extracted = await extractAuthenticatedSource({ url: `${origin}/protected`, credentialEnv: 'DOCUMENTER_TEST_TOKEN', allowedOrigins: [origin], filename: 'style.txt', mimeType: 'text/plain' });
  assert.equal(extracted.ok, true);
  assert.equal(extracted.extraction.ok, true);
  const login = await acquireAuthenticatedSource({ url: `${origin}/login`, credentialEnv: 'DOCUMENTER_TEST_TOKEN', allowedOrigins: [origin] });
  assert.equal(login.ok, false);
  assert.equal(login.code, 'AUTH_LOGIN_PAGE');
  const denied = await acquireAuthenticatedSource({ url: `${origin}/protected`, credentialEnv: 'DOCUMENTER_TEST_TOKEN', allowedOrigins: [] });
  assert.equal(denied.code, 'AUTH_ORIGIN_NOT_ALLOWED');
});
