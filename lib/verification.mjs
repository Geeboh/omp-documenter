import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const DEFAULT_MAX_OUTPUT_BYTES = 65536;
const DEFAULT_TIMEOUT_MS = 30000;
const DOCUMENTATION_SCRIPT_NAMES = new Set(['docs', 'doc', 'docs:build', 'build:docs', 'lint:docs']);
const RENDERER_DEFINITIONS = [
  {
    id: 'mkdocs',
    commandPattern: /\bmkdocs(?:\.exe)?\b/i,
    configurationPaths: ['mkdocs.yml', 'mkdocs.yaml', 'docs/mkdocs.yml', 'docs/mkdocs.yaml']
  },
  {
    id: 'docusaurus',
    commandPattern: /\bdocusaurus\b/i,
    configurationPaths: [
      'docusaurus.config.js',
      'docusaurus.config.ts',
      'docusaurus.config.mjs',
      'docusaurus.config.cjs',
      'website/docusaurus.config.js',
      'website/docusaurus.config.ts',
      'website/docusaurus.config.mjs',
      'website/docusaurus.config.cjs'
    ]
  },
  {
    id: 'sphinx',
    commandPattern: /\b(?:sphinx-build|sphinx-apidoc)\b|\bpython(?:\d+(?:\.\d+)?)?\s+-m\s+sphinx\b/i,
    configurationPaths: ['conf.py', 'docs/conf.py', 'source/conf.py', 'docs/source/conf.py']
  }
];

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function environmentOverrides(example) {
  const value = example.environment ?? example.env;
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Example ${example.id} environment must be an object.`);
  const overrides = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!name || name.includes('\0') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Example ${example.id} has an unsafe environment name.`);
    if (typeof entry !== 'string' || entry.includes('\0')) throw new Error(`Example ${example.id} environment values must be strings.`);
    overrides[name] = entry;
  }
  return overrides;
}

function assertInput(input) {
  if (!input || !Array.isArray(input.examples)) throw new Error('examples input must contain an examples array.');
  if (input.examples.length > 100) throw new Error('examples input exceeds the 100-example limit.');
  for (const example of input.examples) {
    if (!example || typeof example.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(example.id)) throw new Error('Each example needs a stable id.');
    if (!Array.isArray(example.argv) || !example.argv.length || example.argv.some(arg => typeof arg !== 'string' || !arg || arg.includes('\0'))) throw new Error(`Example ${example.id} needs a nonempty argv array.`);
    if (example.argv.some(arg => arg.includes('&&') || arg.includes(';') || arg.includes('|'))) throw new Error(`Example ${example.id} contains shell syntax. Use argv elements, not shell source.`);
    if (example.cwd !== undefined && (typeof example.cwd !== 'string' || path.isAbsolute(example.cwd) || example.cwd.split('/').includes('..'))) throw new Error(`Example ${example.id} has an unsafe cwd.`);
    environmentOverrides(example);
  }
}

