import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractXbergFile } from './xberg-adapter.mjs';

const OCR_DIR = '.documenter/ocr';
const MODEL_DIR = path.join(OCR_DIR, 'models');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const regular = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });

function modelPaths() {
  return [...new Set([
    process.env.TESSDATA_PREFIX,
    '/usr/share/tesseract-ocr/5/tessdata',
    '/usr/share/tesseract-ocr/4.00/tessdata',
    '/usr/share/tessdata',
    path.join(os.homedir(), '.local/share/tessdata'),
  ].filter(Boolean))];
}

function packageProvenance(packageName) {
  const result = run('dpkg-query', ['-W', '-f=${Package} ${Version}\n', packageName]);
  return result.status === 0 ? result.stdout.trim() : null;
}
function packageOwns(file, packageName) {
  if (!file || !packageName) return false;
  const result = run('dpkg-query', ['-S', file]);
  return result.status === 0 && result.stdout.split(':')[0] === packageName;
}
function packageFileVerified(file, packageName) {
  if (!packageOwns(file, packageName)) return false;
  const manifest = `/var/lib/dpkg/info/${packageName}.md5sums`;
  if (!regular(manifest)) return false;
  const relative = file.startsWith('/') ? file.slice(1) : file;
  const expected = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).find(line => line.endsWith(`  ${relative}`))?.split(/\s+/)[0];
  return Boolean(expected && crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex') === expected);
}

function manifestPath(root) { return path.join(root, OCR_DIR, 'models.json'); }
function readManifest(root) {
  try { return JSON.parse(fs.readFileSync(manifestPath(root), 'utf8')); } catch { return { schemaVersion: 1, models: [] }; }
}
function writeManifest(root, value) {
  const target = manifestPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, target);
}
function installedModel(id, roots = modelPaths()) {
  for (const root of roots) {
    const file = path.join(root, `${id}.traineddata`);
    if (regular(file)) return { id, path: file, sha256: sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size };
  }
  return { id, path: null, sha256: null, bytes: null };
}

export function ocrStatus(root, { modelRoot } = {}) {
  const version = run('tesseract', ['--version']);
  const languages = run('tesseract', ['--list-langs']);
  const roots = modelRoot ? [path.resolve(modelRoot)] : [path.join(root, MODEL_DIR), ...modelPaths()];
  const manifest = readManifest(root);
  const ids = [...new Set(['eng', 'osd', ...manifest.models.map(model => model.id)])];
  const packageNames = { eng: 'tesseract-ocr-eng', osd: 'tesseract-ocr-osd' };
  const models = ids.map(id => {
    const observed = installedModel(id, roots);
    const recorded = manifest.models.find(model => model.id === id) ?? null;
    const packageVerified = packageFileVerified(observed.path, packageNames[id]);
    const expectedSha256 = recorded?.expectedSha256 ?? (packageVerified ? observed.sha256 : null);
    const verificationBasis = recorded?.verificationBasis ?? (packageVerified ? 'dpkg ownership, Debian md5sums manifest, apt-signed package provenance and exact installed model SHA-256' : null);
    return { ...observed, expectedSha256, verificationBasis, verified: Boolean(observed.sha256 && expectedSha256 === observed.sha256 && (recorded || packageVerified)) };
  });
  return {
    schemaVersion: 1,
    backend: { id: 'tesseract', executable: version.status === 0, version: version.status === 0 ? (version.stdout.match(/tesseract (\S+)/)?.[1] ?? null) : null, stderr: version.status === 0 ? '' : version.stderr.trim() },
    languages: languages.status === 0 ? languages.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('List of')) : [],
    modelRoots: roots,
    models,
    config: { backend: 'tesseract', languages: ['eng'], profile: 'system-quality', dpi: 300, offline: true, automaticDownloads: false, maxConcurrentOcr: 1 },
    provenance: { englishPackage: packageProvenance('tesseract-ocr-eng'), orientationPackage: packageProvenance('tesseract-ocr-osd') },
  };
}

export function verifyOcrModels(root, options = {}) {
  const status = ocrStatus(root, options);
  return { ...status, ok: status.backend.executable && status.models.filter(model => ['eng', 'osd'].includes(model.id)).every(model => model.verified) };
}

