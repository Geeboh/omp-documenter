import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runOperation } from "../lib/engine.mjs";

const skillPath = fileURLToPath(new URL("../skills/omp-documenter/SKILL.md", import.meta.url));
const actions = ["scan", "status", "record", "publish", "check", "preview", "plan", "initial", "maintain", "overhaul", "archive", "stage", "validate", "promote", "resume", "archives", "restore", "page", "style", "doctor", "details", "scan-v2", "ocr"];

export function resolveRoot(cwd, requested = ".") {
  const base = realpathSync(cwd);
  const root = realpathSync(resolve(base, requested));
  const rel = relative(base, root);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Repository root must be the session directory or a directory beneath it. Start OMP in the intended repository root.");
  }
  return root;
}

export function workflowPrompt(mode, cwd) {
  if (!["initial", "maintain"].includes(mode)) throw new Error("Mode must be initial or maintain.");
  const skill = readFileSync(skillPath, "utf8");
  return [
    `Run OMP Documenter in ${mode} mode for repository ${JSON.stringify(realpathSync(cwd))}.`,
    `The bundled skill is ${JSON.stringify(skillPath)}. Resolve its reference links relative to that file.`,
    "Use documenter_state for inventory, evidence, coverage and safe publication. Continue authorized documentation work and record unresolved facts.",
    "Produce clear documentation grounded in source evidence. The bundled skill workflow follows:",
    skill
  ].join("\n\n");
}

function rendered(result) { return JSON.stringify(result, null, 2); }

export function formatReport(result) {
  const coverage = result.coverage ?? {};
  const count = item => item ? `${item.count ?? item.reviewed ?? 0} / ${item.denominator ?? item.total ?? 0}` : "Not recorded";
  const lines = [
    "## Documentation status", "",
    "| Measure | Current count |", "| --- | --- |",
    `| Source files reviewed | ${count(coverage.reviewed)} |`,
    `| Source files documented | ${count(coverage.documented)} |`,
    `| Documentation pages reviewed | ${count(coverage.documentationPages)} |`,
    `| Current supported claims | ${coverage.claims?.supported ?? 0} |`,
    `| Stale claims | ${coverage.claims?.stale ?? 0} |`,
    `| Declared symbols (not an exhaustive total) | ${coverage.symbols?.declared ?? 0} |`, ""
  ];
  if (typeof result.integrity === "boolean") lines.push(`**Mechanical integrity: ${result.integrity ? "PASS" : "needs attention"}. Defined scope complete: ${result.complete ? "yes" : "no"}.**`, "");
  const labels = { unreviewed: "Source files awaiting review", undocumented: "Source files awaiting documentation", unreviewedDocumentation: "Documentation pages awaiting review", documentationGaps: "Documentation inspection gaps", staleReviews: "Stale reviews", staleClaims: "Stale claims", stalePages: "Changed or missing generated pages", gaps: "Source inspection gaps", openUnknowns: "Open questions", unsettledClaims: "Unknown or conflicting claims" };
  const attention = Object.entries(result.attention ?? {}).filter(([, items]) => Array.isArray(items) && items.length);
  if (attention.length) {
    lines.push("### Needs attention", "");
    for (const [key, items] of attention) {
      const total = items.length + (result.truncation?.[`attention.${key}`] ?? 0);
      const sample = items.slice(0, 5).map(item => typeof item === "string" ? item : item.path ?? item.id ?? item.question ?? "See ledger");
      lines.push(`- **${labels[key] ?? key}: ${total}.** ${sample.map(x => JSON.stringify(x)).join(", ")}${total > sample.length ? "; more listed in repository state" : ""}.`);
    }
    lines.push("");
  } else lines.push("No outstanding attention items were reported by this operation.", "");
  if (result.links?.failures?.length) lines.push(`Local link failures: **${result.links.failures.length}**. Inspect CLI check output for individual targets.`, "");
  lines.push(`Explicit exclusions: ${result.scope?.exclusions ?? 0}. Repository boundaries: ${result.scope?.repositoryBoundaries ?? 0}.`, "");
  if (result.snapshot) lines.push(`Source snapshot: \`${result.snapshot}\`.`, "");
  lines.push("Counts and hashes track recorded work. They do not prove semantic correctness or executed examples.");
  return lines.join("\n");
}

function commandWords(value) {
  const words = []; let current = ""; let quote = null; let escaped = false;
  for (const char of value) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; else current += char; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) { if (current) { words.push(current); current = ""; } continue; }
    current += char;
  }
  if (escaped || quote) throw new Error("Unmatched quote or escape in command.");
  if (current) words.push(current);
  return words;
}

