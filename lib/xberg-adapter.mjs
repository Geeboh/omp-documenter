import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE = '@xberg-io/xberg';
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'xberg-worker.mjs');
const SHA256 = /^[a-f0-9]{64}$/;

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const redactedHeaders = headers => Object.fromEntries([...headers].filter(([key]) => !/authorization|cookie|proxy-authorization|set-cookie/i.test(key)).map(([key, value]) => [key, value]));

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => item && typeof item === 'object' ? { ...item } : item);
  if (typeof value !== 'string') return value;
  const lines = value.split('\n').filter(Boolean);
  return lines[0]?.startsWith('[') ? lines.slice(1) : lines;
}
async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, code: 'SOURCE_TOO_LARGE', message: `Authenticated source exceeds ${maxBytes} bytes.` };
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > maxBytes ? { ok: false, code: 'SOURCE_TOO_LARGE', message: `Authenticated source exceeds ${maxBytes} bytes.` } : { ok: true, bytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, code: 'SOURCE_TOO_LARGE', message: `Authenticated source exceeds ${maxBytes} bytes.` };
    }
    chunks.push(Buffer.from(next.value));
  }
  return { ok: true, bytes: new Uint8Array(Buffer.concat(chunks)) };
}


function runWorker(args, { timeoutMs = 30_000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnSync(process.execPath, [WORKER, ...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer });
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') return { ok: false, code: 'XBERG_TIMEOUT', message: `Xberg worker exceeded ${timeoutMs} ms.` };
  if (result.status !== 0) return { ok: false, code: 'XBERG_WORKER_FAILED', message: result.stderr.trim() || `Xberg worker exited with status ${result.status}.` };
  try { return { ok: true, value: JSON.parse(result.stdout) }; } catch (error) { return { ok: false, code: 'XBERG_INVALID_RESULT', message: `Xberg worker returned invalid JSON: ${error.message}` }; }
}

function normalizeResult(result, source) {
  const first = result.results?.[0] ?? {};
  return {
    schemaVersion: 1,
    backend: { id: PACKAGE, version: source.backendVersion, extractionMethod: first.extractionMethod ?? null },
    ocr: {
      required: first.extractionMethod === 'ocr' || first.metadata?.additional?.ocrUsed === true || Boolean(first.ocrPageFailures?.length),
      used: first.metadata?.additional?.ocrUsed === true || first.extractionMethod === 'ocr',
      backend: source.ocrBackend ?? null,
      languages: source.ocrLanguages ?? null,
      modelPath: source.ocrModelPath ?? null,
      modelSha256: source.ocrModelSha256 ?? null,
      confidence: first.extractionConfidence?.ocrAggregate ?? first.metadata?.additional?.mean_text_conf ?? null,
      pages: first.ocrPageFailures ?? [],
    },
    source: { ...source, sha256: source.sha256 ?? null },
    status: result.errors?.length && !result.results?.length ? 'failed' : result.summary?.partial ? 'partial' : 'complete',
    content: first.content ?? '',
    mimeType: first.mimeType ?? source.mimeType ?? null,
    metadata: first.metadata ?? {},
    structure: { pages: first.pages ?? [], elements: first.elements ?? [], tables: first.tables ?? [], counts: first.counts ?? {} },
    warnings: [...(result.errors ?? []), ...(first.warnings ?? [])],
    errors: result.errors ?? [],
    summary: result.summary ?? {},
    locators: { pageCount: first.counts?.pages ?? first.pages?.length ?? null },
    cache: { enabled: false, identity: source.sha256 ? `${PACKAGE}@${source.backendVersion}:${source.sha256}` : null },
  };
}

export function probeXberg({ timeoutMs = 15_000 } = {}) {
  const result = runWorker(['probe'], { timeoutMs });
  if (!result.ok) return { available: false, package: PACKAGE, ...result };
  const value = result.value;
  return { available: true, package: PACKAGE, version: value.version, formats: normalizeList(value.formats), extractors: normalizeList(value.extractors), ocr: normalizeList(value.ocr), renderers: normalizeList(value.renderers), doctor: { ...value.doctor, checks: normalizeList(value.doctor?.checks) }, qualification: { packagePinned: value.version === '1.5.4', runtime: `node ${process.versions.node}`, nativeWorker: true } };
}

function extractionConfigFor(options) {
  const config = { useCache: false, enableQualityProcessing: options.enableQualityProcessing ?? Boolean(options.ocr), ...(options.extractionConfig ?? {}) };
  if (options.ocr) config.ocr = options.ocr;
  if (options.forceOcr !== undefined) config.forceOcr = options.forceOcr;
  if (options.disableOcr !== undefined) config.disableOcr = options.disableOcr;
  if (options.ocrNearEmptyFallback !== undefined) config.ocrNearEmptyFallback = options.ocrNearEmptyFallback;
  return config;
}

function ocrSourceFields(options, config) {
  const modelPath = options.ocr?.tessdataPath ?? null;
  return { ocrBackend: options.ocr?.backend ?? null, ocrLanguages: options.ocr?.language ?? null, ocrModelPath: modelPath, ocrModelSha256: options.modelSha256 ?? null, extractionConfigSha256: digest(JSON.stringify(config)) };
}

function extractPath(filePath, options = {}) {
  const { mimeType, filename, timeoutMs = 60_000, maxBytes = 64 * 1024 * 1024 } = options;
  const absolute = path.resolve(filePath);
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink()) return { ok: false, code: 'SOURCE_NOT_REGULAR_FILE', message: `Source is not a regular file: ${filePath}.` };
  if (info.size > maxBytes) return { ok: false, code: 'SOURCE_TOO_LARGE', message: `Source exceeds ${maxBytes} bytes.` };
  const bytes = fs.readFileSync(absolute);
  const backend = probeXberg({ timeoutMs: Math.min(timeoutMs, 15_000) });
  if (!backend.available) return backend;
  const config = extractionConfigFor(options);
  const result = runWorker(['extract', absolute, mimeType ?? '', filename ?? path.basename(absolute), JSON.stringify(config)], { timeoutMs, maxBuffer: Math.max(16 * 1024 * 1024, maxBytes * 2) });
  if (!result.ok) return result;
  const receipt = normalizeResult(result.value, { path: absolute, filename: filename ?? path.basename(absolute), mimeType: mimeType ?? null, bytes: bytes.byteLength, sha256: digest(bytes), backendVersion: backend.version, ...ocrSourceFields(options, config) });
  return { ok: receipt.status !== 'failed', ...(receipt.status === 'failed' ? { code: 'XBERG_EXTRACTION_FAILED', message: receipt.errors.join('; ') || 'Xberg returned no extracted document.' } : {}), receipt };
}

