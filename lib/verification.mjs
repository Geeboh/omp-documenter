import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function assertInput(input) {
  if (!input || !Array.isArray(input.examples)) throw new Error('examples input must contain an examples array.');
  if (input.examples.length > 100) throw new Error('examples input exceeds the 100-example limit.');
  for (const example of input.examples) {
    if (!example || typeof example.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(example.id)) throw new Error('Each example needs a stable id.');
    if (!Array.isArray(example.argv) || !example.argv.length || example.argv.some(arg => typeof arg !== 'string' || !arg || arg.includes('\0'))) throw new Error(`Example ${example.id} needs a nonempty argv array.`);
    if (example.argv.some(arg => arg.includes('&&') || arg.includes(';') || arg.includes('|'))) throw new Error(`Example ${example.id} contains shell syntax. Use argv elements, not shell source.`);
    if (example.cwd !== undefined && (typeof example.cwd !== 'string' || path.isAbsolute(example.cwd) || example.cwd.split('/').includes('..'))) throw new Error(`Example ${example.id} has an unsafe cwd.`);
  }
}

export function verifyExamples(input, { root = process.cwd(), maxOutputBytes = 65536, timeoutMs = 30000 } = {}) {
  assertInput(input);
  const repository = fs.realpathSync(root);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-example-'));
  const startedAt = new Date().toISOString();
  const results = [];
  try {
    for (const example of input.examples) {
      const cwd = example.cwd ? path.join(repository, example.cwd) : repository;
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Example ${example.id} cwd does not exist: ${example.cwd || '.'}`);
      const result = spawnSync(example.argv[0], example.argv.slice(1), {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        env: { ...process.env, CI: '1', DOCUMENTER_EXAMPLE_FIXTURE: fixture },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const stdout = String(result.stdout || '');
      const stderr = String(result.stderr || '');
      const output = `${stdout}${stderr}`;
      const expectedExit = example.expectedExit ?? 0;
      const passed = result.error?.code === 'ETIMEDOUT'
        ? false
        : result.status === expectedExit && (example.stdoutIncludes === undefined || stdout.includes(example.stdoutIncludes));
      results.push({
        id: example.id,
        argv: example.argv,
        cwd: example.cwd || '.',
        expectedExit,
        actualExit: result.status,
        signal: result.signal,
        timedOut: result.error?.code === 'ETIMEDOUT',
        passed,
        stdout: stdout.slice(0, maxOutputBytes),
        stderr: stderr.slice(0, maxOutputBytes),
        outputSha256: sha256(output)
      });
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  return { schemaVersion: 2, kind: 'execution', startedAt, finishedAt: new Date().toISOString(), scope: 'Explicit argv examples only. No shell interpretation, network isolation, or filesystem sandbox is claimed.', results, passed: results.every(result => result.passed) };
}

export function detectRenderer(root = process.cwd()) {
  const repository = fs.realpathSync(root);
  const packagePath = path.join(repository, 'package.json');
  const packageJson = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, 'utf8')) : {};
  const scripts = packageJson.scripts || {};
  const candidates = ['docs', 'doc', 'docs:build', 'build:docs', 'lint:docs'].filter(name => typeof scripts[name] === 'string');
  const files = ['mkdocs.yml', 'mkdocs.yaml', 'docusaurus.config.js', 'docusaurus.config.ts', 'conf.py'].filter(name => fs.existsSync(path.join(repository, name)));
  return { schemaVersion: 2, adapters: [{ id: 'project-renderer', available: candidates.length > 0 || files.length > 0, version: null, scripts: candidates, configurationFiles: files, scope: candidates.length || files.length ? 'detected project configuration; execution requires an explicit run.' : 'no supported project renderer configuration detected', limitations: ['Renderer-specific anchors and plugins remain unverified until an explicit renderer command runs.'] }] };
}

export function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(clone(value), null, 2)}\n`, { flag: 'wx' }); }
