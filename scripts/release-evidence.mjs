#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FALLBACK_PRODUCT_VERSION = "2.0.0";
const FALLBACK_PACK_VERSION = "1.0.0";
const FALLBACK_NODE_MAJORS = [22, 24, 26];

function usage() {
  return [
    "Usage: node scripts/release-evidence.mjs [options]",
    "",
    "Options:",
    "  --root PATH       Repository root (default: current directory)",
    "  --output PATH     Write JSON to this path (default: stdout only)",
    "  --help            Show this help",
    "",
    "SOURCE_DATE_EPOCH makes generatedAt reproducible. No product checks are run."
  ].join("\n");
}

function parseArgs(argv) {
  let root = process.cwd();
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--root" || argument === "--output") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
      if (argument === "--root") root = value;
      else output = value;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return { root: path.resolve(root), output };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

function regularFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function gitOutput(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Cannot determine repository fact with git: ${detail}`);
  }
}

function sourceRevision(root) {
  const revision = gitOutput(root, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) throw new Error(`git returned an invalid source revision: ${revision}`);
  return revision;
}

function workingTree(root) {
  const status = gitOutput(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return {
    dirty: Boolean(status),
    status,
    digest: crypto.createHash("sha256").update(status).digest("hex")
  };
}

function generatedAt(root) {
  const reproducible = process.env.SOURCE_DATE_EPOCH;
  if (reproducible !== undefined) {
    if (!/^\d+$/.test(reproducible)) throw new Error("SOURCE_DATE_EPOCH must contain Unix seconds");
    const date = new Date(Number(reproducible) * 1000);
    if (!Number.isFinite(date.getTime())) throw new Error("SOURCE_DATE_EPOCH is outside the supported date range");
    return date.toISOString();
  }
  return new Date().toISOString();
}

function runtimeResults(nodeMajors) {
  const observed = `${process.version} on ${process.platform}/${process.arch}`;
  const results = [{
    runtime: "node (generator runtime)",
    version: process.version,
    status: "not_run",
    artifactPaths: [],
    limitations: [`Observed ${observed}; this generator did not run product checks.`]
  }];
  for (const major of nodeMajors) {
    results.push({
      runtime: `Node.js ${major} qualification matrix`,
      version: `${major}.x`,
      status: "not_run",
      artifactPaths: [],
      limitations: [`No Documenter product qualification run was recorded on Node.js ${major}.`]
    });
  }
  results.push({
    runtime: "OMP host qualification",
    version: "unavailable",
    status: "not_run",
    artifactPaths: [],
    limitations: ["Live OMP load, skill discovery, tool, command, queue, approval, and fallback checks were not run by this generator."]
  });
  return results;
}

function writeAtomically(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function createReleaseEvidence({ root = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(root);
  const packageFile = path.join(repositoryRoot, "package.json");
  if (!regularFile(packageFile)) throw new Error(`package.json does not exist: ${packageFile}`);
  const packageJson = readJson(packageFile);
  const decisionsFile = path.join(repositoryRoot, ".overhaul", "documenter-v2", "contracts", "decisions.json");
  const decisionsJson = regularFile(decisionsFile) ? readJson(decisionsFile) : null;
  const productVersion = decisionsJson?.targetVersion || FALLBACK_PRODUCT_VERSION;
  const packVersion = decisionsJson?.packVersion || FALLBACK_PACK_VERSION;
  const nodeMajors = Array.isArray(decisionsJson?.runtime?.qualificationNodeMajors) && decisionsJson.runtime.qualificationNodeMajors.length
    ? decisionsJson.runtime.qualificationNodeMajors
    : FALLBACK_NODE_MAJORS;
  const revision = sourceRevision(repositoryRoot);
  const packageHash = sha256File(packageFile);
  const observed = `${process.version} on ${process.platform}/${process.arch}`;

  return {
    schemaVersion: 2,
    productVersion,
    sourceCommit: revision,
    workingTree: workingTree(repositoryRoot),
    generatedAt: generatedAt(repositoryRoot),
    implementationStatus: "checkpointed",
    qualificationStatus: "not-qualified",
    runtimeResults: runtimeResults(nodeMajors),
    acceptanceResults: [],
    readerJourneys: [],
    artifactHashes: { "package.json": packageHash },
    decisions: [
      `Handoff pack version ${packVersion}; product target version is ${productVersion}.`,
      `Package metadata reports version ${packageJson.version}.`,
      `Source revision is ${revision}.`,
      `Generator runtime is ${observed}; this is an observation, not product qualification.`,
      "Pack integrity qualification is separate from product implementation and host qualification.",
      "Product qualification is not claimed by this metadata generator.",
      "No licensing or third-party provenance decision is asserted by this skeleton."
    ],
    remainingGaps: [
      "Pack integrity checks are not run by this metadata generator.",
      "Product implementation checks are not run; implementation status remains checkpointed.",
      ...nodeMajors.map((major) => `Node.js ${major} product qualification is not_run.`),
      "Real OMP host qualification is not_run. Run plugin load, skill discovery, tool schema, command scheduling, approval, read-only, and worker fallback checks.",
      "Licensing and third-party provenance remain an owner decision before publication."
    ],
    productQualified: false,
    scope: "Metadata skeleton from repository and generator runtime facts. It does not run tests, host checks, adapters, benchmarks, or licensing review."
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const payload = `${JSON.stringify(createReleaseEvidence(options), null, 2)}\n`;
  if (options.output) writeAtomically(path.resolve(options.root, options.output), payload);
  process.stdout.write(payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`release-evidence: ${error.message}\n`);
    process.exitCode = 1;
  }
}
