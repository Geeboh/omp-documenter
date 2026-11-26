#!/usr/bin/env node
// OMP Documenter self-contained installer. Writes only to a new destination.
// No network requests, subprocesses, package installation or OMP configuration changes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function ensureSafeParents(destination) {
  const parsed = path.parse(destination);
  let current = parsed.root;
  for (const part of path.relative(parsed.root, destination).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Destination parent must be a normal directory: " + current);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    process.stdout.write("Usage: node omp-documenter-" + distribution.version + "-install.mjs [new-destination-directory]\nWrites the full plugin into a new directory. No OMP settings are changed.\n");
  } else {
    if (args.length > 1) throw new Error("Expected at most one destination directory. Use --help.");
    const destination = path.resolve(args[0] || path.join(os.homedir(), ".local", "share", "omp-documenter-" + distribution.version));
    let exists = false;
    try { fs.lstatSync(destination); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (exists) throw new Error("Destination already exists; no files were changed. Choose a new directory: " + destination);
    const seen = new Set();
    for (const file of distribution.files) {
      if (!file.path || file.path.startsWith("/") || file.path.includes("\\") || /^[A-Za-z]:/.test(file.path) || file.path.split("/").some(part => !part || part === "." || part === "..") || seen.has(file.path)) throw new Error("Invalid packaged path.");
      seen.add(file.path);
      if (hash(Buffer.from(file.base64, "base64")) !== file.sha256) throw new Error("Package content check failed: " + file.path);
    }
    ensureSafeParents(path.dirname(destination));
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const file of distribution.files) {
      const absolute = path.join(destination, ...file.path.split("/"));
      ensureSafeParents(path.dirname(absolute));
      fs.writeFileSync(absolute, Buffer.from(file.base64, "base64"), { flag: "wx", mode: file.mode });
      if (hash(fs.readFileSync(absolute)) !== file.sha256) throw new Error("Installed content check failed: " + file.path);
    }
    process.stdout.write("Installed OMP Documenter " + distribution.version + " (" + distribution.files.length + " files) in:\n" + destination + "\n\nNext: run omp plugin link with this directory as its argument, then start OMP in your project and run /documenter initial.\n");
  }
} catch (error) {
  process.stderr.write("Documenter installer: " + error.message + "\n");
  process.exitCode = 1;
}
