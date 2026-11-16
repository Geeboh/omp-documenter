#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runOperation } from "../lib/engine.mjs";

const help = `OMP Documenter 1.0.0

Usage:
  node scripts/documenter.mjs scan   --root /path/to/repository
  node scripts/documenter.mjs status --root /path/to/repository
  node scripts/documenter.mjs record --root /path/to/repository --input /path/to/records.json
  node scripts/documenter.mjs publish --root /path/to/repository --input /path/to/page.json
  node scripts/documenter.mjs check --root /path/to/repository [--strict]

The CLI tracks evidence and safely publishes agent-written pages. It does not
generate prose or independently prove what source code means.
Exit: 0 = operation succeeded; 2 = check/conflict not satisfied; 1 = invalid input/error.
See docs/ENGINE.md for exact payloads and coverage definitions.
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help);
    return;
  }
  const action = args.shift();
  if (!["scan", "status", "record", "publish", "check"].includes(action)) throw new Error(`Unknown action: ${action}. Use --help.`);
  const options = { root: process.cwd(), strict: false };
  let inputPath;
  const seen = new Set();
  while (args.length) {
    const option = args.shift();
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    if (option === "--strict") {
      if (action !== "check") throw new Error("--strict is supported only by check.");
      options.strict = true;
    } else if (["--root", "--input"].includes(option)) {
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
      if (option === "--root") options.root = resolve(value);
      else inputPath = resolve(value);
    } else throw new Error(`Unknown option: ${option}. Use --help.`);
  }
  if (["record", "publish"].includes(action) !== Boolean(inputPath)) {
    throw new Error("record and publish require --input; scan/status/check do not accept it.");
  }
  if (inputPath) {
    const stat = statSync(inputPath);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Input must be a regular JSON file no larger than 4 MiB.");
    options.input = JSON.parse(readFileSync(inputPath, "utf8"));
  }
  const result = await runOperation(action, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`Documenter: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
