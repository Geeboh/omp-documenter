# OMP Documenter

**Create and maintain repository documentation that describes the code you actually have.**

OMP Documenter is an Oh My Pi extension package with an agent skill and a deterministic integrity engine. The agent investigates the repository and writes the explanation. The engine inventories files, checks evidence locations and hashes, tracks coverage, and protects existing documentation when pages are published.

Documentation must be clear, consistent and user friendly. Every factual explanation must have sufficient evidence. Unknown facts remain visible, with their impact and a practical way to resolve them.

## Start here

1. Install or unpack this package into a permanent directory outside the repository you want to document. Run `npm install --omit=dev` in that directory to install the pinned native Xberg backend. If the backend is unavailable, Markdown and plain-text workflows still work.
2. Link it to OMP:

   ```bash
   omp plugin link /absolute/path/to/omp-documenter
   ```

3. Start a new OMP session in the root of the repository you want to document:

   ```bash
   cd /path/to/your/project
   omp
   ```

4. Run the initial documentation workflow:

   ```text
   /documenter initial
   ```

5. After code changes, run the maintenance workflow:

   ```text
   /documenter maintain
   ```

The directory passed to `plugin link` must remain available. For a single session, load the package directory with `omp --extension /absolute/path/to/omp-documenter` instead.

## What is included

| Part | Purpose |
| --- | --- |
| OMP command `/documenter` | Start initial documentation or maintenance; show status; run mechanical checks. |
| OMP tool `documenter_state` | Give the agent a consistent interface for inventory, records, coverage and safe publication. |
| Skill `omp-documenter` | Define evidence standards, investigation, parallel review, documentation structure and editorial quality. |
| Standalone CLI | Run the same integrity engine without a model or OMP session. |
| Repository state | Keep hashes, coverage, findings, unknowns, page ownership and update journals in `.documenter/`. |
| Tests | Exercise preservation, evidence validation, freshness, repository boundaries and command integration. |

## Everyday commands

| Command in OMP | Result |
| --- | --- |
| `/documenter initial` | Inventory the repository, investigate components, fill missing documentation and report remaining gaps. |
| `/documenter maintain` | Compare the current repository with previous evidence, update safe-to-replace pages, preserve edited content and flag uncertainty. |
| `/documenter status` | Recheck live files and show current coverage and attention items without changing state. |
| `/documenter check` | Check mechanical integrity, stale records, page changes and supported local links. |
| `/documenter check --strict` | Also require the defined scope to have current review and documentation coverage with no unresolved gaps. |

Parallel component reviews default to **automatic, with up to three workers plus the coordinator**, where OMP exposes worker tools. The coordinator owns the final documentation and state. If workers are unavailable, the same workflow runs sequentially.

## Read next

- [User guide](docs/USER-GUIDE.md): installation, initial runs, maintenance, configuration and recovery.
- [Architecture and recommendations](docs/ARCHITECTURE.md): responsibilities, evidence model, parallel work and tradeoffs.
- [Engine reference](docs/ENGINE.md): exact CLI and JSON contracts.
- [Validation and limits](docs/VALIDATION.md): what has been checked and what needs a real OMP host.
- [Roadmap](docs/ROADMAP.md): useful next improvements, in priority order.
- [Agent skill](skills/omp-documenter/SKILL.md): the instructions OMP follows.

## Compatibility and v2 lifecycle

Documenter 2.0.0 requires Node.js 22 or later. The current qualification run passes 88 tests on Node.js 24.22.3 and Bun 1.4.5, including real Xberg PDF/DOCX extraction, authenticated acquisition and local Tesseract OCR.

The v2 engine retains `scan`, `status`, `record`, `publish`, and `check`. It adds guarded `preview`, `plan`, `overhaul`, `archive`, `stage`, `validate`, `promote`, `resume`, `archives`, `restore`, `page`, `style`, `doctor`, `details`, and `ocr` actions. Use the repository-relative lifecycle documented in [the user guide](docs/USER-GUIDE.md) and [the documentation-set reference](docs/DOCUMENTATION-SET.md).

External output, semantic search, automatic section merging and proprietary providers remain unsupported core capabilities. PDF and DOCX style sources are qualified through pinned `@xberg-io/xberg` 1.5.4. Generic authenticated acquisition is origin-scoped and rejects login pages, redirects and rejected credentials. `tessdata_best`, visual layout fidelity and named-provider login remain unqualified.
Local OCR uses the installed Xberg Tesseract backend. `ocr status`, `ocr doctor`, `ocr models list`, `ocr models verify` and `ocr test` expose readiness and receipts. Model downloads are not automatic.
If another OMP plugin fails during automatic discovery, use `node scripts/omp-documenter-host.mjs` to load Documenter with automatic extensions disabled. This does not uninstall or modify other plugins.

## What a passing check means

A passing mechanical check means the implemented integrity conditions passed. It does **not** establish that an agent interpreted every function correctly, that every language symbol was discovered, that an example was executed, or that the project is secure. Those distinctions must remain visible in the generated documentation.