function parseCommandOptions(words, mode) {
  const input = {}; let strict = false; const singleton = new Set();
  const fields = { "--set": "setId", "--dest": "dest", "--frontpage": "frontpage", "--style": "style", "--style-from": "styleFrom", "--run-id": "runId", "--archive-id": "archiveId", "--path": "path", "--new-path": "newPath", "--expected-sha256": "expectedSha256", "--source": "source", "--mode": "mode", "--result-id": "resultId", "--operation": "operation", "--file": "file", "--fixture": "fixture", "--expected-phrase": "expectedPhrase", "--model-root": "modelRoot", "--model-id": "id", "--source-path": "sourcePath", "--language": "language", "--backend": "backend", "--model-sha256": "modelSha256", "--package-sha256": "packageSha256" };
  while (words.length) {
    const option = words.shift();
    if (singleton.has(option)) throw new Error(`Duplicate option: ${option}`);
    singleton.add(option);
    if (option === "--strict") {
      if (mode !== "check") throw new Error("--strict is supported only by check.");
      strict = true;
      continue;
    }
    if (option === "--dry-run") { input.dryRun = true; continue; }
    const field = fields[option];
    if (!field) throw new Error(`Unknown option ${option}.`);
    const value = words.shift();
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
    input[field] = value;
  }
  if (mode === "check" && Object.keys(input).some(key => key !== "dryRun")) throw new Error("check accepts only --strict.");
  if (input.style && input.styleFrom) throw new Error("--style and --style-from are mutually exclusive.");
  return { input, strict };
}

export default function documenter(pi) {
  if (!pi.zod || typeof pi.registerTool !== "function" || typeof pi.registerCommand !== "function") throw new Error("OMP Documenter requires the OMP extension API with pi.zod, registerTool and registerCommand. Use a compatible OMP release or the standalone Node CLI.");
  const z = pi.zod;
  const readActions = ["status", "check", "preview", "archives", "doctor", "details", "style", "ocr"];
  const writeActions = [...actions.filter(action => !readActions.includes(action) && !["initial", "maintain"].includes(action)), "ocr"];
  const parameters = allowed => z.object({ action: z.enum(allowed), root: z.string().optional(), inputJson: z.string().optional(), strict: z.boolean().optional() });
  const registerStateTool = (name, label, approval, allowed) => pi.registerTool({
    name, label, description: `${label} Documenter operations with ${approval}-classified host approval.`, approval,
    parameters: parameters(allowed),
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        if (signal?.aborted) throw new Error("Documentation operation cancelled before execution.");
        const root = resolveRoot(ctx.cwd, params.root);
        if (params.inputJson && Buffer.byteLength(params.inputJson, "utf8") > 4 * 1024 * 1024) throw new Error("Input JSON exceeds the 4 MiB limit.");
        const input = params.inputJson === undefined ? undefined : JSON.parse(params.inputJson);
        if (name === "documenter_inspect" && params.action === "style" && input?.operation !== "show") throw new Error("Read-only style inspection accepts operation show only.");
        if (name === "documenter_inspect" && params.action === "ocr" && ["models-install", "models-remove"].includes(input?.operation)) throw new Error("Read-only OCR inspection does not permit model installation or removal.");
        const result = await runOperation(params.action, { root, input, strict: params.strict ?? false, signal, onUpdate: _onUpdate });
        return { content: [{ type: "text", text: rendered(result) }], details: result, ...(result.ok === false ? { isError: true } : {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Documenter: ${message}` }], details: { ok: false, error: message }, isError: true };
      }
    }
  });
  registerStateTool("documenter_state", "Documenter", "write", writeActions);
  registerStateTool("documenter_inspect", "Documenter inspection", "read", readActions);
  pi.registerCommand("documenter", {
    description: "Create, maintain, inspect or overhaul documentation. Supports quoted paths and guarded lifecycle actions.",
    handler: async (args, ctx) => {
      let words;
      try { words = commandWords(args.trim()); } catch (error) { ctx.ui.notify(`Documenter: ${error.message}`, "error"); return; }
      const mode = words.shift() || "help";
      const valid = new Set(["initial", "maintain", "status", "check", "preview", "plan", "overhaul", "archive", "stage", "validate", "promote", "resume", "archives", "restore", "page", "style", "doctor", "details", "ocr"]);
      if (!valid.has(mode)) { ctx.ui.notify("Usage: /documenter initial | maintain | status | check [--strict] | overhaul [options]", "info"); return; }
      try {
        if (mode === "initial" || mode === "maintain") {
          if (words.length) throw new Error(`Usage: /documenter ${mode} does not accept command options; use overhaul for an explicit plan.`);
          pi.sendUserMessage(workflowPrompt(mode, ctx.cwd), { attribution: "agent", ...(ctx.isIdle() ? {} : { deliverAs: "followUp" }) });
          return;
        }
        if (mode === "ocr") {
          const first = words.shift() || "status";
          const operation = first === "models" ? `models-${words.shift() || "list"}` : first;
          words.unshift("--operation", operation);
        }
        const { input, strict } = parseCommandOptions(words, mode);
        const result = await runOperation(mode, { root: resolveRoot(ctx.cwd), input, strict });
        pi.sendMessage({ customType: "documenter-report", content: mode === "ocr" ? rendered(result) : formatReport(result), display: true }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(`Documenter: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    }
  });
}
