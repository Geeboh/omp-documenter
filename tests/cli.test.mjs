import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../scripts/documenter.mjs", import.meta.url));
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); }

test("CLI keeps read-only status separate from strict incomplete exit status", () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "doc-cli-"));
  try {
    fs.writeFileSync(path.join(root, "app.js"), "export const n = 1;\n");
    const status = run(["status", "--root", root]);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).coverage.reviewed.count, 0);
    assert.deepEqual(fs.readdirSync(root), ["app.js"]);
    assert.equal(run(["check", "--root", root, "--strict"]).status, 2);
    const scan = run(["scan", "--root", root]);
    assert.equal(scan.status, 0, scan.stderr);
    assert.equal(fs.existsSync(path.join(root, ".documenter", "inventory.json")), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI rejects malformed options and missing record input", () => {
  assert.equal(run(["record"]).status, 1);
  assert.equal(run(["scan", "--strict"]).status, 1);
  assert.equal(run(["scan", "--root"]).status, 1);
  assert.equal(run(["status", "--root", ".", "--root", "."]).status, 1);
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /does not/);
});

test("CLI publishes new Markdown and reports protected-page conflicts with exit 2", () => {
  const outer = fs.mkdtempSync(path.join(tmpdir(), "doc-cli-write-"));
  try {
    const root = path.join(outer, "repo"); fs.mkdirSync(root);
    const input = path.join(outer, "page.json");
    fs.writeFileSync(input, JSON.stringify({ path: "docs/documenter/guide.md", content: "# Guide\n", expectedSha256: null }));
    assert.equal(run(["publish", "--root", root, "--input", input]).status, 0);
    const conflict = run(["publish", "--root", root, "--input", input]);
    assert.equal(conflict.status, 2, conflict.stderr);
    assert.equal(JSON.parse(conflict.stdout).conflict, true);
    assert.equal(fs.readFileSync(path.join(root, "docs/documenter/guide.md"), "utf8"), "# Guide\n");
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});
