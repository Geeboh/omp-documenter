#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SOURCES = Object.freeze([
  "README.md",
  "docs/USER-GUIDE.md",
  "docs/ARCHITECTURE.md",
  "docs/ENGINE.md",
  "docs/VALIDATION.md",
  "docs/ROADMAP.md"
]);

function usage() {
  return [
    "Usage: node scripts/generate-guide.mjs [options]",
    "",
    "Options:",
    "  --root PATH       Repository root (default: current directory)",
    "  --output PATH     Generated guide path (default: docs/DOCUMENTATION-GUIDE.md)",
    "  --source PATH     Canonical source path; repeat to set order",
    "  --help            Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  let root = process.cwd();
  let output = "docs/DOCUMENTATION-GUIDE.md";
  const sources = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (["--root", "--output", "--source"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
      if (argument === "--root") root = value;
      else if (argument === "--output") output = value;
      else sources.push(value);
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return { root: path.resolve(root), output, sources: sources.length ? sources : [...DEFAULT_SOURCES] };
}

function regularFile(file, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist: ${file}`);
    throw new Error(`Cannot inspect ${label} ${file}: ${error.message}`);
  }
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveRepositoryFile(root, value, label) {
  const file = path.resolve(root, value);
  if (!inside(root, file)) throw new Error(`${label} must be inside repository root: ${value}`);
  regularFile(file, label);
  return file;
}

function rewriteLocalLinks(markdown, sourceFile, outputFile, root) {
  const sourceDirectory = path.dirname(sourceFile);
  const outputDirectory = path.dirname(outputFile);
  return markdown.replace(/(!?\[[^\]]*\]\()(<[^>]*>|[^)\s]+)([^)]*\))/g, (full, prefix, href, suffix) => {
    const wrapped = href.startsWith("<") && href.endsWith(">") ? href.slice(1, -1) : href;
    if (!wrapped || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(wrapped)) return full;

    const match = wrapped.match(/^([^?#]*)([?#].*)?$/);
    const targetPart = match?.[1] ?? wrapped;
    const suffixPart = match?.[2] ?? "";
    if (!targetPart) return full;

    let decoded;
    try {
      decoded = decodeURIComponent(targetPart);
    } catch {
      return full;
    }
    const target = path.resolve(sourceDirectory, decoded);
    if (!inside(root, target)) return full;
    const rewritten = path.relative(outputDirectory, target).split(path.sep).join("/") || path.basename(target);
    const result = `${rewritten}${suffixPart}`;
    return `${prefix}${href.startsWith("<") ? `<${result}>` : result}${suffix}`;
  });
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

export function generateGuide({ root = process.cwd(), output = "docs/DOCUMENTATION-GUIDE.md", sources = DEFAULT_SOURCES } = {}) {
  const repositoryRoot = path.resolve(root);
  const outputFile = path.resolve(repositoryRoot, output);
  const sourceValues = [...sources];
  if (new Set(sourceValues).size !== sourceValues.length) throw new Error("Canonical source paths must be unique");
  const sourceFiles = sourceValues.map((source) => resolveRepositoryFile(repositoryRoot, source, "Canonical source"));
  if (sourceFiles.some((source) => source === outputFile)) throw new Error("Output path cannot also be a canonical source");

  const sourceNames = sourceFiles.map((source) => relativePath(repositoryRoot, source));
  const sections = sourceFiles.map((source, index) => {
    const markdown = fs.readFileSync(source, "utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
    const adjusted = rewriteLocalLinks(markdown, source, outputFile, repositoryRoot);
    return `## Canonical source: ${sourceNames[index]}\n\n${adjusted}`;
  });
  const manifest = sourceNames.map((source, index) => `${index + 1}. ${source}`).join("\n");
  const content = [
    "# Combined documentation guide",
    "",
    "> Generated from canonical documentation sources. Edit the sources, then regenerate this file.",
    "",
    "## Canonical source order",
    "",
    manifest,
    "",
    ...sections.flatMap((section) => [section, ""])
  ].join("\n");
  writeAtomically(outputFile, `${content.trimEnd()}\n`);
  return { output: outputFile, sources: sourceNames };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = generateGuide(options);
  process.stdout.write(`${JSON.stringify({ output: result.output, sources: result.sources }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`generate-guide: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { DEFAULT_SOURCES, parseArgs, rewriteLocalLinks };