export function extractXbergFile(filePath, options = {}) {
  try { return extractPath(filePath, options); } catch (error) { return { ok: false, code: 'SOURCE_READ_FAILED', message: error.message }; }
}
export function extractXbergBatch(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, code: 'BATCH_EMPTY', message: 'At least one source file is required.' };
  const results = files.map(file => ({ path: file, ...extractXbergFile(file, options) }));
  const failed = results.filter(result => !result.ok);
  return { ok: failed.length === 0, status: failed.length === 0 ? 'complete' : failed.length === results.length ? 'failed' : 'partial', results, summary: { total: results.length, succeeded: results.length - failed.length, failed: failed.length } };
}


export async function acquireAuthenticatedSource({ url, credentialEnv, allowedOrigins = [], timeoutMs = 15_000, maxAttempts = 3, retryDelayMs = 25, maxBytes = 64 * 1024 * 1024, signal } = {}) {
  const target = new URL(url);
  if (!allowedOrigins.includes(target.origin)) return { ok: false, code: 'AUTH_ORIGIN_NOT_ALLOWED', message: `Authentication target origin is not allowed: ${target.origin}.` };
  if (!credentialEnv || !/^[A-Z][A-Z0-9_]{1,127}$/.test(credentialEnv)) return { ok: false, code: 'AUTH_CREDENTIAL_REFERENCE_INVALID', message: 'credentialEnv must name an environment variable.' };
  const token = process.env[credentialEnv];
  if (!token) return { ok: false, code: 'AUTH_CREDENTIAL_MISSING', message: `Credential environment variable is not set: ${credentialEnv}.` };
  if (signal?.aborted) return { ok: false, code: 'SOURCE_CANCELLED', message: 'Authenticated source request was cancelled before fetch.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    let current = target;
    let redirects = 0;
    let attempts = 0;
    while (true) {
      attempts += 1;
      const response = await fetch(current, { headers: { authorization: `Bearer ${token}`, accept: '*/*' }, redirect: 'manual', signal: controller.signal });
      if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempts < Math.min(5, Math.max(1, maxAttempts))) {
        await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, retryDelayMs) * attempts)));
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location ? new URL(location, current) : null;
        if (!next || next.origin !== target.origin || next.origin !== current.origin || redirects++ >= 5) return { ok: false, code: 'AUTH_REDIRECT_REFUSED', status: response.status, headers: redactedHeaders(response.headers) };
        current = next;
        continue;
      }
      const bounded = await readBoundedBody(response, maxBytes);
      if (!bounded.ok) return bounded;
      const bytes = bounded.bytes;
      const bodyText = new TextDecoder().decode(bytes);
      if (response.status === 401 || response.status === 403) return { ok: false, code: 'AUTH_REJECTED', status: response.status, headers: redactedHeaders(response.headers) };
      if (!response.ok) return { ok: false, code: 'SOURCE_HTTP_FAILED', status: response.status, headers: redactedHeaders(response.headers) };
      if (/<(?:form[^>]*login|input[^>]+password|title>[^<]*sign in)/i.test(bodyText)) return { ok: false, code: 'AUTH_LOGIN_PAGE', status: response.status, message: 'Authenticated source resolved to a login page.' };
      return { ok: true, source: { url: current.toString(), status: response.status, redirects, attempts, bytes: bytes.byteLength, sha256: digest(bytes), headers: redactedHeaders(response.headers), authorizationContext: digest(`${target.origin}\0${credentialEnv}`) }, bytes };
    }
  } catch (error) { return { ok: false, code: error.name === 'AbortError' ? 'SOURCE_TIMEOUT' : 'SOURCE_FETCH_FAILED', message: error.message }; }
  finally { clearTimeout(timer); }
}

export async function extractAuthenticatedSource(options = {}) {
  const acquired = await acquireAuthenticatedSource(options);
  if (!acquired.ok) return acquired;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-xberg-'));
  const filename = options.filename ?? (path.basename(new URL(options.url).pathname) || 'source.bin');
  const filePath = path.join(tempDir, filename.replace(/[^A-Za-z0-9._-]/g, '_'));
  try { fs.writeFileSync(filePath, acquired.bytes, { flag: 'wx' }); return { ...acquired, extraction: extractXbergFile(filePath, { filename, mimeType: options.mimeType }) }; }
  finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

export const isXbergAvailable = () => probeXberg().available;
export { SHA256 };