export function ocrDoctor(root, { fixture, fixtureMimeType = 'image/png', modelRoot, expectedPhrase } = {}) {
  const status = verifyOcrModels(root, { modelRoot });
  const result = { ...status, functional: { attempted: false, ok: false, fixture: fixture ?? null, phrase: expectedPhrase ?? null, receipt: null } };
  if (!fixture) return { ...result, ok: false, failure: { code: 'OCR_FIXTURE_REQUIRED', message: 'Doctor needs a real raster fixture to prove the configured extraction path.' } };
  if (!status.ok) return { ...result, ok: false, failure: { code: 'OCR_MODEL_UNVERIFIED', message: 'Required OCR models are missing or failed checksum verification.' } };
  const modelPath = status.models.find(model => model.id === 'eng')?.path;
  const extraction = extractXbergFile(fixture, { mimeType: fixtureMimeType, ocr: { enabled: true, backend: 'tesseract', language: ['eng'], ...(modelPath ? { tessdataPath: path.dirname(modelPath) } : {}) }, forceOcr: true, modelSha256: status.models.find(model => model.id === 'eng')?.sha256 });
  result.functional = { attempted: true, ok: extraction.ok && extraction.receipt?.ocr?.used === true && (!expectedPhrase || extraction.receipt.content.includes(expectedPhrase)), fixture, phrase: expectedPhrase ?? null, receipt: extraction.ok ? extraction.receipt : extraction };
  return { ...result, ok: result.ok && result.functional.ok };
}

export function testOcr(root, { file, mimeType = 'image/png', modelRoot, expectedPhrase } = {}) {
  if (!file) return { ok: false, code: 'OCR_FILE_REQUIRED', message: 'ocr test requires a file.' };
  const status = verifyOcrModels(root, { modelRoot });
  const model = status.models.find(item => item.id === 'eng');
  if (!model?.path) return { ok: false, code: 'OCR_REQUIRED', message: 'Verified English Tesseract model is unavailable.' };
  if (!model.verified) return { ok: false, code: 'OCR_MODEL_UNVERIFIED', message: 'English Tesseract model failed checksum verification.' };
  const extraction = extractXbergFile(file, { mimeType, ocr: { enabled: true, backend: 'tesseract', language: ['eng'], tessdataPath: path.dirname(model.path) }, forceOcr: true, modelSha256: model.sha256 });
  if (!extraction.ok) return extraction;
  return { ok: !expectedPhrase || extraction.receipt.content.includes(expectedPhrase), receipt: extraction.receipt, expectedPhrase: expectedPhrase ?? null };
}

export function installOcrModel(root, { id, sourcePath, expectedSha256, language = id, profile = 'quality', packageSha256 = null } = {}) {
  if (!/^[a-z0-9_-]+$/.test(id ?? '') || !sourcePath || !expectedSha256) throw new Error('Model install needs id, sourcePath and expectedSha256.');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || (packageSha256 !== null && !/^[a-f0-9]{64}$/.test(packageSha256))) throw new Error('Model and package checksums must be 64-character SHA-256 values.');
  const bytes = fs.readFileSync(path.resolve(sourcePath));
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expectedSha256) throw new Error(`Model checksum mismatch for ${id}: expected ${expectedSha256}, observed ${observedSha256}.`);
  const directory = path.join(root, MODEL_DIR);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${id}.traineddata`);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, target);
  const manifest = readManifest(root);
  manifest.models = [...manifest.models.filter(model => model.id !== id), { id, language, profile, expectedSha256, sourcePath: path.resolve(sourcePath), packageSha256, verificationBasis: packageSha256 ? 'caller-supplied package artifact checksum plus exact model checksum' : 'caller-supplied exact model checksum', installedAt: new Date().toISOString() }].sort((a, b) => a.id.localeCompare(b.id));
  writeManifest(root, manifest);
  return { ok: true, model: { id, path: target, sha256: observedSha256, bytes: bytes.byteLength }, manifest: manifestPath(root) };
}

export function removeOcrModel(root, id) {
  if (!/^[a-z0-9_-]+$/.test(id ?? '')) throw new Error('Invalid model id.');
  const target = path.join(root, MODEL_DIR, `${id}.traineddata`);
  if (regular(target)) fs.rmSync(target);
  const manifest = readManifest(root);
  manifest.models = manifest.models.filter(model => model.id !== id);
  writeManifest(root, manifest);
  return { ok: true, id, removed: !fs.existsSync(target), manifest: manifestPath(root) };
}

export function listOcrModels(root, options = {}) { return ocrStatus(root, options); }