function repositoryRevision(repository) {
  if (!fs.existsSync(path.join(repository, '.git'))) return null;
  const result = spawnSync('git', ['-C', repository, 'rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 128,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0'
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const revision = String(result.stdout || '').trim();
  return result.status === 0 && !result.error && /^[a-f0-9]{40,64}$/.test(revision) ? revision : null;
}

function boundedOutput(value, maxBytes, forcedTruncated = false) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  const bounded = buffer.subarray(0, maxBytes);
  return {
    text: bounded.toString('utf8'),
    bytes: bounded.byteLength,
    observedBytes: buffer.byteLength,
    truncated: forcedTruncated || buffer.byteLength > maxBytes,
    buffer: bounded
  };
}

function assertLimits(maxOutputBytes, timeoutMs) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error('maxOutputBytes must be a positive integer.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new Error('timeoutMs must be a nonnegative integer.');
}

export function verifyExamples(input, { root = process.cwd(), maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  assertInput(input);
  assertLimits(maxOutputBytes, timeoutMs);
  const repository = fs.realpathSync(root);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'documenter-example-'));
  const revision = repositoryRevision(repository);
  const startedAt = new Date().toISOString();
  const results = [];
  try {
    for (const example of input.examples) {
      const cwd = example.cwd ? path.join(repository, example.cwd) : repository;
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Example ${example.id} cwd does not exist: ${example.cwd || '.'}`);
      const overrides = environmentOverrides(example);
      const executionEnvironment = {
        ...process.env,
        ...overrides,
        CI: '1',
        DOCUMENTER_EXAMPLE_FIXTURE: fixture
      };
      const result = spawnSync(example.argv[0], example.argv.slice(1), {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes + 1,
        env: executionEnvironment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const overflow = result.error?.code === 'ENOBUFS';
      const stdout = boundedOutput(result.stdout, maxOutputBytes, overflow && Buffer.isBuffer(result.stdout) && result.stdout.byteLength >= maxOutputBytes);
      const stderr = boundedOutput(result.stderr, maxOutputBytes, overflow && Buffer.isBuffer(result.stderr) && result.stderr.byteLength >= maxOutputBytes);
      const output = Buffer.concat([stdout.buffer, stderr.buffer]);
      const outputTruncated = stdout.truncated || stderr.truncated || overflow;
      const expectedExit = example.expectedExit ?? 0;
      const passed = result.error?.code === 'ETIMEDOUT'
        ? false
        : result.status === expectedExit && (example.stdoutIncludes === undefined || stdout.text.includes(example.stdoutIncludes));
      results.push({
        id: example.id,
        argv: example.argv,
        cwd: example.cwd || '.',
        expectedExit,
        actualExit: result.status,
        signal: result.signal,
        timedOut: result.error?.code === 'ETIMEDOUT',
        passed,
        stdout: stdout.text,
        stderr: stderr.text,
        outputSha256: sha256(output),
        outputSha256Scope: 'bounded captured output',
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        outputTruncated,
        environment: {
          ...overrides,
          CI: '1',
          DOCUMENTER_EXAMPLE_FIXTURE: fixture
        },
        environmentInherited: true,
        revision,
        truncation: {
          truncated: outputTruncated,
          limitBytes: maxOutputBytes,
          stdout: { bytes: stdout.bytes, observedBytes: stdout.observedBytes, truncated: stdout.truncated },
          stderr: { bytes: stderr.bytes, observedBytes: stderr.observedBytes, truncated: stderr.truncated },
          output: { bytes: output.byteLength, observedBytes: stdout.observedBytes + stderr.observedBytes, truncated: outputTruncated },
          reason: overflow ? 'spawn maxBuffer exceeded' : null
        }
      });
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }

  return {
    schemaVersion: 2,
    kind: 'execution',
    startedAt,
    finishedAt: new Date().toISOString(),
    scope: 'Explicit argv examples only. No shell interpretation, network isolation, or filesystem sandbox is claimed. Inherited environment variables are used but not serialized.',
    results,
    passed: results.every(result => result.passed)
  };
}

function readPackageScripts(repository) {
  const packagePath = path.join(repository, 'package.json');
  if (!fs.existsSync(packagePath)) return {};
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return packageJson && packageJson.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
    ? Object.fromEntries(Object.entries(packageJson.scripts).filter(([, command]) => typeof command === 'string'))
    : {};
}

function rendererConfiguration(repository, definition) {
  return definition.configurationPaths.filter(file => fs.existsSync(path.join(repository, file)));
}

function executionStatus(available) {
  return available
    ? {
        status: 'not-run',
        attempted: false,
        executed: false,
        reason: 'Renderer detection does not execute configured commands.'
      }
    : {
        status: 'not-configured',
        attempted: false,
        executed: false,
        reason: 'No supported renderer command or configuration was detected.'
      };
}

export function detectRenderer(root = process.cwd()) {
  const repository = fs.realpathSync(root);
  const scripts = readPackageScripts(repository);
  const genericScripts = [...DOCUMENTATION_SCRIPT_NAMES].filter(name => typeof scripts[name] === 'string');
  const allConfigurationFiles = RENDERER_DEFINITIONS.flatMap(definition => rendererConfiguration(repository, definition));
  const rendererAdapters = RENDERER_DEFINITIONS.map(definition => {
    const configurationFiles = rendererConfiguration(repository, definition);
    const scriptNames = Object.entries(scripts)
      .filter(([name, command]) => definition.commandPattern.test(command) || (configurationFiles.length > 0 && DOCUMENTATION_SCRIPT_NAMES.has(name)))
      .map(([name]) => name)
      .sort();
    const commands = scriptNames.map(name => scripts[name]);
    const available = configurationFiles.length > 0 || commands.length > 0;
    const execution = executionStatus(available);
    return {
      id: definition.id,
      available,
      version: null,
      scripts: scriptNames,
      commands,
      configurationFiles,
      execution,
      executionStatus: execution.status,
      scope: available
        ? 'Detected project renderer configuration or command; execution requires an explicit run.'
        : `No supported ${definition.id} configuration or command detected.`,
      limitations: ['Renderer-specific navigation, anchors, diagrams and generated API pages remain unverified until an explicit renderer command runs.']
    };
  });
  const genericAvailable = genericScripts.length > 0 || allConfigurationFiles.length > 0;
  const genericExecution = executionStatus(genericAvailable);
  return {
    schemaVersion: 2,
    adapters: [
      {
        id: 'project-renderer',
        available: genericAvailable,
        version: null,
        scripts: genericScripts,
        commands: genericScripts.map(name => scripts[name]),
        configurationFiles: allConfigurationFiles,
        execution: genericExecution,
        executionStatus: genericExecution.status,
        scope: genericAvailable
          ? 'detected project configuration; execution requires an explicit run.'
          : 'no supported project renderer configuration detected',
        limitations: ['Renderer-specific anchors and plugins remain unverified until an explicit renderer command runs.']
      },
      ...rendererAdapters
    ],
    renderers: rendererAdapters
  };
}

export function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(clone(value), null, 2)}\n`, { flag: 'wx' }); }
