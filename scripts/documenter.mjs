#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runOperation } from "../lib/engine.mjs";
const actions = new Set([
  "scan", "status", "record", "publish", "check",
  "preview", "plan", "initial", "maintain", "overhaul",
  "archive", "stage", "validate", "promote", "resume",
  "archives", "restore", "page", "style", "doctor", "details", "scan-v2", "ocr"
]);

const valueFields = {
  "--root": "root", "--input": "inputPath", "--set": "setId", "--dest": "dest",
  "--frontpage": "frontpage", "--style": "style", "--style-from": "styleFrom",
  "--run-id": "runId", "--archive-id": "archiveId", "--operation": "operation",
  "--path": "path", "--new-path": "newPath", "--expected-sha256": "expectedSha256",
  "--source": "source", "--mode": "mode", "--result-id": "resultId",
  "--offset": "offset", "--limit": "limit", "--reason": "reason",
  "--file": "file", "--fixture": "fixture", "--expected-phrase": "expectedPhrase",
  "--model-root": "modelRoot", "--model-id": "id", "--source-path": "sourcePath",
  "--language": "language", "--backend": "backend", "--model-sha256": "modelSha256",
  "--package-sha256": "packageSha256"
};

const help = `OMP Documenter 2.0.0

Usage:
  node scripts/documenter.mjs scan|status --root PATH
  node scripts/documenter.mjs check --root PATH [--strict]
  node scripts/documenter.mjs record|publish --root PATH --input FILE
  node scripts/documenter.mjs initial|maintain|overhaul --root PATH [options]
  node scripts/documenter.mjs preview|plan --root PATH [options]
  node scripts/documenter.mjs archive|validate|promote|resume --root PATH --run-id RUN_ID
  node scripts/documenter.mjs stage --root PATH --run-id RUN_ID --input FILE
  node scripts/documenter.mjs restore --root PATH --archive-id ARCHIVE_ID [--dry-run]
  node scripts/documenter.mjs archives|doctor|details --root PATH [options]
  node scripts/documenter.mjs ocr status|doctor|test|models-list|models-verify [options]
  node scripts/documenter.mjs page --root PATH --operation OP --path PAGE [--new-path PAGE]
  node scripts/documenter.mjs style --root PATH --operation show|import|refresh [--source PATH]

Options:
  --set ID, --dest PATH, --frontpage none|root|all
  --style existing|fresh, --style-from PATH, --dry-run, --strict
  --input FILE, --run-id ID, --archive-id ID, --path PATH, --new-path PATH
  --expected-sha256 HASH, --source PATH, --mode MODE, --result-id ID
  --file PATH, --fixture PATH, --expected-phrase TEXT, --model-root PATH
  --model-id ID, --source-path PATH, --language CODE, --backend ID

The deterministic engine does not generate prose. External output remains guarded.
Optional graph, merge, indexed lexical search, renderer and example adapters are available through their documented scripts; semantic search remains disabled without measured capability.
Exit 0 means success, 2 means conflict or unsatisfied check, and 1 means invalid input or execution error.
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help);
    return;
  }
  const action = args.shift();
  if (!actions.has(action)) throw new Error(`Unknown action: ${action}. Use --help.`);
  const input = {};
  if (action === "ocr") {
    const first = args.shift() ?? "status";
    input.operation = first === "models" ? `models-${args.shift() ?? "list"}` : first;
  }
  let root = process.cwd();
  let inputPath;
  let strict = false;
  const seen = new Set();
  while (args.length) {
    const option = args.shift();
    if (option === "--dry-run") {
      if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
      seen.add(option);
      input.dryRun = true;
      continue;
    }
    if (option === "--strict") {
      if (action !== "check") throw new Error("--strict supported only by check.");
      strict = true;
      continue;
    }
    const field = valueFields[option];
    if (!field) throw new Error(`Unknown option: ${option}. Use --help.`);
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    const value = args.shift();
    if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value.`);
    if (field === "root") root = resolve(value);
    else if (field === "inputPath") inputPath = resolve(value);
    else input[field] = value;
  }
  if (inputPath) {
    const stat = statSync(inputPath);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Input must be a regular JSON file no larger than 16 MiB.");
    const parsed = JSON.parse(readFileSync(inputPath, "utf8"));
    Object.assign(input, parsed);
  }
  if (["record", "publish"].includes(action) && !inputPath) throw new Error(`${action} requires --input.`);
  if (!["record", "publish"].includes(action) && inputPath && ["scan", "status", "check"].includes(action)) throw new Error(`${action} does not accept --input.`);
  const result = await runOperation(action, { root, input, strict });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`Documenter: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
