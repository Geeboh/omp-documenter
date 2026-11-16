import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { buildInstaller, collectPackage } from "../scripts/build-distribution.mjs";

test("self-contained installer verifies all package bytes and refuses overwrite", () => {
  const outer = fs.mkdtempSync(path.join(tmpdir(), "doc-distribution-"));
  try {
    const installer = path.join(outer, "install.mjs");
    const destination = path.join(outer, "installed package");
    const built = buildInstaller(installer);
    const first = spawnSync(process.execPath, [installer, destination], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const packaged = collectPackage();
    assert.equal(built.files, packaged.length);
    for (const file of packaged) assert.equal(fs.readFileSync(path.join(destination, file.path)).toString("base64"), file.base64);
    const manual = path.join(destination, "README.md");
    fs.appendFileSync(manual, "\nHuman change.\n");
    const second = spawnSync(process.execPath, [installer, destination], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists/);
    assert.match(fs.readFileSync(manual, "utf8"), /Human change/);
    assert.throws(() => buildInstaller(installer), /EEXIST/);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

test("installer refuses a destination with a symlinked parent", () => {
  const outer = fs.mkdtempSync(path.join(tmpdir(), "doc-distribution-link-"));
  try {
    const installer = path.join(outer, "install.mjs");
    buildInstaller(installer);
    fs.mkdirSync(path.join(outer, "real"));
    fs.symlinkSync(path.join(outer, "real"), path.join(outer, "link"));
    const result = spawnSync(process.execPath, [installer, path.join(outer, "link", "new")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /normal directory/);
    assert.deepEqual(fs.readdirSync(path.join(outer, "real")), []);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});
