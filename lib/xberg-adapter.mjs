import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PACKAGE = '@xberg-io/xberg';
const WORKER = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'xberg-worker.mjs');
const SHA256 = /^[a-f0-9]{64}$/;

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const redactedHeaders = headers => Object.fromEntries([...headers].filter(([key]) => !/authorization|cookie|proxy-authorization|set-cookie/i.test(key)).map(([key, value]) => [key, value]));

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => item && typeof item === 'object' ? { ...item } : item);
  if (typeof value !== 'string') return value;
  const lines = value.split('\n').filter(Boolean);
  return lines[0]?.startsWith('[') ? lines.slice(1) : lines;
}

function runWorker(args, { timeoutMs = 30_000 } = {}) {
  const result = spawnSync(process.execPath, [WORKER, ...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') return { ok: false, code: 'XBERG_TIMEOUT', message: `Xberg worker exceeded ${timeoutMs} ms.` };
  if (result.status !== 0) return { ok: false, code: 'XBERG_WORKER_FAILED', message: result.stderr.trim() || `Xberg worker exited with status ${result.status}.` };
  try { return { ok: true, value: JSON.parse(result.stdout) }; } catch (error) { return { ok: false, code: 'XBERG_INVALID_RESULT', message: `Xberg worker returned invalid JSON: ${error.message}` }; }
}

function normalizeResult(result, source) {
  const first = result.results?.[0] ?? {};
  return {
    schemaVersion: 1,
    backend: { id: PACKAGE, version: source.backendVersion, extractionMethod: first.extractionMethod ?? null },
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

function extractPath(filePath, { mimeType, filename, timeoutMs = 60_000, maxBytes = 64 * 1024 * 1024 } = {}) {
  const absolute = path.resolve(filePath);
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink()) return { ok: false, code: 'SOURCE_NOT_REGULAR_FILE', message: `Source is not a regular file: ${filePath}.` };
  if (info.size > maxBytes) return { ok: false, code: 'SOURCE_TOO_LARGE', message: `Source exceeds ${maxBytes} bytes.` };
  const bytes = fs.readFileSync(absolute);
  const backend = probeXberg({ timeoutMs: Math.min(timeoutMs, 15_000) });
  if (!backend.available) return backend;
  const result = runWorker(['extract', absolute, mimeType ?? '', filename ?? path.basename(absolute)], { timeoutMs });
  if (!result.ok) return result;
  return { ok: true, receipt: normalizeResult(result.value, { path: absolute, filename: filename ?? path.basename(absolute), mimeType: mimeType ?? null, bytes: bytes.byteLength, sha256: digest(bytes), backendVersion: backend.version }) };
}

export function extractXbergFile(filePath, options = {}) {
  try { return extractPath(filePath, options); } catch (error) { return { ok: false, code: 'SOURCE_READ_FAILED', message: error.message }; }
}

export async function acquireAuthenticatedSource({ url, credentialEnv, allowedOrigins = [], timeoutMs = 15_000, signal } = {}) {
  const target = new URL(url);
  if (!allowedOrigins.includes(target.origin)) return { ok: false, code: 'AUTH_ORIGIN_NOT_ALLOWED', message: `Authentication target origin is not allowed: ${target.origin}.` };
  if (!credentialEnv || !/^[A-Z][A-Z0-9_]{1,127}$/.test(credentialEnv)) return { ok: false, code: 'AUTH_CREDENTIAL_REFERENCE_INVALID', message: 'credentialEnv must name an environment variable.' };
  const token = process.env[credentialEnv];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    let current = target;
    let redirects = 0;
    while (true) {
      const response = await fetch(current, { headers: { authorization: `Bearer ${token}`, accept: '*/*' }, redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location ? new URL(location, current) : null;
        if (!next || next.origin !== target.origin || next.origin !== current.origin || redirects++ >= 5) return { ok: false, code: 'AUTH_REDIRECT_REFUSED', status: response.status, headers: redactedHeaders(response.headers) };
        current = next;
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const bodySample = new TextDecoder().decode(bytes.subarray(0, 4096));
      if (response.status === 401 || response.status === 403) return { ok: false, code: 'AUTH_REJECTED', status: response.status, headers: redactedHeaders(response.headers) };
      if (!response.ok) return { ok: false, code: 'SOURCE_HTTP_FAILED', status: response.status, headers: redactedHeaders(response.headers) };
      if (/<(?:form[^>]*login|input[^>]+password|title>[^<]*sign in)/i.test(bodySample)) return { ok: false, code: 'AUTH_LOGIN_PAGE', status: response.status, message: 'Authenticated source resolved to a login page.' };
      return { ok: true, source: { url: current.toString(), status: response.status, redirects, bytes: bytes.byteLength, sha256: digest(bytes), headers: redactedHeaders(response.headers), authorizationContext: digest(`${target.origin}\0${credentialEnv}`) }, bytes };
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
