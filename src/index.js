import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runOperation } from "../lib/engine.mjs";

const skillPath = fileURLToPath(new URL("../skills/omp-documenter/SKILL.md", import.meta.url));
const actions = ["scan", "status", "record", "publish", "check"];

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
    "Use documenter_state for inventory, evidence, coverage and safe publication. Continue all authorized documentation work to completion; record unresolved facts and continue independent work.",
    "Produce clear, consistent, user-friendly documentation grounded in source evidence. The following is the requested skill workflow:",
    skill
  ].join("\n\n");
}

function rendered(result) {
  return JSON.stringify(result, null, 2);
}

/** Human-readable command output; the agent tool and CLI retain structured JSON. */
export function formatReport(result) {
  const coverage = result.coverage ?? {};
  const count = item => item ? `${item.count ?? item.reviewed ?? 0} / ${item.denominator ?? item.total ?? 0}` : "Not recorded";
  const lines = [
    "## Documentation status",
    "",
    "| Measure | Current count |",
    "| --- | --- |",
    `| Source files reviewed | ${count(coverage.reviewed)} |`,
    `| Source files documented | ${count(coverage.documented)} |`,
    `| Documentation pages reviewed | ${count(coverage.documentationPages)} |`,
    `| Current supported claims | ${coverage.claims?.supported ?? 0} |`,
    `| Stale claims | ${coverage.claims?.stale ?? 0} |`,
    `| Declared symbols (not an exhaustive total) | ${coverage.symbols?.declared ?? 0} |`,
    ""
  ];
  if (typeof result.integrity === "boolean") {
    lines.push(`**Mechanical integrity: ${result.integrity ? "PASS" : "needs attention"}. Defined scope complete: ${result.complete ? "yes" : "no"}.**`, "");
  }
  const labels = {
    unreviewed: "Source files awaiting review", undocumented: "Source files awaiting documentation",
    unreviewedDocumentation: "Documentation pages awaiting review", documentationGaps: "Documentation inspection gaps",
    staleReviews: "Stale reviews", staleClaims: "Stale claims", stalePages: "Changed or missing generated pages",
    gaps: "Source inspection gaps", openUnknowns: "Open questions", unsettledClaims: "Unknown or conflicting claims"
  };
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
  if (result.links?.failures?.length) lines.push(`Local link failures: **${result.links.failures.length}**. Inspect the CLI check output for individual targets.`, "");
  lines.push(`Explicit exclusions: ${result.scope?.exclusions ?? 0}. Repository boundaries: ${result.scope?.repositoryBoundaries ?? 0}.`, "");
  if (result.snapshot) lines.push(`Source snapshot: \`${result.snapshot}\`.`, "");
  lines.push("Counts and hashes track recorded work; they do not prove semantic correctness or that examples were executed. Read `.documenter/inventory.json` and `.documenter/ledger.json` for persisted details, or use the standalone CLI for a full live report.");
  return lines.join("\n");
}

/** OMP extension factory. Register capabilities only; importing does not scan or write a repository. */
export default function documenter(pi) {
  if (!pi.zod || typeof pi.registerTool !== "function" || typeof pi.registerCommand !== "function") {
    throw new Error("OMP Documenter requires the OMP extension API with pi.zod, registerTool and registerCommand. Use a compatible OMP release or the standalone Node CLI.");
  }
  const z = pi.zod;
  pi.registerTool({
    name: "documenter_state",
    label: "Documenter",
    description: "Inventory a repository, report documentation coverage, record evidence, or safely publish Markdown. Scan/record/publish write .documenter state; status/check inspect live source. Hash freshness is not proof of semantic correctness. Read the bundled omp-documenter skill before generating documentation.",
    approval: "write",
    parameters: z.object({
      action: z.enum(actions),
      root: z.string().optional().describe("Repository root, restricted to the session directory or one of its descendants. Defaults to the session directory."),
      inputJson: z.string().optional().describe("JSON-encoded record or publish payload as defined by the skill references; omit for scan/status/check."),
      strict: z.boolean().optional().describe("For check: also fail for incomplete coverage and unresolved gaps.")
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        if (signal?.aborted) throw new Error("Documentation operation cancelled before execution.");
        const root = resolveRoot(ctx.cwd, params.root);
        if (params.inputJson && Buffer.byteLength(params.inputJson, "utf8") > 4 * 1024 * 1024) throw new Error("Input JSON exceeds the 4 MiB limit.");
        const input = params.inputJson === undefined ? undefined : JSON.parse(params.inputJson);
        const result = await runOperation(params.action, { root, input, strict: params.strict ?? false });
        return { content: [{ type: "text", text: rendered(result) }], details: result, ...(result.ok === false ? { isError: true } : {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Documenter: ${message}` }], details: { ok: false, error: message }, isError: true };
      }
    }
  });
  pi.registerCommand("documenter", {
    description: "Create or maintain documentation: initial | maintain | status | check [--strict]",
    handler: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean);
      const mode = words.shift() || "help";
      const valid = ["initial", "maintain", "status", "check"];
      if (!valid.includes(mode) || (words.length && !(mode === "check" && words.length === 1 && words[0] === "--strict"))) {
        ctx.ui.notify("Usage: /documenter initial | maintain | status | check [--strict]", "info");
        return;
      }
      try {
        if (mode === "initial" || mode === "maintain") {
          pi.sendUserMessage(workflowPrompt(mode, ctx.cwd), {
            attribution: "agent",
            ...(ctx.isIdle() ? {} : { deliverAs: "followUp" })
          });
          return;
        }
        const result = await runOperation(mode, { root: resolveRoot(ctx.cwd), strict: words.includes("--strict") });
        pi.sendMessage({ customType: "documenter-report", content: formatReport(result), display: true }, { triggerTurn: false });
      } catch (error) {
        ctx.ui.notify(`Documenter: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }
  });
}
