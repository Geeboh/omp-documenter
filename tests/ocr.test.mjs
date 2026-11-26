import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { installOcrModel, ocrDoctor, ocrStatus, removeOcrModel, testOcr, verifyOcrModels } from '../lib/ocr.mjs';

const fixture = [path.resolve('.documenter/local-artifacts/documenter-ocr.png'), '/tmp/documenter-ocr.png'].find(file => fs.existsSync(file)) ?? path.resolve('.documenter/local-artifacts/documenter-ocr.png');
const scanPdf = [path.resolve('.documenter/local-artifacts/documenter-ocr-scan.pdf'), '/tmp/documenter-ocr-scan.pdf'].find(file => fs.existsSync(file)) ?? path.resolve('.documenter/local-artifacts/documenter-ocr-scan.pdf');
const model = '/usr/share/tesseract-ocr/5/tessdata/eng.traineddata';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

test('OCR status reports the installed local Tesseract capability', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-ocr-status-'));
  const status = ocrStatus(root);
  assert.equal(status.backend.executable, true);
  assert.match(status.backend.version, /^5\./);
  assert.ok(status.languages.includes('eng'));
  assert.ok(status.languages.includes('osd'));
  assert.equal(status.models.find(item => item.id === 'eng').sha256.length, 64);
  fs.rmSync(root, { recursive: true, force: true });
});

test('model provisioning is atomic, idempotent by identity, verifiable and removable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-ocr-model-'));
  const bytes = fs.readFileSync(model);
  const expectedSha256 = digest(bytes);
  const first = installOcrModel(root, { id: 'eng', sourcePath: model, expectedSha256, packageSha256: 'b1996b3113c78663f4dd16cf18aa1f288b07e9624f8d4a0ddbd7d9b52a234ba7' });
  assert.equal(first.ok, true);
  assert.equal(verifyOcrModels(root, { modelRoot: path.join(root, '.documenter/ocr/models') }).models.find(item => item.id === 'eng').verified, true);
  const manifestPath = path.join(root, '.documenter/ocr/models.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.models[0].expectedSha256 = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(testOcr(root, { file: fixture }).code, 'OCR_MODEL_UNVERIFIED');
  assert.throws(() => installOcrModel(root, { id: 'eng', sourcePath: model, expectedSha256: '0'.repeat(64) }), /checksum mismatch/);
  assert.equal(removeOcrModel(root, 'eng').removed, true);
  fs.rmSync(root, { recursive: true, force: true });
});
test('missing verified model returns explicit OCR_REQUIRED', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-ocr-missing-'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-ocr-empty-models-'));
  try {
    const result = testOcr(root, { file: fixture, modelRoot: empty });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'OCR_REQUIRED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});


test('OCR doctor and public test qualify the real raster fixture when present', t => {
  if (!fs.existsSync(fixture)) return t.skip('real raster fixture not provisioned in this process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-ocr-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const doctor = ocrDoctor(root, { fixture, expectedPhrase: 'Documenter OCR Test 42' });
  assert.equal(doctor.ok, true);
  assert.equal(doctor.functional.receipt.ocr.used, true);
  const result = testOcr(root, { file: fixture, expectedPhrase: 'Offline Evidence' });
  if (fs.existsSync(scanPdf)) {
    const pdfDoctor = ocrDoctor(root, { fixture: scanPdf, fixtureMimeType: 'application/pdf', expectedPhrase: 'Documenter OCR Test 42' });
    assert.equal(pdfDoctor.ok, true);
    assert.equal(pdfDoctor.functional.receipt.structure.counts.pages, 1);
  }
  assert.equal(result.ok, true);
  assert.equal(result.receipt.ocr.backend, 'tesseract');
  assert.equal(result.receipt.source.ocrModelSha256.length, 64);
});
